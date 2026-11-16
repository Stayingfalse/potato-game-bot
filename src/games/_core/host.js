'use strict';

/**
 * Who may run a game, and how the host role changes hands.
 *
 * A game's host-only buttons work for the host and for moderators (anyone with
 * Manage Threads). If the host goes quiet, a player can take over: the "only
 * the host can…" reply carries a **Take over as host** button, which works once
 * the host has been inactive for TAKEOVER_AFTER_MS or has left the game.
 *
 * The host's last activity is kept in memory on the game (`hostLastActiveAt`),
 * not in the database. After a restart it is unknown, and counts from the first
 * interaction the game then receives.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');

/** How long the host must be inactive before a player can take over. */
const TAKEOVER_AFTER_MS = 2 * 60 * 1000;

/** The take-over button's customId is the game's prefix plus this, e.g. `ww_take_host`. */
const TAKE_HOST_SUFFIX = 'take_host';

let now = () => Date.now();

/** Replaces the clock used for host inactivity (tests). Call with no argument to restore the real one. */
function setClock(clock) {
  now = clock ?? (() => Date.now());
}

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

/** Whether the user may use the game's host-only controls: the host, or a moderator with Manage Threads. */
function isHost(interaction, game) {
  if (interaction.user.id === game.hostId) return true;
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads);
}

/**
 * Notes that the game received an interaction. Each game calls this for every
 * interaction, so the host's inactivity is measured from their last one.
 */
function trackHostActivity(interaction, game) {
  if (interaction.user.id === game.hostId || game.hostLastActiveAt === undefined) game.hostLastActiveAt = now();
}

/** Milliseconds until a player may take over; 0 once they can. */
function takeoverWaitMs(game) {
  if (!game.players.has(game.hostId)) return 0; // the host has left the game
  game.hostLastActiveAt ??= now();
  return Math.max(0, TAKEOVER_AFTER_MS - (now() - game.hostLastActiveAt));
}

function formatWait(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} minute${minutes === 1 ? '' : 's'}${rest ? ` ${rest} second${rest === 1 ? '' : 's'}` : ''}`;
}

/** `ww_start` → `ww_take_host`: the take-over button for the game that owns `customId`. */
function takeHostCustomId(customId) {
  return `${customId.slice(0, customId.indexOf('_') + 1)}${TAKE_HOST_SUFFIX}`;
}

/**
 * The ephemeral reply for someone who pressed a host-only control. Players in
 * the game also get the **Take over as host** button.
 * @param {string} content  e.g. 'Only the host can start the game.'
 */
function buildNotHostReply(interaction, game, content) {
  const payload = ephemeral(content);
  if (game.players.has(interaction.user.id)) {
    payload.components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(takeHostCustomId(interaction.customId))
        .setLabel('Take over as host')
        .setEmoji('👑')
        .setStyle(ButtonStyle.Secondary),
    )];
  }
  return payload;
}

function replyNotHost(interaction, game, content) {
  return interaction.reply(buildNotHostReply(interaction, game, content));
}

/**
 * Handles a game's `<prefix>take_host` button.
 *
 * @param {object} options
 * @param {import('./BaseGameManager')} options.manager  the game's manager
 * @param {(game: object, client: object) => Promise<unknown>} [options.rerender]
 *   redraws the game message, for games (or phases) that show the host's name
 * @returns {Promise<boolean>} whether the host changed
 */
async function handleTakeHost(interaction, client, game, { manager, rerender } = {}) {
  const { user } = interaction;
  if (!game) {
    await interaction.reply(ephemeral('There is no active game in this thread.'));
    return false;
  }
  if (user.id === game.hostId) {
    await interaction.reply(ephemeral('You are already the host.'));
    return false;
  }
  if (!game.players.has(user.id)) {
    await interaction.reply(ephemeral('Only players in this game can take over as host.'));
    return false;
  }

  const hostLeft = !game.players.has(game.hostId);
  const wait = takeoverWaitMs(game);
  if (wait > 0) {
    await interaction.reply(ephemeral(`⏳ <@${game.hostId}> is still hosting. You can take over if they stay inactive for another **${formatWait(wait)}**.`));
    return false;
  }

  // A host can only run one game of each type at a time (see getGameByHost in the start command).
  const other = manager.getGameByHost(game.guildId, user.id);
  if (other && other !== game) {
    await interaction.reply(ephemeral(`You are already hosting another game of this type in <#${other.threadId}>. Finish or end that one before taking over here.`));
    return false;
  }

  game.hostId = user.id;
  game.hostUsername = user.username;
  game.hostLastActiveAt = now();
  manager.saveGame(game.threadId);

  // The button sits on the "only the host can…" reply: replace that with the confirmation.
  await interaction.update({ content: '👑 You are now the host.', components: [] });
  if (rerender) await rerender(game, client);

  const thread = await client.channels.fetch(game.threadId).catch(() => null);
  await thread?.send({
    content: `👑 <@${user.id}> is now the host (the previous host ${hostLeft ? 'had left the game' : 'was away'}).`,
    allowedMentions: { users: [user.id] },
  }).catch(() => {});
  return true;
}

module.exports = {
  TAKEOVER_AFTER_MS,
  TAKE_HOST_SUFFIX,
  setClock,
  isHost,
  trackHostActivity,
  takeoverWaitMs,
  takeHostCustomId,
  buildNotHostReply,
  replyNotHost,
  handleTakeHost,
};
