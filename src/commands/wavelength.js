'use strict';

const {
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const { renderGameMessage } = require('../game/wavelength/render');
const WavelengthRepository = require('../db/WavelengthRepository');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wavelength')
    .setDescription('Wavelength — cooperative clue-giving party game')
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start a new Wavelength game (creates a game thread)'),
    )
    .addSubcommand(sub =>
      sub.setName('end').setDescription('End the Wavelength game running in this thread (must be used inside the game thread)'),
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const { wavelengthManager } = client;

    if (sub === 'start') {
      const { guildId, user, channel } = interaction;

      const alreadyActive = wavelengthManager.getGameByHost(guildId, user.id);
      if (alreadyActive) {
        return interaction.reply({
          content: `You already have an active **Wavelength** game — join it in <#${alreadyActive.threadId}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      let thread;
      try {
        thread = await channel.threads.create({
          name: `Wavelength 〰️ — ${user.username}`,
          type: ChannelType.PublicThread,
          autoArchiveDuration: 1440,
          reason: `Wavelength game started by ${user.username}`,
        });
        await thread.members.add(user.id);
      } catch {
        return interaction.reply({
          content:
            '❌ **Missing permissions.** The bot needs:\n' +
            '• `Create Public Threads`\n' +
            '• `Send Messages in Threads`\n' +
            '• `Manage Threads`',
          flags: MessageFlags.Ephemeral,
        });
      }

      const raceWinner = wavelengthManager.getGameByHost(guildId, user.id);
      if (raceWinner) {
        await thread.delete('Duplicate Wavelength game thread').catch(async () => {
          await thread.setArchived(true).catch(() => {});
        });
        return interaction.reply({
          content: `You already have an active **Wavelength** game — join it in <#${raceWinner.threadId}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const game = wavelengthManager.createGame(guildId, channel.id, thread.id, user.id, user.username);
      wavelengthManager.addPlayer(thread.id, user);

      const { components, flags, files } = await renderGameMessage(game);
      const msg = await thread.send({ components, flags, ...(files ? { files } : {}) }).catch(() => null);
      if (msg) {
        game.messageId = msg.id;
        WavelengthRepository.upsert(game);
      }

      return interaction.reply({
        content: `🎬 **Wavelength** game created by <@${user.id}>! Join in <#${thread.id}>.`,
      });
    }

    if (sub === 'end') {
      const game = wavelengthManager.getGame(interaction.channelId);
      if (!game) {
        return interaction.reply({
          content: 'This command must be used inside an active Wavelength game thread.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const canEnd = interaction.user.id === game.hostId
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads);
      if (!canEnd) {
        return interaction.reply({
          content: 'Only the game creator or a moderator with **Manage Threads** can end this game.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.reply({ content: '🛑 Ending the game…', flags: MessageFlags.Ephemeral });
      const { closeSession } = require('../game/wavelength/phases/endGame');
      await closeSession(game, client, `🛑 Game ended by <@${interaction.user.id}>.`);
    }
  },
};
