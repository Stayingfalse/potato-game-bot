'use strict';

const ArticulateRepository = require('./repository');
const ArticulateGameState = require('./state');
const { updateGameMessage, scheduleTurnTimer, finishDescribing, endTurn } = require('./flow');
const { TIMER_GRACE_MS } = require('./rules');

/**
 * Crash recovery, called once on startup: reload every saved game, drop any
 * whose thread is gone, and pick each one up where it was. A running timer
 * gets only the time it had left (or ends at once if it ran out while the bot
 * was down); a finished turn moves on to the next team. Describers reopen
 * their panel from the turn message.
 */
async function restore(client) {
  for (const row of ArticulateRepository.getAll()) {
    const game = ArticulateGameState.fromRow(row);
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      ArticulateRepository.remove(row.thread_id);
      continue;
    }

    client.articulateManager.games.set(game.threadId, game);
    if (game.phase === 'describing' && Date.now() > game.turn.endsAt + TIMER_GRACE_MS) {
      await finishDescribing(game, client);
    } else if (game.phase === 'turnover') {
      await endTurn(game, client);
    } else {
      await updateGameMessage(game, client);
      scheduleTurnTimer(game, client);
    }
  }
}

module.exports = restore;
