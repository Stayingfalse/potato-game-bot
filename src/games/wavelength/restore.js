'use strict';

const WavelengthRepository = require('../../db/WavelengthRepository');

/** Crash recovery: reloads saved Wavelength games and re-hooks their timers and buttons. */
async function restore(client) {
  const rows = WavelengthRepository.getAll();
  if (rows.length === 0) return;

  const { WavelengthGameState } = require('../../game/WavelengthManager');
  const { updateGameMessage, scheduleGuessTimeout } = require('../../game/wavelength/interactionHandler');
  const { scheduleAutoAdvance } = require('../../game/wavelength/phases/endGame');
  const { evaluateSessionGoal } = require('../../game/wavelength/phases/sessionEnd');

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
