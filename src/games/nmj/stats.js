'use strict';

/**
 * No More Jockeys player stats, per guild. A game is recorded once, when it
 * finishes with a winner; a game ended early with /nmj end isn't counted.
 */

const db = require('../../db/database');

db.exec(`
  CREATE TABLE IF NOT EXISTS nmj_player_stats (
    guild_id           TEXT NOT NULL,
    user_id            TEXT NOT NULL,
    username           TEXT NOT NULL DEFAULT '',
    games_played       INTEGER NOT NULL DEFAULT 0,
    wins               INTEGER NOT NULL DEFAULT 0,
    times_eliminated   INTEGER NOT NULL DEFAULT 0,
    knockouts          INTEGER NOT NULL DEFAULT 0,
    failed_challenges  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const stmtRecordPlayer = db.prepare(`
  INSERT INTO nmj_player_stats
    (guild_id, user_id, username, games_played, wins, times_eliminated, knockouts, failed_challenges)
  VALUES
    (@guild_id, @user_id, @username, 1, @won, @eliminated, @knockouts, @failed)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    username          = COALESCE(NULLIF(excluded.username, ''), username),
    games_played      = games_played + 1,
    wins              = wins + excluded.wins,
    times_eliminated  = times_eliminated + excluded.times_eliminated,
    knockouts         = knockouts + excluded.knockouts,
    failed_challenges = failed_challenges + excluded.failed_challenges
`);

const stmtGetPlayer = db.prepare('SELECT * FROM nmj_player_stats WHERE guild_id = ? AND user_id = ?');

const stmtScoreboard = db.prepare(`
  SELECT user_id, username, games_played, wins, knockouts, times_eliminated,
         CASE WHEN games_played > 0 THEN ROUND(100.0 * wins / games_played, 1) ELSE 0 END AS win_pct
  FROM nmj_player_stats
  WHERE guild_id = ? AND games_played > 0
  ORDER BY wins DESC, win_pct DESC, knockouts DESC
  LIMIT 10
`);

/**
 * Records a finished game for every player in it.
 * @param {import('./state')} game
 * @param {string} winnerId
 */
const recordGame = db.transaction((game, winnerId) => {
  const results = game.challengeResults ?? [];
  for (const playerId of game.turnOrder()) {
    stmtRecordPlayer.run({
      guild_id: game.guildId,
      user_id: playerId,
      username: game.players.get(playerId)?.username ?? '',
      won: playerId === winnerId ? 1 : 0,
      eliminated: results.filter(r => r.success && r.targetId === playerId).length,
      knockouts: results.filter(r => r.success && r.challengerId === playerId).length,
      failed: results.filter(r => !r.success && r.challengerId === playerId).length,
    });
  }
});

/** A player's stats row, or null. */
function getPlayer(guildId, userId) {
  return stmtGetPlayer.get(guildId, userId) ?? null;
}

/** Top 10 players in a guild by wins. */
function scoreboard(guildId) {
  return stmtScoreboard.all(guildId);
}


module.exports = { recordGame, getPlayer, scoreboard };
