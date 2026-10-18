'use strict';

/** Articulate player stats, per guild. */

const db = require('../../db/database');

db.exec(`
  CREATE TABLE IF NOT EXISTS articulate_player_stats (
    guild_id          TEXT NOT NULL,
    user_id           TEXT NOT NULL,
    username          TEXT NOT NULL DEFAULT '',
    games_played      INTEGER NOT NULL DEFAULT 0,
    games_won         INTEGER NOT NULL DEFAULT 0,
    turns_described   INTEGER NOT NULL DEFAULT 0,
    cards_described   INTEGER NOT NULL DEFAULT 0,
    fouls             INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const stmtDescribed = db.prepare(`
  INSERT INTO articulate_player_stats (guild_id, user_id, username, turns_described, cards_described, fouls)
  VALUES (@guild_id, @user_id, @username, 1, @cards, @fouls)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    username        = excluded.username,
    turns_described = turns_described + 1,
    cards_described = cards_described + excluded.cards_described,
    fouls           = fouls + excluded.fouls
`);

const stmtPlayed = db.prepare(`
  INSERT INTO articulate_player_stats (guild_id, user_id, username, games_played, games_won)
  VALUES (@guild_id, @user_id, @username, 1, @won)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    username     = excluded.username,
    games_played = games_played + 1,
    games_won    = games_won + excluded.games_won
`);

const stmtGetPlayer = db.prepare('SELECT * FROM articulate_player_stats WHERE guild_id = ? AND user_id = ?');

const stmtScoreboard = db.prepare(`
  SELECT user_id, username, games_played, games_won, turns_described, cards_described, fouls,
         CASE WHEN turns_described > 0 THEN ROUND(1.0 * cards_described / turns_described, 1) ELSE 0 END AS avg_cards
  FROM articulate_player_stats
  WHERE guild_id = ? AND (games_played > 0 OR turns_described > 0)
  ORDER BY games_won DESC, cards_described DESC
  LIMIT 10
`);

/** Records the describers' timed turn: cards their team got, and whether a foul was called. */
const recordTurn = db.transaction(game => {
  if (!game.turn?.endsAt) return; // no timed part (a Control round on the finish)
  for (const userId of game.describerIds) {
    stmtDescribed.run({
      guild_id: game.guildId,
      user_id: userId,
      username: game.players.get(userId)?.username ?? '',
      cards: game.turn.foulBy ? 0 : game.turn.correct.length,
      fouls: game.turn.foulBy ? 1 : 0,
    });
  }
});

/** Records a finished game for every player. */
const recordGame = db.transaction(game => {
  for (const [i, team] of game.teams.entries()) {
    for (const userId of team.playerIds) {
      stmtPlayed.run({
        guild_id: game.guildId,
        user_id: userId,
        username: game.players.get(userId)?.username ?? '',
        won: i === game.winnerTeam ? 1 : 0,
      });
    }
  }
});

/** A player's stats row, or null. */
function getPlayer(guildId, userId) {
  return stmtGetPlayer.get(guildId, userId) ?? null;
}

/** Top 10 players in a guild by games won. */
function scoreboard(guildId) {
  return stmtScoreboard.all(guildId);
}

module.exports = { recordTurn, recordGame, getPlayer, scoreboard };
