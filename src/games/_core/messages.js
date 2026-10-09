'use strict';

/** Fetches a message from `channel`, or null if it's gone or can't be read. */
async function fetchMessage(channel, messageId) {
  if (!channel || !messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

/**
 * Edits an existing message in place.
 * @returns {Promise<import('discord.js').Message|null>} the edited message, or null if it
 *   doesn't exist or the edit failed
 */
async function editMessage(channel, messageId, payload) {
  const msg = await fetchMessage(channel, messageId);
  if (!msg) return null;
  return msg.edit(payload).catch(() => null);
}

/**
 * Edits the game's persistent message, or sends a new one if it no longer exists.
 *
 * If the message still exists but the edit fails (e.g. a transient API error), this does
 * NOT send a replacement — that would leave two persistent game messages in the thread.
 *
 * @param {object} [options]
 * @param {boolean} [options.createIfMissing=true] send a new message when the old one is gone
 * @returns {Promise<{message: import('discord.js').Message, created: boolean}|null>}
 */
async function editOrSend(channel, messageId, payload, { createIfMissing = true } = {}) {
  if (!channel) return null;
  const existing = await fetchMessage(channel, messageId);
  if (existing) {
    const edited = await existing.edit(payload).catch(() => null);
    return edited ? { message: edited, created: false } : null;
  }
  if (!createIfMissing) return null;
  const sent = await channel.send(payload).catch(() => null);
  return sent ? { message: sent, created: true } : null;
}

module.exports = { fetchMessage, editMessage, editOrSend };
