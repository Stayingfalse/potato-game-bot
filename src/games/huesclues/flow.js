'use strict';

/**
 * Phase changes and the game messages. Shared by the button handlers, the
 * slash command and restore, so each step happens the same way from anywhere.
 *
 * Lobby and setup use the session message (game.messageId). From the first
 * turn on, each turn gets its own message (game.turnMessageId) that's edited as
 * the turn advances. When a turn is scored the results are posted as a fresh
 * message, and the old turn message points to them, as Wavelength does.
 */

const { recordTurn } = require('./stats');
const { renderGameMessage, renderClosed, renderPointer } = require('./render');
const { evaluateSessionGoal } = require('./rules');
const { fetchChannel, lockAndArchive } = require('../_core/threads');
const { editMessage, editOrSend } = require('../_core/messages');

/** How long the results stay up before auto-advance starts the next turn. */
const AUTO_ADVANCE_MS = 15_000;
const TURN_PHASES = ['picking', 'guessing', 'followup', 'ended'];

const managerOf = client => client.huesCluesManager;

/** Re-renders the current message in place, or posts it if it doesn't exist yet. */
async function updateGameMessage(game, client, options = {}) {
  const thread = await fetchChannel(client, game.threadId);
  if (!thread) return false;
  const useTurnMessage = TURN_PHASES.includes(game.phase);
  const result = await editOrSend(thread, useTurnMessage ? game.turnMessageId : game.messageId, await renderGameMessage(game, options));
  if (!result) return false;
  if (result.created) {
    if (useTurnMessage) game.turnMessageId = result.message.id;
    else game.messageId = result.message.id;
    managerOf(client).save(game);
  }
  return true;
}

/** Posts a ping in the thread for `userIds`, linking to the current turn message. */
async function ping(game, client, userIds, text) {
  if (userIds.length === 0) return;
  const thread = await fetchChannel(client, game.threadId);
  const url = `https://discord.com/channels/${game.guildId}/${game.threadId}/${game.turnMessageId}`;
  await thread?.send({
    content: `${userIds.map(id => `<@${id}>`).join(' ')} — ${text} ${url}`,
    allowedMentions: { users: userIds },
  }).catch(() => {});
}

/** Starts the next turn (from setup or after a reveal) and lets the cue giver know. */
async function startTurn(game, client) {
  if (!managerOf(client).startTurn(game)) return false;
  await updateGameMessage(game, client);
  await ping(game, client, [game.cueGiverId], 'you\'re the cue giver! Open your card here:');
  return true;
}

/** A clue was given (or the cue giver had nothing more to say): open the guess round. */
async function openGuessRound(game, client) {
  await updateGameMessage(game, client);
  const text = game.guessRound === 1 ? 'the clue is in! Place your token:' : 'place your second token:';
  await ping(game, client, [...game.tokens.keys()], text);
}

/** After a lock-in (or the host locking the rest): move on if everyone's in, else refresh the message. */
async function afterLockIn(game, client) {
  // A simultaneous lock-in may already have moved the turn on (and be posting the results).
  if (game.phase !== 'guessing') return;
  const manager = managerOf(client);
  if (manager.openFollowup(game)) {
    await updateGameMessage(game, client);
    return ping(game, client, [game.cueGiverId], 'everyone has placed a token. Give a second clue, or say nothing more:');
  }
  if (game.guessRound === 2 && manager.isGuessRoundComplete(game)) return finishTurn(game, client);

  await updateGameMessage(game, client);
  const waiting = game.waitingGuesserIds();
  if (waiting.length === 1) await ping(game, client, waiting, 'just you left to place a token:');
}

/** Scores the turn, records stats and posts the results; then schedules the next turn if auto-advance is on. */
async function finishTurn(game, client) {
  const turn = managerOf(client).finishTurn(game);
  if (!turn) return;
  recordTurn(game, turn);

  if (game.autoAdvanceRounds && !evaluateSessionGoal(game).complete) game.advanceAt = Date.now() + AUTO_ADVANCE_MS;
  const previousMessageId = game.turnMessageId;
  game.turnMessageId = null;
  managerOf(client).save(game);
  await updateGameMessage(game, client);

  // The guessing message is a dead end now: point it at the results.
  if (previousMessageId && game.turnMessageId) {
    const url = `https://discord.com/channels/${game.guildId}/${game.threadId}/${game.turnMessageId}`;
    await editMessage(await fetchChannel(client, game.threadId), previousMessageId, renderPointer(`✅ All tokens are in — results: ${url}`));
  }
  scheduleAutoAdvance(game, client);
}

/** Arms auto-advance from `game.advanceAt`. Restore calls this too, so a restarted game gets only the time it had left. */
function scheduleAutoAdvance(game, client) {
  managerOf(client).clearTimers(game);
  if (game.phase !== 'ended' || !game.advanceAt) return;
  game.autoAdvanceTimeout = setTimeout(() => {
    game.autoAdvanceTimeout = null;
    nextTurn(game, client).catch(err => console.error('[Hues & Clues] Auto-advance error:', err));
  }, Math.max(0, game.advanceAt - Date.now()));
}

/** Turns auto-advance on or off from the results screen, arming or cancelling the countdown. */
async function toggleAutoAdvance(game, client) {
  const on = managerOf(client).toggleAutoAdvance(game);
  if (game.phase !== 'ended') return;
  game.advanceAt = on && !evaluateSessionGoal(game).complete ? Date.now() + AUTO_ADVANCE_MS : null;
  managerOf(client).save(game);
  scheduleAutoAdvance(game, client);
}

/** Leaves the results message as a record (without its buttons) and starts the next turn. */
async function nextTurn(game, client) {
  if (game.phase !== 'ended' || evaluateSessionGoal(game).complete) return false;
  await retireResults(game, client);
  return startTurn(game, client);
}

async function retireResults(game, client) {
  const thread = await fetchChannel(client, game.threadId);
  await editMessage(thread, game.turnMessageId, await renderGameMessage(game, { includeControls: false }));
}

/** Opens a fresh lobby in the same thread with the same players. */
async function newSession(game, client) {
  if (game.phase !== 'ended') return;
  await retireResults(game, client);
  managerOf(client).resetForNewSession(game);
  game.messageId = null; // post the new lobby at the bottom of the thread
  await updateGameMessage(game, client);
}

/** Ends the session from any phase: final standings, archive the thread, delete the game. */
async function closeSession(game, client, reason) {
  managerOf(client).clearTimers(game);
  const thread = await fetchChannel(client, game.threadId);
  if (thread) {
    await thread.send(renderClosed(game, reason)).catch(() => {});
    lockAndArchive(thread, { delayMs: 5_000 });
  }
  managerOf(client).deleteGame(game.threadId);
}

module.exports = {
  AUTO_ADVANCE_MS,
  updateGameMessage,
  startTurn,
  openGuessRound,
  afterLockIn,
  finishTurn,
  scheduleAutoAdvance,
  toggleAutoAdvance,
  nextTurn,
  newSession,
  closeSession,
};
