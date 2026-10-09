'use strict';

const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { renderGameMessage } = require('../game/wavelength/render');
const WavelengthRepository = require('../db/WavelengthRepository');
const { createGameThread, deleteThread, missingThreadPermissionsMessage } = require('../games/_core/threads');

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

      const thread = await createGameThread(channel, {
        name: `Wavelength 〰️ — ${user.username}`,
        isPrivate: false,
        autoArchiveDuration: 1440,
        reason: `Wavelength game started by ${user.username}`,
        hostId: user.id,
      });
      if (!thread) {
        return interaction.reply({
          content: missingThreadPermissionsMessage({ isPrivate: false }),
          flags: MessageFlags.Ephemeral,
        });
      }

      const raceWinner = wavelengthManager.getGameByHost(guildId, user.id);
      if (raceWinner) {
        await deleteThread(thread, 'Duplicate Wavelength game thread');
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
