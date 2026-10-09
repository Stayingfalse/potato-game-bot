const WerewordsRepository = require('../repository');
const { recordResult, runEndSequence } = require('./sessionEnd');

/**
 * Finalises the game:
 *  1. Stops timers and sets the phase to 'ended'.
 *  2. Records the result (session history and stats; not for a cancelled game).
 *  3. Moves the game message to the bottom of the thread as the result banner.
 *  4. Runs the rest of the end sequence (role reveals, session summary, rematch buttons).
 *
 * The game stays registered: the session lives on until the host clicks
 * "Close Session" or uses /werewords end.
 *
 * @param {import('../state')} game
 * @param {import('discord.js').Client} client
 * @param {string} outcome
 * @param {string|null} [seerVictimUserId]  userId the Werewolf correctly named as the Seer.
 */
async function endGame(game, client, outcome, seerVictimUserId = null) {
  // Guard against being called twice.
  if (game.phase === 'ended') return;

  client.werewordsManager.clearTimers(game);
  game.phase = 'ended';
  game.phaseEndsAt = null;
  WerewordsRepository.upsert(game);

  recordResult(game, outcome, seerVictimUserId);

  const { moveGameMessage } = require('../gameMessage');
  await moveGameMessage(game, client, { outcome });

  await runEndSequence(game, client, outcome);
}

module.exports = { endGame };
