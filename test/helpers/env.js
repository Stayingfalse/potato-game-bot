'use strict';

/**
 * Require this first in every test file, before anything from src/.
 *
 * Each test file runs in its own process, and this gives that process its own
 * temporary data folder, so tests never touch data/bot.db or migrate the import
 * files in data/. The folder is removed when the process exits.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-bot-test-'));
delete process.env.GUILD_ID; // disables the one-off birthday import
process.on('exit', () => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const SRC = path.join(__dirname, '..', '..', 'src');

/** Requires a module by its path inside src/, e.g. src('games/nmj/manager'). */
function src(modulePath) {
  return require(path.join(SRC, modulePath));
}

module.exports = { SRC, src };
