'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildNudgeButton(userId, delta, label, submitted, position) {
  const nextPosition = position + delta;
  return new ButtonBuilder()
    .setCustomId(`wl_nudge_${userId}_${delta}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(submitted || nextPosition < 0 || nextPosition > 100);
}

/**
 * The 7-button nudge layout shown in each guesser's ephemeral panel.
 *
 * Row 1: +25 / +5 / +1
 * Row 2: SUBMIT
 * Row 3: -1 / -5 / -25
 *
 * @param {string} userId
 * @param {boolean} submitted  When true, all nudge buttons are disabled.
 * @param {number} position    Current 0–100 position (used to disable nudges at edges).
 */
function buildNudgeComponents(userId, submitted, position) {
  const row1 = new ActionRowBuilder().addComponents(
    buildNudgeButton(userId, 25, '+25', submitted, position),
    buildNudgeButton(userId, 5, '+5', submitted, position),
    buildNudgeButton(userId, 1, '+1', submitted, position),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wl_submit_${userId}`)
      .setLabel(submitted ? '✅ Locked In' : 'SUBMIT')
      .setStyle(submitted ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(submitted),
  );

  const row3 = new ActionRowBuilder().addComponents(
    buildNudgeButton(userId, -1, '-1', submitted, position),
    buildNudgeButton(userId, -5, '-5', submitted, position),
    buildNudgeButton(userId, -25, '-25', submitted, position),
  );

  return [row1, row2, row3];
}

/**
 * Public "View Guess Panel" button posted in the thread for everyone to open their ephemeral.
 */
function buildGuessPromptComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('wl_guess_panel')
      .setLabel('View Guess Panel')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📍'),
  );
  return [row];
}

module.exports = { buildNudgeComponents, buildGuessPromptComponents };
