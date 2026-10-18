'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./loadCommands');

/**
 * Keeps Discord's copy of the bot's slash commands up to date.
 *
 * Every deploy records a fingerprint of the commands it sent (in the data
 * folder, next to the database). On startup the bot compares the current
 * commands with that fingerprint and only deploys when something changed, so
 * a new game or a changed command goes live with a restart, without running
 * `npm run deploy` by hand, and unchanged restarts don't use up Discord's daily
 * limit on command updates.
 */

/** Same default as src/db/database.js. */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const STATE_FILE = 'commands-deployed.json';

/** Every slash command as Discord receives it. */
function commandsBody() {
  return loadCommands().map(command => command.data.toJSON());
}

function fingerprint(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function readState(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Deploys the commands globally if they changed since the last deploy (or always, with `force`).
 *
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.clientId
 * @param {boolean} [options.force]  deploy even if nothing changed
 * @param {string} [options.dataDir]
 * @param {{ put: Function }} [options.rest]  for tests; a discord.js REST client by default
 * @returns {Promise<'deployed'|'unchanged'>}
 */
async function syncCommands({ token, clientId, force = false, dataDir = DATA_DIR, rest = null }) {
  const body = commandsBody();
  const hash = fingerprint(body);
  const last = readState(dataDir);
  if (!force && last?.hash === hash && last?.clientId === clientId) {
    console.log(`[Commands] ${body.length} slash command(s) unchanged — no deploy needed.`);
    return 'unchanged';
  }

  console.log(`[Commands] Deploying ${body.length} slash command(s) globally…`);
  await (rest ?? new REST({ version: '10' }).setToken(token)).put(Routes.applicationCommands(clientId), { body });
  writeState(dataDir, { clientId, hash, commands: body.map(command => command.name), deployedAt: new Date().toISOString() });
  console.log('[Commands] Deployed. Discord can take a minute to show changes.');
  return 'deployed';
}

module.exports = { syncCommands, commandsBody, fingerprint, STATE_FILE };
