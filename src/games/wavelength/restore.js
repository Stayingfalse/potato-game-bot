'use strict';

const WavelengthRepository = require('./repository');

/** Crash recovery: reloads saved Wavelength games and re-hooks their timers and buttons. */
async function restore(client) {
  const rows = WavelengthRepository.getAll();
  if (rows.length === 0) return;

  const WavelengthGameState = require('./state');
  const { updateGameMessage, scheduleGuessTimeout } = require('./handlers');
  const { scheduleAutoAdvance } = require('./phases/endGame');
  const { evaluateSessionGoal } = require('./phases/sessionEnd');

  for (const row of rows) {
    const game = WavelengthGameState.fromRow(row);
    client.wavelengthManager.games.set(row.thread_id, game);

    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      WavelengthRepository.remove(row.thread_id);
      client.wavelengthManager.games.delete(row.thread_id);
      continue;
    }

    const restored = await updateGameMessage(game, client, { createIfMissing: false }, thread);
    if (!restored) {
      WavelengthRepository.remove(row.thread_id);
      client.wavelengthManager.games.delete(row.thread_id);
      continue;
    }

    if (game.phase === 'guessing' && game.gamePace !== 'turnbased') {
      await scheduleGuessTimeout(game, client);
    }

    if (game.phase === 'ended' && game.autoAdvanceRounds && !evaluateSessionGoal(game).complete) {
      scheduleAutoAdvance(game, client);
    }
  }
}

module.exports = restore;
