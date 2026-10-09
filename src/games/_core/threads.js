'use strict';

const { ChannelType } = require('discord.js');

/** The message shown when the bot can't create a game thread in a channel. */
function missingThreadPermissionsMessage({ isPrivate }) {
  return (
    '❌ **Missing permissions.** The bot needs the following in this channel:\n' +
    `• \`Create ${isPrivate ? 'Private' : 'Public'} Threads\`\n` +
    '• `Send Messages in Threads`\n' +
    '• `Manage Threads` *(to clean up finished games)*' +
    (isPrivate ? '\n\n*Note: Private threads require a Community server or Boost Level 1+.*' : '')
  );
}

/**
 * Creates a game thread in `channel` and adds the host to it.
 * @returns {Promise<import('discord.js').ThreadChannel|null>} null if the bot lacks permissions
 */
async function createGameThread(channel, { name, isPrivate, autoArchiveDuration, reason, hostId }) {
  try {
    const thread = await channel.threads.create({
      name,
      type: isPrivate ? ChannelType.PrivateThread : ChannelType.PublicThread,
      autoArchiveDuration,
      reason,
    });
    await thread.members.add(hostId);
    return thread;
  } catch {
    return null;
  }
}

/** Fetches a channel or thread by ID, or null if it no longer exists. */
function fetchChannel(client, channelId) {
  return client.channels.fetch(channelId).catch(() => null);
}

/** Deletes a thread, falling back to archiving it if the delete isn't allowed. Never throws. */
async function deleteThread(thread, reason) {
  if (!thread) return;
  await thread.delete(reason).catch(async () => {
    await thread.setArchived(true).catch(() => {});
  });
}

/**
 * Locks and archives a thread. With `delayMs`, waits that long first (detached,
 * so callers don't block) to give players time to read a closing message.
 */
function lockAndArchive(thread, { delayMs = 0 } = {}) {
  if (!thread) return Promise.resolve();
  const run = async () => {
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
  };
  if (delayMs > 0) {
    setTimeout(run, delayMs);
    return Promise.resolve();
  }
  return run();
}

module.exports = {
  missingThreadPermissionsMessage,
  createGameThread,
  fetchChannel,
  deleteThread,
  lockAndArchive,
};
