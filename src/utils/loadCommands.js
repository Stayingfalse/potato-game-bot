'use strict';

const fs = require('fs');
const path = require('path');
const { getGames } = require('../games/_core/registry');

/**
 * Every slash command the bot serves: the non-game commands in src/commands/
 * plus each registered game's command.
 * @returns {Array<{data: import('discord.js').SlashCommandBuilder, execute: Function}>}
 */
function loadCommands() {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const commands = fs.readdirSync(commandsPath)
    .filter(f => f.endsWith('.js'))
    .map(f => require(path.join(commandsPath, f)));
  commands.push(...getGames().map(game => game.command));
  return commands.filter(command => command.data && command.execute);
}

module.exports = { loadCommands };
