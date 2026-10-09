'use strict';

const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const {
  createGameThread,
  deleteThread,
  fetchChannel,
  missingThreadPermissionsMessage,
} = require('../games/_core/threads');

function buildLobbyEmbed(game) {
  const players = [...game.players.values()]
    .map((p, i) => `\`${String(i + 1).padStart(2, '0')}.\` <@${p.id}>`)
    .join('\n') || '*No players yet — be the first to join!*';

  return new EmbedBuilder()
    .setTitle('🐄 Herd Mentality — Lobby')
    .setDescription(
      'Think like the herd! Answer questions to match the majority. ' +
      'The player whose answer matches the most others scores a point. ' +
      'First to **8 points** (without the 🐄 pink cow) wins!',
    )
    .addFields(
      { name: `Players (${game.players.size} / 12)`, value: players },
      { name: '🧵 Game Thread', value: `<#${game.threadId}>` },
    )
    .setColor(0xF4A261)
    .setFooter({ text: `Host: @${game.hostUsername}  •  Minimum 2 players required` })
    .setTimestamp();
}

function buildLobbyComponents(threadId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hm_join_${threadId}`).setLabel('Join').setEmoji('✋').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hm_leave_${threadId}`).setLabel('Leave').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`hm_start_${threadId}`).setLabel('Start Game').setEmoji('▶️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`hm_cancel_${threadId}`).setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
    ),
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('herdmentality')
    .setDescription('Start a new Herd Mentality game lobby in this channel'),

  async execute(interaction, client) {
    const { guildId, user, channel } = interaction;
    const { herdMentalityManager } = client;

    const existing = herdMentalityManager.getGameByHost(guildId, user.id);
    if (existing) {
      herdMentalityManager.deleteGame(existing.threadId);
      await deleteThread(await fetchChannel(client, existing.threadId), 'Host started a new Herd Mentality game');
    }

    const thread = await createGameThread(channel, {
      name: `Herd Mentality 🐄 — ${user.username}`,
      isPrivate: true,
      autoArchiveDuration: 60,
      reason: `Herd Mentality game started by ${user.username}`,
      hostId: user.id,
    });
    if (!thread) {
      return interaction.reply({
        content: missingThreadPermissionsMessage({ isPrivate: true }),
        flags: MessageFlags.Ephemeral,
      });
    }

    const game = herdMentalityManager.createGame(guildId, channel.id, thread.id, user.id, user.username);
    herdMentalityManager.addPlayer(thread.id, user);

    const { resource } = await interaction.reply({
      embeds: [buildLobbyEmbed(game)],
      components: buildLobbyComponents(thread.id),
      withResponse: true,
    });

    game.messageId = resource.message.id;
    client.herdMentalityManager.saveGame(game.threadId);
  },

  buildLobbyEmbed,
  buildLobbyComponents,
};
