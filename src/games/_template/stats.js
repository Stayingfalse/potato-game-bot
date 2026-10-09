'use strict';

/**
 * High Roll player stats, per guild. Optional: a game without stats just leaves
 * `stats` out of its manifest. With it, the game offers the standard
 * getPlayer/scoreboard pair that a leaderboard can read for any game.
 */

const db = require('../../db/database');

db.exec(`
  CREATE TABLE IF NOT EXISTS highroll_player_stats (
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    username      TEXT NOT NULL DEFAULT '',
    games_played  INTEGER NOT NULL DEFAULT 0,
    wins          INTEGER NOT NULL DEFAULT 0,
    best_roll     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const stmtRecordPlayer = db.prepare(`
  INSERT INTO highroll_player_stats (guild_id, user_id, username, games_played, wins, best_roll)
  VALUES (@guild_id, @user_id, @username, 1, @won, @roll)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    username     = excluded.username,
    games_played = games_played + 1,
    wins         = wins + excluded.wins,
    best_roll    = MAX(best_roll, excluded.best_roll)
`);

const stmtGetPlayer = db.prepare('SELECT * FROM highroll_player_stats WHERE guild_id = ? AND user_id = ?');

const stmtScoreboard = db.prepare(`
  SELECT user_id, username, games_played, wins, best_roll
  FROM highroll_player_stats
  WHERE guild_id = ? AND games_played > 0
  ORDER BY wins DESC, best_roll DESC
  LIMIT 10
`);

/** Records a finished round for everyone who rolled. */
const recordGame = db.transaction(game => {
  const winners = new Set(game.winnerIds());
  for (const [userId, roll] of game.rolls) {
    stmtRecordPlayer.run({
      guild_id: game.guildId,
      user_id: userId,
      username: game.players.get(userId)?.username ?? '',
      won: winners.has(userId) ? 1 : 0,
      roll,
    });
  }
});

// The two functions the stats hook needs:

/** A player's stats row, or null. */
function getPlayer(guildId, userId) {
  return stmtGetPlayer.get(guildId, userId) ?? null;
}

/** Top 10 players in a guild. */
function scoreboard(guildId) {
  return stmtScoreboard.all(guildId);
}


module.exports = { recordGame, getPlayer, scoreboard };
