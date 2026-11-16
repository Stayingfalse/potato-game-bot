'use strict';

/**
 * /leaderboard game:<game> — the top 10 players of a game in this server,
 * with the caller's own rank underneath if they are further down.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { NO_PINGS, gamesWithStats, findGameWithStats, buildLeaderboardEmbed } = require('../games/_core/statsDisplay');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top players of a game in this server')
    .addStringOption(option => option
      .setName('game')
      .setDescription('Which game')
      .setRequired(true)
      .addChoices(...gamesWithStats().map(game => ({ name: game.name, value: game.id })))),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'Leaderboards are kept per server — use this command in a server.', flags: MessageFlags.Ephemeral });
    }

    const game = findGameWithStats(interaction.options.getString('game'));
    if (!game) {
      return interaction.reply({ content: 'That game has no leaderboard.', flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({
      embeds: [buildLeaderboardEmbed(game, interaction.guildId, interaction.user.id)],
      allowedMentions: NO_PINGS,
    });
  },
};
