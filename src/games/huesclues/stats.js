'use strict';

/** Hues & Clues player stats, per guild, recorded after every scored turn. */

const db = require('../../db/database');
const { turnPoints } = require('./rules');

db.exec(`
  CREATE TABLE IF NOT EXISTS huesclues_player_stats (
    guild_id            TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    username            TEXT NOT NULL DEFAULT '',
    turns_played        INTEGER NOT NULL DEFAULT 0,
    turns_as_cue_giver  INTEGER NOT NULL DEFAULT 0,
    total_score         INTEGER NOT NULL DEFAULT 0,
    bullseyes           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const stmtRecordPlayer = db.prepare(`
  INSERT INTO huesclues_player_stats (guild_id, user_id, username, turns_played, turns_as_cue_giver, total_score, bullseyes)
  VALUES (@guild_id, @user_id, @username, 1, @cue_giver, @score, @bullseyes)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    username           = excluded.username,
    turns_played       = turns_played + 1,
    turns_as_cue_giver = turns_as_cue_giver + excluded.turns_as_cue_giver,
    total_score        = total_score + excluded.total_score,
    bullseyes          = bullseyes + excluded.bullseyes
`);

const stmtGetPlayer = db.prepare('SELECT * FROM huesclues_player_stats WHERE guild_id = ? AND user_id = ?');

const RANKING_SQL = `
  SELECT user_id, username, turns_played, total_score, bullseyes,
         CASE WHEN turns_played > 0 THEN ROUND(1.0 * total_score / turns_played, 1) ELSE 0 END AS avg_score
  FROM huesclues_player_stats
  WHERE guild_id = ? AND turns_played > 0
  ORDER BY total_score DESC, avg_score DESC
`;

const stmtScoreboard = db.prepare(`${RANKING_SQL} LIMIT 10`);
const stmtRanking = db.prepare(RANKING_SQL);

/** Records a scored turn for the cue giver and every guesser. Bullseyes are tokens right on the target. */
const recordTurn = db.transaction((game, turn) => {
  const points = turnPoints(turn);
  for (const [userId, score] of Object.entries(points)) {
    const bullseyes = (turn.scores.guessers[userId]?.points ?? []).filter(p => p === 3).length;
    stmtRecordPlayer.run({
      guild_id: game.guildId,
      user_id: userId,
      username: game.players.get(userId)?.username ?? '',
      cue_giver: userId === turn.cueGiverId ? 1 : 0,
      score,
      bullseyes,
    });
  }
});

/** A player's stats row, or null. */
function getPlayer(guildId, userId) {
  return stmtGetPlayer.get(guildId, userId) ?? null;
}

/** Top 10 players in a guild by total score. */
function scoreboard(guildId) {
  return stmtScoreboard.all(guildId);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What /stats shows for a player's row: label/value pairs. */
function describePlayer(row) {
  const average = row.turns_played > 0 ? Math.round(10 * row.total_score / row.turns_played) / 10 : 0;
  return [
    { label: 'Turns', value: row.turns_played },
    { label: 'Total score', value: `${row.total_score} pts` },
    { label: 'Average', value: `${average} pts a turn` },
    { label: 'Bullseyes', value: row.bullseyes },
    { label: 'Turns as cue giver', value: row.turns_as_cue_giver },
  ];
}

/** What /leaderboard shows: every player in a guild, best first, by total score. */
function leaderboard(guildId) {
  return stmtRanking.all(guildId).map(row => ({
    user_id: row.user_id,
    username: row.username,
    headline: `${row.total_score} pts`,
    detail: `${plural(row.turns_played, 'turn')}, ${plural(row.bullseyes, 'bullseye')}`,
  }));
}
module.exports = { recordTurn, getPlayer, scoreboard, describePlayer, leaderboard };
