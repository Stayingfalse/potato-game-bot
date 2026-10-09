'use strict';

const { getGames } = require('../games/_core/registry');

/**
 * Crash-recovery: reload every game's saved state from the DB and re-hook timers/buttons.
 * Called once from ready.js after the bot logs in. Each game's own restore() does the work;
 * a failure in one game is logged and doesn't stop the others.
 *
 * @param {import('discord.js').Client} client
 */
async function restoreGames(client) {
  const games = getGames().filter(game => game.restore);
  const results = await Promise.allSettled(games.map(game => game.restore(client)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[Restore] ${games[i].name} failed:`, result.reason);
    }
  });
}

module.exports = { restoreGames };
