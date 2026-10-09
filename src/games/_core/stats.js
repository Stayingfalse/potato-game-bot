'use strict';

/**
 * Game stats across every registered game that has a `stats` hook in its
 * manifest. Used by the MCP server and the AI user context, so a new game's
 * stats show up there without changes outside its folder.
 */

const { getGames } = require('./registry');

/** The registered games that record stats. */
function gamesWithStats() {
  return getGames().filter(game => game.stats);
}

/** A player's stats row in every game, keyed by game id (null where they haven't played). */
function getPlayerStats(guildId, userId) {
  return Object.fromEntries(gamesWithStats().map(game => [game.id, game.stats.getPlayer(guildId, userId)]));
}

/** One sentence per game the player has played, for the AI's user context. */
function describePlayer(guildId, userId) {
  return gamesWithStats()
    .map(game => game.stats.describe(game.stats.getPlayer(guildId, userId)))
    .filter(Boolean);
}

/** A game's top-10 scoreboard for a guild, or null if there's no such game with stats. */
function getScoreboard(gameId, guildId) {
  const game = gamesWithStats().find(g => g.id === gameId);
  return game ? game.stats.scoreboard(guildId) : null;
}

module.exports = { gamesWithStats, getPlayerStats, describePlayer, getScoreboard };
