'use strict';

/** Wavelength player stats, per guild, recorded after every round. */

const db = require('../../db/database');

db.exec(`
  CREATE TABLE IF NOT EXISTS wavelength_player_stats (
    guild_id           TEXT NOT NULL,
    user_id            TEXT NOT NULL,
    username           TEXT NOT NULL,
    rounds_played      INTEGER NOT NULL DEFAULT 0,
    rounds_as_clue_giver INTEGER NOT NULL DEFAULT 0,
    total_score        INTEGER NOT NULL DEFAULT 0,
    bullseyes          INTEGER NOT NULL DEFAULT 0,
    synergy_bonuses    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// ── Prepared statements ────────────────────────────────────────────────────────

const stmtUpsertPlayer = db.prepare(`
  INSERT INTO wavelength_player_stats
    (guild_id, user_id, username, rounds_played, rounds_as_clue_giver,
     total_score, bullseyes, synergy_bonuses)
  VALUES
    (@guild_id, @user_id, @username, 0, 0, 0, 0, 0)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    username = excluded.username
`);

const stmtIncrGuesser = db.prepare(`
  UPDATE wavelength_player_stats
  SET rounds_played   = rounds_played + 1,
      total_score     = total_score   + @score,
      bullseyes       = bullseyes     + @bullseye
  WHERE guild_id = @guild_id AND user_id = @user_id
`);

const stmtIncrClueGiver = db.prepare(`
  UPDATE wavelength_player_stats
  SET rounds_played        = rounds_played        + 1,
      rounds_as_clue_giver = rounds_as_clue_giver + 1,
      total_score          = total_score          + @score,
      synergy_bonuses      = synergy_bonuses      + @synergy
  WHERE guild_id = @guild_id AND user_id = @user_id
`);

const stmtGetGuild = db.prepare(`
  SELECT * FROM wavelength_player_stats WHERE guild_id = ?
`);

const stmtGetPlayer = db.prepare('SELECT * FROM wavelength_player_stats WHERE guild_id = ? AND user_id = ?');

const stmtScoreboard = db.prepare(`
  SELECT user_id, username, rounds_played, total_score, bullseyes,
         CASE WHEN rounds_played > 0 THEN ROUND(1.0 * total_score / rounds_played, 1) ELSE 0 END AS avg_score
  FROM wavelength_player_stats
  WHERE guild_id = ? AND rounds_played > 0
  ORDER BY total_score DESC, avg_score DESC
  LIMIT 10
`);

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Records per-player stats for a completed Wavelength round.
 *
 * @param {string} guildId
 * @param {import('./state')} game
 * @param {object} scores  Output of computeScores() from reveal.js
 */
const recordRound = db.transaction((guildId, game, scores) => {
  const { guesserScores, clueGiverScore } = scores;

  // Clue Giver
  const cgId     = game.clueGiverId;
  const cgPlayer = game.players.get(cgId);
  if (cgPlayer) {
    stmtUpsertPlayer.run({ guild_id: guildId, user_id: cgId, username: cgPlayer.username });
    stmtIncrClueGiver.run({
      guild_id: guildId,
      user_id:  cgId,
      score:    clueGiverScore.total,
      synergy:  clueGiverScore.synergy > 0 ? 1 : 0,
    });
  }

  // Guessers
  for (const [userId, s] of guesserScores) {
    const player = game.players.get(userId);
    if (!player) continue;
    stmtUpsertPlayer.run({ guild_id: guildId, user_id: userId, username: player.username });
    stmtIncrGuesser.run({
      guild_id:  guildId,
      user_id:   userId,
      score:     s.total,
      bullseye:  s.tierKey === 'bullseye' ? 1 : 0,
    });
  }
});

/**
 * Returns all wavelength stat rows for a guild.
 * @param {string} guildId
 * @returns {Object.<string, object>}  userId → stats object
 */
function getGuildStats(guildId) {
  const rows = stmtGetGuild.all(guildId);
  const result = {};
  for (const row of rows) {
    result[row.user_id] = {
      username:           row.username,
      roundsPlayed:       row.rounds_played,
      roundsAsClueGiver:  row.rounds_as_clue_giver,
      totalScore:         row.total_score,
      bullseyes:          row.bullseyes,
      synergyBonuses:     row.synergy_bonuses,
    };
  }
  return result;
}

/** A player's stats row, or null. */
function getPlayer(guildId, userId) {
  return stmtGetPlayer.get(guildId, userId) ?? null;
}

/** Top 10 players in a guild by total score. */
function scoreboard(guildId) {
  return stmtScoreboard.all(guildId);
}


module.exports = { recordRound, getGuildStats, getPlayer, scoreboard };
