'use strict';

const HuesCluesRepository = require('./repository');
const HuesCluesGameState = require('./state');
const { updateGameMessage, scheduleAutoAdvance } = require('./flow');

/**
 * Crash recovery, called once on startup: reload every saved game, drop any
 * whose thread is gone, redraw each game message in place (so its buttons work
 * again) and re-arm auto-advance with the time it had left. Private panels
 * still work too: their buttons find the game by thread.
 */
async function restore(client) {
  for (const row of HuesCluesRepository.getAll()) {
    const game = HuesCluesGameState.fromRow(row);
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      HuesCluesRepository.remove(row.thread_id);
      continue;
    }

    client.huesCluesManager.games.set(game.threadId, game);
    await updateGameMessage(game, client);
    scheduleAutoAdvance(game, client);
  }
}

module.exports = restore;
