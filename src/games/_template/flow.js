'use strict';

/**
 * Phase changes and the game message. Shared by the button handlers, the
 * slash command and restore, so each step happens the same way from anywhere.
 */

const HighRollRepository = require('./repository');
const { renderGameMessage } = require('./render');
const { recordGame } = require('./stats');
const { fetchChannel, lockAndArchive } = require('../_core/threads');
const { editOrSend } = require('../_core/messages');
const card = require('./card');

/** Re-renders the game message in place, or posts it if it doesn't exist yet. */
async function updateGameMessage(game, client, options) {
  const thread = await fetchChannel(client, game.threadId);
  const result = await editOrSend(thread, game.messageId, renderGameMessage(game, options));
  if (result?.created) {
    game.messageId = result.message.id;
    HighRollRepository.upsert(game);
  }
}

/**
 * Arms the rolling deadline from `game.phaseEndsAt`. Restore calls this too, so
 * a restarted game gets only the time it had left.
 */
function scheduleRollTimeout(game, client) {
  client.highRollManager.clearTimers(game);
  const remaining = Math.max(0, game.phaseEndsAt - Date.now());
  game.rollTimeout = setTimeout(() => {
    finishRound(game, client).catch(err => console.error('[High Roll] Deadline error:', err));
  }, remaining);
}

/** Opens a round: everyone can roll until the deadline. */
async function startRound(game, client) {
  client.highRollManager.startRound(game.threadId);
  scheduleRollTimeout(game, client);
}

/** Closes the round: stops the deadline, records stats and shows the results. */
async function finishRound(game, client) {
  if (game.phase !== 'rolling') return;
  client.highRollManager.clearTimers(game);
  game.phase = 'ended';
  game.phaseEndsAt = null;
  HighRollRepository.upsert(game);
  if (game.rolls.size > 0) recordGame(game);
  await updateGameMessage(game, client);
}

/**
 * Ends the session from any phase: final message, archive the thread, delete the
 * game, and show the result (or "Cancelled") on the channel card.
 */
async function closeSession(game, client, reason) {
  client.highRollManager.clearTimers(game);
  await updateGameMessage(game, client, { closedReason: reason });
  lockAndArchive(await fetchChannel(client, game.threadId), { delayMs: 5_000 });
  client.highRollManager.deleteGame(game.threadId);
  if (game.phase === 'lobby') await card.cancel(client, game);
  else await card.finish(client, game, cardResult(game));
}

/** The result in a line for the channel card. */
function cardResult(game) {
  if (game.rolls.size === 0) return '🏁 Nobody rolled.';
  const best = Math.max(...game.rolls.values());
  return `🏆 ${game.winnerIds().map(id => `<@${id}>`).join(', ')} won with a roll of **${best}**.`;
}

module.exports = { updateGameMessage, scheduleRollTimeout, startRound, finishRound, closeSession };
