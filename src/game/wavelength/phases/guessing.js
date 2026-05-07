'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * The 7-button nudge rows shown in each guesser's ephemeral panel.
 *
 * Row 1: <<< / << / < / SUBMIT / >   (deltas: -25 / -10 / -5 / submit / +5)
 * Row 2: >> / >>>                     (deltas: +10 / +25)
 *
 * Discord limits each action row to a maximum of 5 buttons, so the 7 buttons
 * are spread across two rows.
 *
 * @param {string} userId
 * @param {boolean} submitted  When true, all nudge buttons are disabled.
 * @param {number} position    Current 0–100 position (used to disable nudges at edges).
 */
function buildNudgeComponents(userId, submitted, position) {
  const atLeft  = position <= 0;
  const atRight = position >= 100;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wl_nudge_${userId}_-25`)
      .setLabel('<<<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(submitted || atLeft),
    new ButtonBuilder()
      .setCustomId(`wl_nudge_${userId}_-10`)
      .setLabel('<<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(submitted || atLeft),
    new ButtonBuilder()
      .setCustomId(`wl_nudge_${userId}_-5`)
      .setLabel('<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(submitted || atLeft),
    new ButtonBuilder()
      .setCustomId(`wl_submit_${userId}`)
      .setLabel(submitted ? '✅ Locked In' : 'SUBMIT')
      .setStyle(submitted ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(submitted),
    new ButtonBuilder()
      .setCustomId(`wl_nudge_${userId}_5`)
      .setLabel('>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(submitted || atRight),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wl_nudge_${userId}_10`)
      .setLabel('>>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(submitted || atRight),
    new ButtonBuilder()
      .setCustomId(`wl_nudge_${userId}_25`)
      .setLabel('>>>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(submitted || atRight),
  );

  return [row1, row2];
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
