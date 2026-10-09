'use strict';

const db = require('../../db/database');

/**
 * Builds the standard game repository for a table keyed by thread_id.
 *
 * `toRow(game)` maps a game state to the table's columns; its keys are the
 * columns written on every save. `created_at` is only written on insert.
 *
 * @param {object} options
 * @param {string} options.table
 * @param {(game: object) => Record<string, unknown>} options.toRow
 * @returns {{upsert: (game: object) => void, getAll: () => object[], remove: (threadId: string) => void}}
 */
function createRepository({ table, toRow }) {
  const stmtGetAll = db.prepare(`SELECT * FROM ${table}`);
  const stmtDelete = db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`);

  // The upsert is built from the first row's keys, so the column list lives
  // in exactly one place: the game's toRow().
  let stmtUpsert = null;
  function prepareUpsert(columns) {
    const updated = columns.filter(c => c !== 'thread_id' && c !== 'created_at');
    return db.prepare(`
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${columns.map(c => `@${c}`).join(', ')})
      ON CONFLICT(thread_id) DO UPDATE SET
        ${updated.map(c => `${c} = excluded.${c}`).join(',\n        ')}
    `);
  }

  return {
    upsert(game) {
      const row = toRow(game);
      stmtUpsert ??= prepareUpsert(Object.keys(row));
      stmtUpsert.run(row);
    },
    getAll() {
      return stmtGetAll.all();
    },
    remove(threadId) {
      stmtDelete.run(threadId);
    },
  };
}

module.exports = createRepository;
