'use strict';

const db = require('../../db/database');
const createRepository = require('../_core/createRepository');
const WerewordsGameState = require('./state');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS werewords_games (
    thread_id            TEXT PRIMARY KEY,
    guild_id             TEXT NOT NULL,
    channel_id           TEXT NOT NULL,
    host_id              TEXT NOT NULL,
    host_username        TEXT NOT NULL,
    message_id           TEXT,
    board_message_id     TEXT,
    phase                TEXT NOT NULL DEFAULT 'lobby',
    players              TEXT NOT NULL DEFAULT '[]',
    word                 TEXT,
    word_options         TEXT NOT NULL DEFAULT '[]',
    tokens               TEXT NOT NULL DEFAULT '{"yes_no":36,"maybe":12,"correct":1,"so_close_way_off":2}',
    time_left            INTEGER NOT NULL DEFAULT 240,
    votes                TEXT NOT NULL DEFAULT '{}',
    game_number          INTEGER NOT NULL DEFAULT 1,
    winner_guesser_user_id TEXT,
    created_at           INTEGER NOT NULL
  );
`;

/** Columns added after the table was first released, with the definition each is added with. */
const ADDED_COLUMNS = {
  session_mode: 'session_mode TEXT',
  voice_player_message_ids: 'voice_player_message_ids TEXT',
  ready_players: "ready_players TEXT NOT NULL DEFAULT '[]'",
  session_history: "session_history TEXT NOT NULL DEFAULT '[]'",
  response_stats_shown: 'response_stats_shown INTEGER NOT NULL DEFAULT 0',
  phase_ends_at: 'phase_ends_at INTEGER',
  werewolf_revealed: 'werewolf_revealed INTEGER NOT NULL DEFAULT 0',
};

/** Adds any columns that a table created by an older version is missing. */
function migrate(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(werewords_games)').all().map(col => col.name));
  for (const [column, definition] of Object.entries(ADDED_COLUMNS)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE werewords_games ADD COLUMN ${definition}`);
  }
}

const repository = createRepository({
  table: 'werewords_games',
  schema: SCHEMA,
  migrate,
  toRow: WerewordsGameState.toRow,
});

const stmtUpdateTimeLeft = db.prepare(`
  UPDATE werewords_games SET time_left = @time_left WHERE thread_id = @thread_id
`);

/**
 * Lightweight update for just the time_left column (called on every board refresh).
 * @param {string} threadId
 * @param {number} timeLeft
 */
function updateTimeLeft(threadId, timeLeft) {
  stmtUpdateTimeLeft.run({ thread_id: threadId, time_left: timeLeft });
}

module.exports = { ...repository, updateTimeLeft };
