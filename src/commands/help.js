'use strict';

/**
 * /help — what the bot can do.
 *
 *   /help              – every game (one-line description, player count, start
 *                        command) plus the birthday commands
 *   /help game:<game>  – that game's how-to-play text
 *
 * Games come from the registry, so a new game with a `howToPlay` manifest
 * field appears here without changes to this file.
 */

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { getGames } = require('../games/_core/registry');
const { howToPlayText } = require('../games/_core/lobby');

const HELP_COLOR = 0x5865F2; // Discord blurple

const BIRTHDAY_COMMANDS = [
  '`/birthday set <date>` — set your birthday (dd/mm or dd/mm/yyyy)',
  '`/birthday list` — the next 3 upcoming birthdays (`all:True` for everyone)',
  '`/birthday delete` — remove your birthday',
  'Admins: `/birthday start`, `stop`, `setchannel` and `resend` control the announcements',
].join('\n');

const startCommand = game => `/${game.command.data.name} start`;

/** One embed field per game: description, player count and how to start it. */
function gameField(game) {
  const how = game.howToPlay;
  const lines = [];
  if (how?.summary) lines.push(how.summary);
  lines.push(`${how?.players ? `👥 ${how.players} players  •  ` : ''}▶️ \`${startCommand(game)}\``);
  return { name: `${how?.emoji ? `${how.emoji} ` : ''}${game.name}`, value: lines.join('\n') };
}

function buildOverviewEmbed(games = getGames()) {
  return new EmbedBuilder()
    .setTitle('🎮  Potato Game Bot — Help')
    .setDescription(
      'Each game runs in its own thread. Start one with its command, then everyone presses **Join** in the lobby.\n' +
      'For the rules, use `/help game:<name>` or press **📖 How to play** in any lobby.',
    )
    .addFields(
      ...games.map(gameField),
      { name: '🎂 Birthdays', value: BIRTHDAY_COMMANDS },
    )
    .setColor(HELP_COLOR)
    .setFooter({ text: 'Use /<game> end inside a game thread to end it early.' });
}

function buildGameEmbed(game) {
  const embed = new EmbedBuilder()
    .setColor(HELP_COLOR)
    .setFooter({ text: `Start a game with ${startCommand(game)}` });
  if (game.howToPlay) return embed.setDescription(howToPlayText(game));
  return embed.setTitle(game.name).setDescription('No how-to-play has been written for this game yet.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List the games and commands, or show how to play a game')
    .addStringOption(opt =>
      opt
        .setName('game')
        .setDescription('Show how to play this game')
        .setRequired(false)
        .addChoices(...getGames().map(game => ({ name: game.name, value: game.id }))),
    ),

  async execute(interaction) {
    const gameId = interaction.options.getString('game');
    const game = gameId ? getGames().find(g => g.id === gameId) : null;
    if (gameId && !game) {
      return interaction.reply({ content: 'I don\'t know that game. Use `/help` to see the list.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      embeds: [game ? buildGameEmbed(game) : buildOverviewEmbed()],
      flags: MessageFlags.Ephemeral,
    });
  },

  buildOverviewEmbed,
  buildGameEmbed,
};
