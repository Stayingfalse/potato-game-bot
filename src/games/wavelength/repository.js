'use strict';

const createRepository = require('../_core/createRepository');
const WavelengthGameState = require('./state');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS wavelength_games (
    thread_id            TEXT PRIMARY KEY,
    guild_id             TEXT NOT NULL,
    channel_id           TEXT NOT NULL,
    host_id              TEXT NOT NULL,
    host_username        TEXT NOT NULL,
    message_id           TEXT,
    round_message_id     TEXT,
    phase                TEXT NOT NULL DEFAULT 'lobby',
    players              TEXT NOT NULL DEFAULT '[]',
    clue_giver_id        TEXT,
    spectrum_options     TEXT NOT NULL DEFAULT '[]',
    chosen_spectrum      TEXT,
    target_position      INTEGER,
    clue                 TEXT,
    guesses              TEXT NOT NULL DEFAULT '{}',
    session_mode         TEXT,
    clue_order_state     TEXT,
    game_number          INTEGER NOT NULL DEFAULT 1,
    game_pace            TEXT NOT NULL DEFAULT 'realtime',
    auto_advance_rounds  INTEGER NOT NULL DEFAULT 0,
    session_history      TEXT NOT NULL DEFAULT '[]',
    created_at           INTEGER NOT NULL
  );
`;

/** Columns added after the table was first released, with the definition each is added with. */
const ADDED_COLUMNS = {
  session_mode: "session_mode TEXT",
  clue_order_state: "clue_order_state TEXT",
  game_pace: "game_pace TEXT NOT NULL DEFAULT 'realtime'",
  auto_advance_rounds: "auto_advance_rounds INTEGER NOT NULL DEFAULT 0",
  session_history: "session_history TEXT NOT NULL DEFAULT '[]'",
  round_message_id: "round_message_id TEXT",
};

/** Adds any columns that a table created by an older version is missing. */
function migrate(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(wavelength_games)').all().map(col => col.name));
  for (const [column, definition] of Object.entries(ADDED_COLUMNS)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE wavelength_games ADD COLUMN ${definition}`);
  }
}

module.exports = createRepository({
  table: 'wavelength_games',
  schema: SCHEMA,
  migrate,
  toRow: WavelengthGameState.toRow,
});
