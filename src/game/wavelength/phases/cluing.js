'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function renderCluingBoardText(game) {
  const clueGiver = game.players.get(game.clueGiverId);
  return [
    `## 〰️ Wavelength — Round ${game.gameNumber}`,
    `**Clue Giver:** <@${game.clueGiverId}> (${clueGiver?.username ?? '?'})`,
    '',
    `${clueGiver?.username ?? 'The Clue Giver'} is privately choosing a spectrum and thinking of a clue…`,
    '',
    '*Stand by — the clue will appear here when ready!*',
  ].join('\n');
}

function buildClueGiverPromptComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_open_cg_panel')
        .setLabel('Open Clue Giver Panel')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎯'),
    ),
  ];
}

function buildSpectrumPickComponents(spectrumOptions) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_spectrum_0')
        .setLabel(`${spectrumOptions[0].left} ↔ ${spectrumOptions[0].right}`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('wl_spectrum_1')
        .setLabel(`${spectrumOptions[1].left} ↔ ${spectrumOptions[1].right}`)
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function buildClueSubmitComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_enter_clue')
        .setLabel('Enter Your Clue')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💬'),
    ),
  ];
}

function renderPublicClueText(game) {
  const clueGiver = game.players.get(game.clueGiverId);
  const guessers = [...game.players.values()].filter(p => p.id !== game.clueGiverId);
  const submitted = [...game.guesses.values()].filter(g => g.submitted).length;
  const submissions = guessers.map((p) => {
    const guess = game.guesses.get(p.id);
    return guess?.submitted ? `✅ ${p.username}` : `⏳ ${p.username}`;
  }).join('\n') || '*No guessers*';

  return [
    `## 〰️ Wavelength — Round ${game.gameNumber}`,
    `**Clue Giver:** ${clueGiver?.username ?? '?'}`,
    `**Spectrum:** \`${game.chosenSpectrum.left}\` ↔ \`${game.chosenSpectrum.right}\``,
    '',
    `> 💬 **"${game.clue}"**`,
    '',
    'Click **View Guess Panel** below to position your marker on the spectrum and submit your guess.',
    '',
    `**📊 Submissions — ${submitted}/${guessers.length}**`,
    submissions,
  ].join('\n');
}

module.exports = {
  renderCluingBoardText,
  buildClueGiverPromptComponents,
  buildSpectrumPickComponents,
  buildClueSubmitComponents,
  renderPublicClueText,
};
