'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildGameThreadEmbed, buildPlayingComponents } = require('../phases/lobby');
const {
  buildBoardEmbed,
  buildVoicePlayerContent,
  buildVoicePlayerComponents,
} = require('../phases/playing');
const { startGameTimer } = require('../phases/timer');
const { ROLES, ROLE_DESCRIPTIONS, getEffectiveRole, getRoleDisplayName } = require('../roles');
const words = require('../words.json');
const { fetchChannel } = require('../../_core/threads');
const { editMessage } = require('../../_core/messages');
const WerewordsRepository = require('../repository');

// Flatten all words from every category into a single pool at load time.
const wordPool = words.categories.flatMap(c => c.words);

function getWordsmithSecretRoleText(player) {
  if (player?.role !== ROLES.MAYOR || !player.secretRole) return '';
  return `\n\n🎭 Secret role: **${getRoleDisplayName(player.secretRole)}**`;
}

async function refreshBoardMessage(game, client) {
  if (!game?.boardMessageId) return;
  const thread = await fetchChannel(client, game.threadId);
  await editMessage(thread, game.boardMessageId, {
    embeds: [buildBoardEmbed(game)],
    components: [],
  });
}

/**
 * Builds the ephemeral secret-info text for a player.
 * @param {{ role: string, secretRole?: string|null }} player
 * @param {string|null} word  Current game.word (may be null if Mayor hasn't picked yet)
 * @returns {{ content: string, wordPending: boolean }}
 */
function buildSecretContent(player, word) {
  const effectiveRole = getEffectiveRole(player);
  const roleDesc = `${ROLE_DESCRIPTIONS[player.role] ?? ''}${getWordsmithSecretRoleText(player)}`;
  const knowsWord = player.role === ROLES.MAYOR || [ROLES.WEREWOLF, ROLES.SEER].includes(effectiveRole);

  if (!knowsWord) {
    return { content: roleDesc, wordPending: false };
  }

  if (word) {
    return {
      content: `${roleDesc}\n\n🔤 The secret word is: **${word}**`,
      wordPending: false,
    };
  }

  return {
    content: `${roleDesc}\n\n⏳ The Mayor is still choosing the secret word — this message will update automatically once it is chosen.`,
    wordPending: true,
  };
}

/** Single-button row shown in ephemeral secret-info for non-Wordsmith players. */
function buildReadyComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ww_ready')
        .setLabel("I'm Ready!")
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

/** Edits the "Game Started" embed to reflect the current ready-up state. */
async function updateReadyEmbed(game, client) {
  if (!game.readyMessageId) return;
  const thread = await fetchChannel(client, game.threadId);
  await editMessage(thread, game.readyMessageId, {
    embeds: [buildGameThreadEmbed(game)],
    components: buildPlayingComponents(),
  });
}

/** Edits the lobby message at the top of the game thread (it doubles as the session's status message). */
async function updateLobbyMessage(game, client, payload) {
  await editMessage(await fetchChannel(client, game.threadId), game.messageId, payload);
}

/**
 * Starts the timer if and only if every player has readied up and the timer
 * isn't already running.  Also sends a "let's go!" announcement.
 */
async function maybeStartTimer(game, client) {
  if (game.timerInterval !== null) return;
  if (game.readyPlayers.size < game.players.size) return;
  const thread = await client.channels.fetch(game.threadId).catch(() => null);
  if (!thread) return;
  await thread.send({ content: '⏱️ All players are ready — the timer has started! Good luck!' }).catch(() => {});
  startGameTimer(game, thread, client);
}

/**
 * Creates a voice-mode response panel message for every non-Wordsmith player.
 * Populates game.voicePlayerMessageIds and persists the game.
 * @param {import('./state')} game
 * @param {import('discord.js').ThreadChannel} thread
 */
async function createVoicePlayerPanels(game, thread) {
  await thread.send({ content: "🎙️ **Voice Mode panels — Mayor, use these to log each player's responses:**" }).catch(() => {});
  for (const player of game.players.values()) {
    if (player.role === ROLES.MAYOR) continue;
    const msg = await thread.send({
      content: buildVoicePlayerContent(player),
      components: buildVoicePlayerComponents(player.id, game.tokens),
    }).catch(() => null);
    if (msg) game.voicePlayerMessageIds.set(player.id, msg.id);
  }
  WerewordsRepository.upsert(game);
}

module.exports = {
  wordPool,
  getWordsmithSecretRoleText,
  refreshBoardMessage,
  buildSecretContent,
  buildReadyComponents,
  updateReadyEmbed,
  updateLobbyMessage,
  maybeStartTimer,
  createVoicePlayerPanels,
};
