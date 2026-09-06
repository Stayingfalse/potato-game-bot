'use strict';

const { SlashCommandBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { renderGameMessage } = require('../game/nmj/render');
const { MIN_PLAYERS } = require('../game/NoMoreJockeysManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nmj')
    .setDescription('No More Jockeys — celebrity elimination party game')
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start a new No More Jockeys game (creates a game thread)'),
    )
    .addSubcommand(sub =>
      sub.setName('end').setDescription('End the No More Jockeys game running in this thread (must be used inside the game thread)'),
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const { nmjManager } = client;

    if (sub === 'start') {
      const { guildId, user, channel } = interaction;

      // Tear down any existing game this user is hosting.
      const existing = nmjManager.getGameByCreator(guildId, user.id);
      if (existing) {
        nmjManager.deleteGame(existing.threadId);
        const oldThread = await client.channels.fetch(existing.threadId).catch(() => null);
        if (oldThread) {
          await oldThread.delete('Creator started a new No More Jockeys game').catch(async () => {
            await oldThread.setArchived(true).catch(() => {});
          });
        }
      }

      let thread;
      try {
        thread = await channel.threads.create({
          name: `No More Jockeys — ${user.username}`,
          type: ChannelType.PrivateThread,
          autoArchiveDuration: 1440,
          reason: `No More Jockeys game started by ${user.username}`,
        });
        await thread.members.add(user.id);
      } catch {
        return interaction.reply({
          content:
            '❌ **Missing permissions.** The bot needs:\n' +
            '• `Create Private Threads`\n' +
            '• `Send Messages in Threads`\n' +
            '• `Manage Threads`',
          flags: MessageFlags.Ephemeral,
        });
      }

      const game = nmjManager.createGame(guildId, channel.id, thread.id, user.id);
      nmjManager.addPlayer(thread.id, user);

      const { components, flags } = renderGameMessage(game);
      const msg = await thread.send({ components, flags }).catch(() => null);
      if (msg) {
        game.messageId = msg.id;
        nmjManager.saveGame(thread.id);
      }

      return interaction.reply({
        content: `🎬 **No More Jockeys** game created! Join in <#${thread.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'end') {
      const game = nmjManager.getGame(interaction.channelId);
      if (!game) {
        return interaction.reply({
          content: 'This command must be used inside an active No More Jockeys game thread.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const canEnd = interaction.user.id === game.creatorId
        || interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads);
      if (!canEnd) {
        return interaction.reply({
          content: 'Only the game creator or a moderator with **Manage Threads** can end this game.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.reply({ content: '🛑 Ending the game…', flags: MessageFlags.Ephemeral });
      const { endGame } = require('../events/interactionCreateNMJ');
      await endGame(game, client, `🛑 Game ended by <@${interaction.user.id}>.`);
      return;
    }
  },
};
