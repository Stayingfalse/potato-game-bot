'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function renderLobbyText(game) {
  const playerList = game.players.size === 0
    ? '*No players yet — be the first to join!*'
    : [...game.players.values()].map(p => `• ${p.username}`).join('\n');

  return [
    '## 〰️ Wavelength — Lobby Open',
    `**Host:** <@${game.hostId}>`,
    '',
    `**Players (${game.players.size}/20):**`,
    playerList,
    '',
    'A random **Clue Giver** will be chosen when the game starts.',
    'The Clue Giver picks a spectrum and gives a clue. Everyone else nudges a marker to guess where they think the target sits!',
    '',
    '*Minimum 2 players to start.*',
  ].join('\n');
}

function buildLobbyComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_join')
        .setLabel('Join')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✋'),
      new ButtonBuilder()
        .setCustomId('wl_leave')
        .setLabel('Leave')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🚪'),
      new ButtonBuilder()
        .setCustomId('wl_start')
        .setLabel('Start Game')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('▶️'),
      new ButtonBuilder()
        .setCustomId('wl_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('✖️'),
    ),
  ];
}

module.exports = {
  renderLobbyText,
  buildLobbyComponents,
};
