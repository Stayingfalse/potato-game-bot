'use strict';

/**
 * Seconds-remaining marks at which a warning is posted, per session mode.
 * Voice mode reads them aloud (TTS) for players who are looking away from the
 * screen. Text mode posts plain messages and skips the 30 s one: the board's
 * live countdown already shows the time, and players are typing in the thread.
 */
const WARNINGS = {
  voice: [60, 30, 10],
  text: [60, 10],
};

/**
 * Posts a time warning. In voice mode it is sent as TTS; text mode never uses TTS.
 * Fails silently so a broken TTS permission never kills the bot.
 */
async function sendTimeWarning(thread, seconds, sessionMode) {
  const content = `⏱️ ${seconds} seconds remaining!`;
  if (sessionMode === 'voice') {
    try {
      await thread.send({ content, tts: true });
      return;
    } catch {
      // TTS may be disabled or rate-limited — fall back to a plain message below.
    }
  }
  try {
    await thread.send({ content });
  } catch {
    // Ignore all errors; timer warnings are non-critical.
  }
}

/**
 * Starts (or re-arms) the werewords countdown. The deadline is `game.timerEndsAt`;
 * when it is not set yet it is fixed now from `game.timeLeft` and saved, so a
 * restored game resumes with only the time it had left.
 *
 * Nothing edits the board to tick the clock: the board shows the deadline as a
 * Discord relative timestamp, which every client counts down by itself. Two
 * timeouts are armed instead, both listed in the manager's timerKeys so
 * clearTimers stops them:
 *   - game.timerTimeout fires at the deadline and moves the game to the vote;
 *   - game.timerWarningTimeout fires at the next warning still ahead, then
 *     re-arms itself for the one after. Warnings already passed are skipped.
 *
 * Called when everyone is ready (handlers/shared.js) and by restore.js.
 * Returns a promise for the one board redraw done when a new deadline is set.
 *
 * @param {import('../state')} game
 * @param {import('discord.js').ThreadChannel} thread
 * @param {import('discord.js').Client} client
 */
function startGameTimer(game, thread, client) {
  const { startVotingPhase } = require('./voting');
  const WerewordsRepository = require('../repository');

  // Re-arming replaces any previous countdown for this game.
  clearTimeout(game.timerTimeout);
  clearTimeout(game.timerWarningTimeout);
  game.timerWarningTimeout = null;

  let boardRefresh = Promise.resolve();
  if (!game.timerEndsAt) {
    game.timerEndsAt = Date.now() + Math.max(0, game.timeLeft) * 1000;
    WerewordsRepository.upsert(game);
    // The board was drawn before the deadline existed; redraw it once to show the countdown.
    if (game.boardMessageId) {
      const { updateGameMessage } = require('../gameMessage');
      boardRefresh = updateGameMessage(game, client).catch(err => console.error('[Timer] board refresh error:', err));
    }
  }
  const endsAt = game.timerEndsAt;

  game.timerTimeout = setTimeout(async () => {
    game.timerTimeout = null;
    if (game.phase !== 'playing' || game.timerEndsAt !== endsAt) return;
    try {
      await startVotingPhase(game, client);
    } catch (err) {
      console.error('[Timer] startVotingPhase error:', err);
    }
  }, Math.max(0, endsAt - Date.now()));

  // Warnings still ahead, soonest first (on restore, those already passed are dropped).
  const marks = WARNINGS[game.sessionMode === 'voice' ? 'voice' : 'text'];
  const pending = marks.filter(seconds => endsAt - seconds * 1000 > Date.now());
  const armNextWarning = () => {
    const next = pending.shift();
    if (next === undefined) return;
    game.timerWarningTimeout = setTimeout(async () => {
      game.timerWarningTimeout = null;
      if (game.phase !== 'playing' || game.timerEndsAt !== endsAt) return;
      armNextWarning();
      await sendTimeWarning(thread, next, game.sessionMode);
    }, Math.max(0, endsAt - next * 1000 - Date.now()));
  };
  armNextWarning();
  return boardRefresh;
}

module.exports = { startGameTimer, sendTimeWarning, WARNINGS };
