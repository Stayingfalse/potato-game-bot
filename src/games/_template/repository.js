'use strict';

const createRepository = require('../_core/createRepository');
const HighRollGameState = require('./state');

/** The game owns its table: it's created here the first time the game loads. */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS highroll_games (
    thread_id      TEXT PRIMARY KEY,
    guild_id       TEXT NOT NULL,
    channel_id     TEXT NOT NULL,
    host_id        TEXT NOT NULL,
    host_username  TEXT NOT NULL,
    message_id     TEXT,
    phase          TEXT NOT NULL DEFAULT 'lobby',
    players        TEXT NOT NULL DEFAULT '[]',
    rolls          TEXT NOT NULL DEFAULT '{}',
    phase_ends_at  INTEGER,
    game_number    INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL
  );
`;

/**
 * When you add a column after the game has shipped, add it to SCHEMA *and*
 * here, so existing databases get it on startup, e.g.
 *   best_streak: 'best_streak INTEGER NOT NULL DEFAULT 0',
 */
const ADDED_COLUMNS = {};

/** Adds any columns a table created by an older version is missing. Runs in a transaction. */
function migrate(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(highroll_games)').all().map(col => col.name));
  for (const [column, definition] of Object.entries(ADDED_COLUMNS)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE highroll_games ADD COLUMN ${definition}`);
  }
}

module.exports = createRepository({
  table: 'highroll_games',
  schema: SCHEMA,
  migrate,
  toRow: HighRollGameState.toRow,
});
