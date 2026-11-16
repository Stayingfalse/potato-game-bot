'use strict';

/**
 * /stats [game] [user] — a player's game stats in this server.
 *
 * Defaults to the caller, and to every game they have played (one section per
 * game). Only the caller sees the reply.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { NO_PINGS, gamesWithStats, findGameWithStats, buildStatsEmbed } = require('../games/_core/statsDisplay');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show a player\'s game stats in this server')
    .addStringOption(option => option
      .setName('game')
      .setDescription('Only this game (default: every game played)')
      .addChoices(...gamesWithStats().map(game => ({ name: game.name, value: game.id }))))
    .addUserOption(option => option
      .setName('user')
      .setDescription('Whose stats to show (default: yours)')),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'Stats are kept per server — use this command in a server.', flags: MessageFlags.Ephemeral });
    }

    const gameId = interaction.options.getString('game');
    const target = interaction.options.getUser('user') ?? interaction.user;
    const chosen = gameId ? findGameWithStats(gameId) : null;
    const games = chosen ? [chosen] : gamesWithStats();

    return interaction.reply({
      embeds: [buildStatsEmbed(games, interaction.guildId, target.id, target.id === interaction.user.id)],
      allowedMentions: NO_PINGS,
      flags: MessageFlags.Ephemeral,
    });
  },
};
