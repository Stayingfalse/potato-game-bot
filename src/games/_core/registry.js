'use strict';

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..');

/**
 * Every game lives in its own folder under src/games/ with an index.js manifest:
 *
 * {
 *   id,                 // also the dashboard feature id; must be unique
 *   name,               // display name
 *   order,              // optional; sort position in lists such as the dashboard
 *   prefix,             // customId prefix for the game's buttons and modals, e.g. 'nmj_'
 *   clientKey,          // property on `client` that holds the game's manager
 *   createManager(),    // returns the game's manager instance
 *   command,            // slash command module: { data, execute }
 *   handleInteraction(interaction, client),  // buttons/modals whose customId has `prefix`
 *   restore(client),    // optional; reloads the game's saved games on startup
 * }
 *
 * Folders starting with "_" (such as _core) are not games.
 */
const REQUIRED_FIELDS = ['id', 'name', 'prefix', 'clientKey', 'createManager', 'command', 'handleInteraction'];

let games = null;

function loadGames() {
  const loaded = fs.readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .filter(entry => fs.existsSync(path.join(GAMES_DIR, entry.name, 'index.js')))
    .map(entry => {
      const game = require(path.join(GAMES_DIR, entry.name, 'index.js'));
      const missing = REQUIRED_FIELDS.filter(field => game[field] == null);
      if (missing.length > 0) {
        throw new Error(`Game "${entry.name}" is missing manifest field(s): ${missing.join(', ')}`);
      }
      return game;
    })
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id));

  for (const [i, game] of loaded.entries()) {
    for (const other of loaded.slice(i + 1)) {
      if (game.id === other.id) throw new Error(`Two games share the id "${game.id}"`);
      if (game.prefix.startsWith(other.prefix) || other.prefix.startsWith(game.prefix)) {
        throw new Error(`Games "${game.id}" and "${other.id}" have overlapping customId prefixes`);
      }
    }
  }
  return loaded;
}

/** All registered games, in display order. */
function getGames() {
  games ??= loadGames();
  return games;
}

/** The game whose prefix matches a button/modal customId, or null. */
function findGameByCustomId(customId) {
  return getGames().find(game => customId.startsWith(game.prefix)) ?? null;
}

module.exports = { getGames, findGameByCustomId };
