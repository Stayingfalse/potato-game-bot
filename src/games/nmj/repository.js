'use strict';

const createRepository = require('../_core/createRepository');
const NoMoreJockeysGameState = require('./state');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS nmj_games (
    thread_id             TEXT PRIMARY KEY,
    guild_id              TEXT NOT NULL,
    channel_id            TEXT NOT NULL,
    host_id               TEXT NOT NULL,
    host_username         TEXT NOT NULL DEFAULT '',
    message_id            TEXT,
    phase                 TEXT NOT NULL DEFAULT 'lobby',
    players               TEXT NOT NULL DEFAULT '[]',
    eliminated_players    TEXT NOT NULL DEFAULT '[]',
    current_player_index  INTEGER NOT NULL DEFAULT 0,
    banned_categories     TEXT NOT NULL DEFAULT '[]',
    moves                 TEXT NOT NULL DEFAULT '[]',
    pending_move          TEXT,
    name_another_required INTEGER NOT NULL DEFAULT 0,
    challenge_state       TEXT,
    challenge_counts      TEXT NOT NULL DEFAULT '{}',
    accepted_players      TEXT NOT NULL DEFAULT '[]',
    created_at            INTEGER NOT NULL
  );
`;

/**
 * Upgrades an nmj_games table from the original layout, which stored the host as
 * `creator_id`, the phase as `status` (with 'recruiting' for the lobby) and
 * `players` as an array of user IDs. Saved games are converted in place so games
 * in progress carry on after the upgrade.
 */
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(nmj_games)').all().map(c => c.name);
  if (!columns.includes('creator_id')) return;

  const rows = db.prepare('SELECT * FROM nmj_games').all();
  db.exec('ALTER TABLE nmj_games RENAME TO nmj_games_pre_host_id');
  db.exec(SCHEMA);

  const insert = db.prepare(`
    INSERT INTO nmj_games
      (thread_id, guild_id, channel_id, host_id, host_username, message_id, phase,
       players, eliminated_players, current_player_index, banned_categories, moves,
       pending_move, name_another_required, challenge_state, challenge_counts,
       accepted_players, created_at)
    VALUES
      (@thread_id, @guild_id, @channel_id, @host_id, '', @message_id, @phase,
       @players, @eliminated_players, @current_player_index, @banned_categories, @moves,
       @pending_move, @name_another_required, @challenge_state, @challenge_counts,
       @accepted_players, @created_at)
  `);
  for (const row of rows) {
    const playerIds = JSON.parse(row.players || '[]');
    insert.run({
      ...row,
      host_id: row.creator_id,
      phase: row.status === 'recruiting' ? 'lobby' : row.status,
      players: JSON.stringify(playerIds.map(id => ({ id, username: null }))),
    });
  }

  db.exec('DROP TABLE nmj_games_pre_host_id');
  console.log(`[DB] Upgraded nmj_games to the host_id/phase layout (${rows.length} saved game(s) converted).`);
}

module.exports = createRepository({
  table: 'nmj_games',
  schema: SCHEMA,
  migrate,
  toRow: NoMoreJockeysGameState.toRow,
});
