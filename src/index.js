require('dotenv').config();

// Initialise the database (creates schema + migrates stats.json) before
// anything else so all repositories are ready when the managers start.
require('./db/database');

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const BirthdayManager = require('./game/BirthdayManager');
const { getGames } = require('./games/_core/registry');
const { loadCommands } = require('./utils/loadCommands');

// ── Process-level crash guards ─────────────────────────────────────────────
// Prevent Node from exiting on unhandled async errors or synchronous throws.
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Privileged — enable in Discord Dev Portal → Bot → Privileged Gateway Intents
    GatewayIntentBits.GuildMembers,   // Privileged — needed for welcome automation (guildMemberAdd / role grants)
  ],
});

// ── Discord client error guard ─────────────────────────────────────────────
// Catches connection-level errors emitted by the discord.js client.
client.on('error', (err) => {
  console.error('[Discord Client Error]', err);
});

client.commands = new Collection();
client.birthdayManager = new BirthdayManager();

// ── Games ──────────────────────────────────────────────────────────────────────
// Every folder in src/games/ is a game (see src/games/_core/registry.js). Each
// game's manager is available as client.games.get(id).manager, and also under
// the game's clientKey (e.g. client.nmjManager), which the game's code uses.
client.games = new Collection();
for (const game of getGames()) {
  const manager = game.createManager();
  client.games.set(game.id, { game, manager });
  client[game.clientKey] = manager;
}

// Conditionally start the admin dashboard server.
// Set DASHBOARD_ENABLED=true and provide dashboard OAuth client secret env vars to activate.
if (process.env.DASHBOARD_ENABLED === 'true') {
  try {
    const DashboardServer = require('./dashboard/DashboardServer');
    const db = require('./db/database');
    const dashPort = parseInt(process.env.DASHBOARD_PORT || '3200', 10);
    const dashServer = new DashboardServer({ db, client, port: dashPort });
    dashServer.start();
  } catch (err) {
    console.error('[Dashboard] Failed to start:', err);
  }
}

// ── Load commands ──────────────────────────────────────────────────────────────
for (const command of loadCommands()) {
  client.commands.set(command.data.name, command);
}

// ── Load events ────────────────────────────────────────────────────────────────
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  // Append the client instance so every event handler can access it.
  // Wrap in a catch so errors from any event handler never crash the process.
  const handler = (...args) => Promise.resolve(event.execute(...args, client)).catch((err) => {
    console.error(`[Event handler error: ${event.name}]`, err);
  });
  if (event.once) {
    client.once(event.name, handler);
  } else {
    client.on(event.name, handler);
  }
}

client.login(process.env.DISCORD_TOKEN);
