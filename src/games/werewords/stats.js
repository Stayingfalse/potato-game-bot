'use strict';

/**
 * Werewords player stats — replaces the old file-based StatsManager.
 * Public API is intentionally API-compatible with the old StatsManager so
 * call sites only need a require-path change.
 *
 * The werewords_player_stats table is created in db/database.js, because the
 * one-off stats.json import there writes into it.
 */

const db = require('../../db/database');
const { ROLES, isDemon, getEffectiveRole } = require('./roles');

// ── Win/loss mapping ───────────────────────────────────────────────────────────

const DEMON_WIN_OUTCOMES = new Set(['werewolf_time', 'werewolf_tokens', 'werewolf_seer', 'werewolf_vote']);
const TOWNSFOLK_WIN_OUTCOMES = new Set(['villagers_word', 'villagers_vote']);

// ── Prepared statements ────────────────────────────────────────────────────────

const stmtUpsertPlayer = db.prepare(`
  INSERT INTO werewords_player_stats
    (guild_id, user_id, username, games_played, wins, losses,
     role_wordsmith, role_demon, role_librarian, role_townsfolk,
     correct_guesses, times_identified_as_seer)
  VALUES
    (@guild_id, @user_id, @username, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    username = excluded.username
`);

const stmtIncrGame = db.prepare(`
  UPDATE werewords_player_stats
  SET games_played = games_played + 1,
      wins         = wins   + @won,
      losses       = losses + @lost
  WHERE guild_id = @guild_id AND user_id = @user_id
`);

const stmtIncrRole = db.prepare(`
  UPDATE werewords_player_stats
  SET role_wordsmith = role_wordsmith + @wordsmith,
      role_demon     = role_demon     + @demon,
      role_librarian = role_librarian + @librarian,
      role_townsfolk = role_townsfolk + @townsfolk
  WHERE guild_id = @guild_id AND user_id = @user_id
`);

const stmtIncrCorrectGuess = db.prepare(`
  UPDATE werewords_player_stats
  SET correct_guesses = correct_guesses + 1
  WHERE guild_id = @guild_id AND user_id = @user_id
`);

const stmtIncrSeer = db.prepare(`
  UPDATE werewords_player_stats
  SET times_identified_as_seer = times_identified_as_seer + 1
  WHERE guild_id = @guild_id AND user_id = @user_id
`);

const stmtGetGuild = db.prepare(`
  SELECT * FROM werewords_player_stats WHERE guild_id = ?
`);

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Records the result of one werewords game (maps to the old StatsManager API).
 *
 * @param {string} guildId
 * @param {Map<string, {id: string, username: string, role: string, secretRole?: string|null}>} players
 * @param {string} outcome
 * @param {string|null} winnerGuesserUserId
 * @param {string|null} seerVictimUserId
 */
const recordGame = db.transaction((guildId, players, outcome, winnerGuesserUserId, seerVictimUserId) => {
  const demonWin = DEMON_WIN_OUTCOMES.has(outcome);
  const townsfolkWin = TOWNSFOLK_WIN_OUTCOMES.has(outcome);

  for (const player of players.values()) {
    // Ensure row exists.
    stmtUpsertPlayer.run({ guild_id: guildId, user_id: player.id, username: player.username });

    const won = demonWin ? (isDemon(player) ? 1 : 0) : (townsfolkWin ? (isDemon(player) ? 0 : 1) : 0);
    stmtIncrGame.run({ guild_id: guildId, user_id: player.id, won, lost: 1 - won });

    const effectiveRole = getEffectiveRole(player);
    stmtIncrRole.run({
      guild_id:   guildId,
      user_id:    player.id,
      wordsmith:  player.role === ROLES.MAYOR      ? 1 : 0,
      demon:      effectiveRole === ROLES.WEREWOLF ? 1 : 0,
      librarian:  effectiveRole === ROLES.SEER     ? 1 : 0,
      townsfolk:  effectiveRole === ROLES.VILLAGER ? 1 : 0,
    });

    if (winnerGuesserUserId && player.id === winnerGuesserUserId) {
      stmtIncrCorrectGuess.run({ guild_id: guildId, user_id: player.id });
    }

    if (seerVictimUserId && player.id === seerVictimUserId) {
      stmtIncrSeer.run({ guild_id: guildId, user_id: player.id });
    }
  }
});

/**
 * Returns guild stats in the same shape as the old StatsManager so existing
 * consumers (buildSessionSummaryEmbed) work without changes.
 *
 * @param {string} guildId
 * @returns {Object.<string, object>}  userId → stats object
 */
function getGuildStats(guildId) {
  const rows = stmtGetGuild.all(guildId);
  const result = {};
  for (const row of rows) {
    result[row.user_id] = {
      username:              row.username,
      gamesPlayed:           row.games_played,
      wins:                  row.wins,
      losses:                row.losses,
      rolesPlayed: {
        Wordsmith: row.role_wordsmith,
        Demon:     row.role_demon,
        Librarian: row.role_librarian,
        Townsfolk: row.role_townsfolk,
      },
      correctGuesses:         row.correct_guesses,
      timesIdentifiedAsSeer:  row.times_identified_as_seer,
    };
  }
  return result;
}

const stmtGetPlayer = db.prepare('SELECT * FROM werewords_player_stats WHERE guild_id = ? AND user_id = ?');

const stmtScoreboard = db.prepare(`
  SELECT user_id, username, games_played, wins, losses,
         CASE WHEN games_played > 0 THEN ROUND(100.0 * wins / games_played, 1) ELSE 0 END AS win_pct
  FROM werewords_player_stats
  WHERE guild_id = ? AND games_played > 0
  ORDER BY wins DESC, win_pct DESC
  LIMIT 10
`);

/** A player's stats row, or null. */
function getPlayer(guildId, userId) {
  return stmtGetPlayer.get(guildId, userId) ?? null;
}

/** Top 10 players in a guild by wins. */
function scoreboard(guildId) {
  return stmtScoreboard.all(guildId);
}

/** One sentence about a player's record, for the AI's user context; null if they haven't played. */
function describe(row) {
  if (!row?.games_played) return null;
  const pct = Math.round((100 * row.wins) / row.games_played);
  return `Werewords record: ${row.games_played} games, ${row.wins} wins (${pct}%).`;
}

module.exports = { recordGame, getGuildStats, getPlayer, scoreboard, describe };
