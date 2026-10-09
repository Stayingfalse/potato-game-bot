'use strict';

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { updateGameMessage, closeSession } = require('./flow');
const { createGameThread, deleteThread, missingThreadPermissionsMessage } = require('../_core/threads');

const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('highroll')
    .setDescription('High Roll — everyone rolls once, the highest roll wins')
    .addSubcommand(sub => sub.setName('start').setDescription('Start a new High Roll game (creates a game thread)'))
    .addSubcommand(sub => sub.setName('end').setDescription('End the High Roll game in this thread')),

  async execute(interaction, client) {
    const manager = client.highRollManager;
    const { guildId, user, channel } = interaction;

    if (interaction.options.getSubcommand() === 'end') {
      const game = manager.getGame(interaction.channelId);
      if (!game) return interaction.reply(ephemeral('This command must be used inside an active High Roll game thread.'));
      const canEnd = user.id === game.hostId || interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads);
      if (!canEnd) return interaction.reply(ephemeral('Only the game creator or a moderator with **Manage Threads** can end this game.'));
      await interaction.reply(ephemeral('🛑 Ending the game…'));
      return closeSession(game, client, `🛑 Game ended by <@${user.id}>.`);
    }

    // One game per host: point them at the one they already have.
    const existing = manager.getGameByHost(guildId, user.id);
    if (existing) return interaction.reply(ephemeral(`You already have an active **High Roll** game — join it in <#${existing.threadId}>.`));

    const thread = await createGameThread(channel, {
      name: `High Roll 🎲 — ${user.username}`,
      isPrivate: false,
      autoArchiveDuration: 1440,
      reason: `High Roll game started by ${user.username}`,
      hostId: user.id,
    });
    if (!thread) return interaction.reply(ephemeral(missingThreadPermissionsMessage({ isPrivate: false })));

    // Creating the thread took a round-trip; a duplicate interaction may have won the race.
    const raceWinner = manager.getGameByHost(guildId, user.id);
    if (raceWinner) {
      await deleteThread(thread, 'Duplicate High Roll game thread');
      return interaction.reply(ephemeral(`You already have an active **High Roll** game — join it in <#${raceWinner.threadId}>.`));
    }

    const game = manager.createGame(guildId, channel.id, thread.id, user.id, user.username);
    manager.addPlayer(thread.id, user);
    await updateGameMessage(game, client);

    return interaction.reply({ content: `🎲 **High Roll** game created by <@${user.id}>! Join in <#${thread.id}>.` });
  },
};
