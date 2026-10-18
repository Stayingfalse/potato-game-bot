'use strict';

const createRepository = require('../_core/createRepository');
const HuesCluesGameState = require('./state');

/** The game owns its table: it's created here the first time the game loads. */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS huesclues_games (
    thread_id             TEXT PRIMARY KEY,
    guild_id              TEXT NOT NULL,
    channel_id            TEXT NOT NULL,
    host_id               TEXT NOT NULL,
    host_username         TEXT NOT NULL,
    message_id            TEXT,
    turn_message_id       TEXT,
    phase                 TEXT NOT NULL DEFAULT 'lobby',
    players               TEXT NOT NULL DEFAULT '[]',
    session_mode          TEXT,
    auto_advance_rounds   INTEGER NOT NULL DEFAULT 1,
    turn_order            TEXT NOT NULL DEFAULT '[]',
    turn_index            INTEGER NOT NULL DEFAULT 0,
    clue_turns_by_player  TEXT NOT NULL DEFAULT '{}',
    cue_giver_id          TEXT,
    card                  TEXT NOT NULL DEFAULT '[]',
    target_index          INTEGER,
    clues                 TEXT NOT NULL DEFAULT '[]',
    guess_round           INTEGER NOT NULL DEFAULT 1,
    tokens                TEXT NOT NULL DEFAULT '{}',
    session_history       TEXT NOT NULL DEFAULT '[]',
    advance_at            INTEGER,
    game_number           INTEGER NOT NULL DEFAULT 1,
    created_at            INTEGER NOT NULL
  );
`;

/**
 * When you add a column after the game has shipped, add it to SCHEMA *and*
 * here, so existing databases get it on startup.
 */
const ADDED_COLUMNS = {};

/** Adds any columns a table created by an older version is missing. Runs in a transaction. */
function migrate(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(huesclues_games)').all().map(col => col.name));
  for (const [column, definition] of Object.entries(ADDED_COLUMNS)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE huesclues_games ADD COLUMN ${definition}`);
  }
}

module.exports = createRepository({
  table: 'huesclues_games',
  schema: SCHEMA,
  migrate,
  toRow: HuesCluesGameState.toRow,
});
