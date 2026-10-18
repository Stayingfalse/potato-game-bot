'use strict';

const createRepository = require('../_core/createRepository');
const ArticulateGameState = require('./state');

/** The game owns its table: it's created here the first time the game loads. */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS articulate_games (
    thread_id           TEXT PRIMARY KEY,
    guild_id            TEXT NOT NULL,
    channel_id          TEXT NOT NULL,
    host_id             TEXT NOT NULL,
    host_username       TEXT NOT NULL,
    message_id          TEXT,
    turn_message_id     TEXT,
    phase               TEXT NOT NULL DEFAULT 'lobby',
    players             TEXT NOT NULL DEFAULT '[]',
    options             TEXT NOT NULL DEFAULT '{}',
    teams               TEXT NOT NULL DEFAULT '[]',
    previous_teams      TEXT,
    draft               TEXT,
    current_team        INTEGER NOT NULL DEFAULT 0,
    turn_number         INTEGER NOT NULL DEFAULT 0,
    describer_ids       TEXT NOT NULL DEFAULT '[]',
    turn                TEXT,
    control             TEXT,
    spin_result         TEXT,
    next_team_override  INTEGER,
    used                TEXT NOT NULL DEFAULT '{}',
    winner_team         INTEGER,
    game_number         INTEGER NOT NULL DEFAULT 1,
    created_at          INTEGER NOT NULL
  );
`;

/**
 * When you add a column after the game has shipped, add it to SCHEMA *and*
 * here, so existing databases get it on startup.
 */
const ADDED_COLUMNS = {};

/** Adds any columns a table created by an older version is missing. Runs in a transaction. */
function migrate(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(articulate_games)').all().map(col => col.name));
  for (const [column, definition] of Object.entries(ADDED_COLUMNS)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE articulate_games ADD COLUMN ${definition}`);
  }
}

module.exports = createRepository({
  table: 'articulate_games',
  schema: SCHEMA,
  migrate,
  toRow: ArticulateGameState.toRow,
});
