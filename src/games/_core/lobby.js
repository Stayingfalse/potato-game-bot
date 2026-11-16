'use strict';

/**
 * Builders shared by every game's lobby, so lobbies look and behave the same:
 * the same button row, a Start button that says what it is waiting for, the
 * same player list, and a "How to play" button.
 *
 * Games draw their lobbies differently (embeds or Components V2 containers),
 * so these build the parts, not the whole message.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const NO_PLAYERS = '*No players yet — be the first to join!*';

/** How many more players the lobby needs before it can start (0 when ready). */
function playersNeeded(playerCount, minPlayers) {
  return Math.max(0, minPlayers - playerCount);
}

/**
 * The Start button: disabled and labelled "Need 2 more players" until the
 * minimum is met, then "Start Game". Handlers still check the minimum.
 */
function buildStartButton({ customId, playerCount, minPlayers }) {
  const needed = playersNeeded(playerCount, minPlayers);
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(needed > 0 ? `Need ${needed} more player${needed === 1 ? '' : 's'}` : 'Start Game')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(needed > 0);
}

/** The "How to play" button; the game's handler answers `<prefix>howto` with howToPlayReply(). */
function buildHowToPlayButton(prefix) {
  return new ButtonBuilder()
    .setCustomId(`${prefix}howto`)
    .setLabel('How to play')
    .setEmoji('📖')
    .setStyle(ButtonStyle.Secondary);
}

/**
 * The standard lobby row: Join, Leave, Start, Cancel, How to play, with the
 * customIds `<prefix>join`, `<prefix>leave`, `<prefix>start`, `<prefix>cancel`
 * and `<prefix>howto`.
 *
 * @param {object} options
 * @param {string} options.prefix       the manifest's customId prefix, e.g. 'wl_'
 * @param {number} options.playerCount  players in the lobby now
 * @param {number} options.minPlayers   players needed to start
 * @returns {ActionRowBuilder}
 */
function buildLobbyRow({ prefix, playerCount, minPlayers }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}join`).setLabel('Join').setEmoji('✋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${prefix}leave`).setLabel('Leave').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
    buildStartButton({ customId: `${prefix}start`, playerCount, minPlayers }),
    new ButtonBuilder().setCustomId(`${prefix}cancel`).setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
    buildHowToPlayButton(prefix),
  );
}

/** The lobby's player list: one mention per line, or a prompt to join when empty. */
function formatPlayerList(playerIds) {
  const ids = [...playerIds];
  return ids.length > 0 ? ids.map(id => `• <@${id}>`).join('\n') : NO_PLAYERS;
}

/** A game's rules as message text, from its manifest `name` and `howToPlay`. */
function howToPlayText({ name, howToPlay }) {
  return [
    `## ${howToPlay.emoji ? `${howToPlay.emoji} ` : ''}How to play ${name}`,
    `*${howToPlay.summary}*`,
    '',
    ...howToPlay.rules.map(line => `• ${line}`),
    '',
    `👥 **Players:** ${howToPlay.players}`,
  ].join('\n');
}

/** The private reply to a "How to play" button. */
function howToPlayReply(game) {
  return { content: howToPlayText(game), flags: MessageFlags.Ephemeral };
}

module.exports = {
  playersNeeded,
  buildStartButton,
  buildHowToPlayButton,
  buildLobbyRow,
  formatPlayerList,
  howToPlayText,
  howToPlayReply,
};
