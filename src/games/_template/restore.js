'use strict';

const HighRollRepository = require('./repository');
const HighRollGameState = require('./state');
const { updateGameMessage, scheduleRollTimeout } = require('./flow');

/**
 * Crash recovery, called once on startup: reload every saved game, drop any
 * whose thread is gone, redraw each game message in place (so its buttons work
 * again) and re-arm the rolling deadline with the time it had left.
 */
async function restore(client) {
  for (const row of HighRollRepository.getAll()) {
    const game = HighRollGameState.fromRow(row);
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      HighRollRepository.remove(row.thread_id);
      continue;
    }

    client.highRollManager.games.set(game.threadId, game);
    await updateGameMessage(game, client);
    if (game.phase === 'rolling') scheduleRollTimeout(game, client);
  }
}

module.exports = restore;
