'use strict';

const WerewordsRepository = require('./repository');
const WerewordsGameState = require('./state');

/**
 * Crash recovery: reloads saved Werewords games. Each in-progress game's message
 * is re-rendered in place, so its buttons work again straight away, and its
 * countdown is re-armed with the time it had left. Nothing new is posted.
 */
async function restore(client) {
  const rows = WerewordsRepository.getAll();
  if (rows.length === 0) return;

  const { updateGameMessage } = require('./gameMessage');
  const { startGameTimer } = require('./phases/timer');
  const { scheduleRevealTimeout } = require('./phases/reveal');
  const { scheduleVoteTimeout } = require('./phases/voting');

  for (const row of rows) {
    const game = WerewordsGameState.fromRow(row);
    client.werewordsManager.games.set(row.thread_id, game);

    // Fetch the thread — drop the game if Discord no longer knows about it.
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      WerewordsRepository.remove(row.thread_id);
      client.werewordsManager.games.delete(row.thread_id);
      continue;
    }

    // Lobby, mode_select and ended (between games, waiting for Rematch or Close
    // Session) need nothing more: their buttons find the game by thread.
    if (game.phase === 'playing' || game.phase === 'starting') {
      game.phase = 'playing';
      await updateGameMessage(game, client);
      // The countdown only runs once everyone has confirmed their role.
      if (game.readyPlayers.size >= game.players.size) startGameTimer(game, thread, client);
    } else if (game.phase === 'reveal') {
      await updateGameMessage(game, client);
      scheduleRevealTimeout(game, client);
    } else if (game.phase === 'voting') {
      await updateGameMessage(game, client);
      scheduleVoteTimeout(game, client);
    }
  }
}

module.exports = restore;
