'use strict';

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildLobbyEmbed, buildLobbyComponents } = require('./phases/lobby');
const WerewordsRepository = require('./repository');
const { createGameThread, deleteThread, missingThreadPermissionsMessage } = require('../_core/threads');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('werewords')
    .setDescription('Werewords — guess the secret word, then find the Werewolf')
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start a new Werewords game (creates a game thread)'),
    )
    .addSubcommand(sub =>
      sub.setName('end').setDescription('End the Werewords session running in this thread (must be used inside the game thread)'),
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const { werewordsManager } = client;

    if (sub === 'start') {
      const { guildId, user, channel } = interaction;

      const alreadyActive = werewordsManager.getGameByHost(guildId, user.id);
      if (alreadyActive) {
        return interaction.reply({
          content: `You already have an active **Werewords** game — join it in <#${alreadyActive.threadId}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const thread = await createGameThread(channel, {
        name: `Werewords 🔮 — ${user.username}`,
        isPrivate: false,
        autoArchiveDuration: 1440,
        reason: `Werewords game started by ${user.username}`,
        hostId: user.id,
      });
      if (!thread) {
        return interaction.reply({
          content: missingThreadPermissionsMessage({ isPrivate: false }),
          flags: MessageFlags.Ephemeral,
        });
      }

      // Creating the thread took a network round-trip, during which a duplicate
      // interaction may have registered a game already. If so, drop this thread.
      const raceWinner = werewordsManager.getGameByHost(guildId, user.id);
      if (raceWinner) {
        await deleteThread(thread, 'Duplicate Werewords game thread');
        return interaction.reply({
          content: `You already have an active **Werewords** game — join it in <#${raceWinner.threadId}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const game = werewordsManager.createGame(guildId, channel.id, thread.id, user.id, user.username);
      werewordsManager.addPlayer(thread.id, user);

      const msg = await thread.send({
        embeds: [buildLobbyEmbed(game)],
        components: buildLobbyComponents(),
      }).catch(() => null);
      if (msg) {
        game.messageId = msg.id;
        WerewordsRepository.upsert(game);
      }

      return interaction.reply({
        content: `🎬 **Werewords** game created by <@${user.id}>! Join in <#${thread.id}>.`,
      });
    }

    if (sub === 'end') {
      const game = werewordsManager.getGame(interaction.channelId);
      if (!game) {
        return interaction.reply({
          content: 'This command must be used inside an active Werewords game thread.',
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

      await interaction.reply({ content: '🛑 Ending the session…', flags: MessageFlags.Ephemeral });
      const { closeSession } = require('./handlers');
      await closeSession(game, client, `🛑 Session ended by <@${interaction.user.id}>.`);
    }
  },
};
