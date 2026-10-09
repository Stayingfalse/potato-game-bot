'use strict';

const { MessageFlags } = require('discord.js');

const GENERIC_ERROR = '❌ Something went wrong — please try again.';

/**
 * Sends `payload` as a reply, or as a follow-up if the interaction was already
 * acknowledged. Never throws.
 */
async function safeReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

/** Sends an ephemeral error message to the user. Never throws. */
function replyWithError(interaction, content = GENERIC_ERROR) {
  return safeReply(interaction, { content, flags: MessageFlags.Ephemeral });
}

/**
 * Runs `fn`, and if it throws, logs the error under `label` and tells the user
 * something went wrong instead of letting the interaction fail silently.
 */
async function withErrorReply(label, interaction, fn, errorContent = GENERIC_ERROR) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[${label}]`, error);
    await replyWithError(interaction, errorContent);
  }
}

module.exports = { GENERIC_ERROR, safeReply, replyWithError, withErrorReply };
