'use strict';

/**
 * High Roll player stats, per guild. Optional: a game without stats just leaves
 * `stats` out of its manifest. With it, the game offers the standard
 * getPlayer/scoreboard pair, plus describePlayer/leaderboard, which are what
 * /stats and /leaderboard show (src/games/_core/statsDisplay.js).
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

const RANKING_SQL = `
  SELECT user_id, username, games_played, wins, best_roll
  FROM highroll_player_stats
  WHERE guild_id = ? AND games_played > 0
  ORDER BY wins DESC, best_roll DESC
`;

const stmtScoreboard = db.prepare(`${RANKING_SQL} LIMIT 10`);
const stmtRanking = db.prepare(RANKING_SQL);

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

// The functions the stats hook needs:

/** A player's stats row, or null. */
function getPlayer(guildId, userId) {
  return stmtGetPlayer.get(guildId, userId) ?? null;
}

/** Top 10 players in a guild. */
function scoreboard(guildId) {
  return stmtScoreboard.all(guildId);
}

// What players see. The wording lives here, so the commands need no per-game knowledge.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What /stats shows for a player's row: label/value pairs. */
function describePlayer(row) {
  return [
    { label: 'Games', value: row.games_played },
    { label: 'Wins', value: row.wins },
    { label: 'Best roll', value: row.best_roll },
  ];
}

/**
 * What /leaderboard shows: every player in a guild, best first (not just the
 * top 10, so a player further down can be told their rank). `headline` is the
 * number the ranking is about; `detail` is a short extra.
 */
function leaderboard(guildId) {
  return stmtRanking.all(guildId).map(row => ({
    user_id: row.user_id,
    username: row.username,
    headline: plural(row.wins, 'win'),
    detail: `best roll ${row.best_roll}`,
  }));
}

module.exports = { recordGame, getPlayer, scoreboard, describePlayer, leaderboard };
