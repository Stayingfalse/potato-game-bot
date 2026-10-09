'use strict';

const NoMoreJockeysRepository = require('./repository');
const NoMoreJockeysGameState = require('./state');

/** Crash recovery: reloads saved No More Jockeys games and re-hooks their timers and buttons. */
async function restore(client) {
  const rows = NoMoreJockeysRepository.getAll();
  if (rows.length === 0) return;

  const { updateGameMessage } = require('./handlers');

  for (const row of rows) {
    if (row.phase === 'ended') {
      NoMoreJockeysRepository.remove(row.thread_id);
      continue;
    }

    const game = NoMoreJockeysGameState.fromRow(row);
    client.nmjManager.games.set(row.thread_id, game);

    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      NoMoreJockeysRepository.remove(row.thread_id);
      client.nmjManager.games.delete(row.thread_id);
      continue;
    }

    // Re-render the single persistent message in place so its buttons are immediately
    // wired to the restored game state — no separate "bot restarted" notice is needed
    // since the game is fully playable again as soon as this edit completes.
    await updateGameMessage(game, client, undefined, thread);
  }
}

module.exports = restore;
