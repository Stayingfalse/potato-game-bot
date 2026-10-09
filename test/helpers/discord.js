'use strict';

/**
 * Small fakes for the parts of discord.js the games use. They record what the
 * bot sends and edits so tests can assert on it.
 */

const { Collection } = require('discord.js');

let nextId = 1000;
const newId = () => String(nextId++);

/** A Discord user. */
function user(id, username = id) {
  return { id, username, displayAvatarURL: () => `https://cdn.invalid/${id}.png` };
}

/** A fake message stored in a fake channel; `edit` merges into `payload`. */
function createMessage(channel, payload, authorId = 'bot') {
  const message = {
    id: newId(),
    channelId: channel.id,
    author: { id: authorId },
    payload,
    get content() { return message.payload?.content ?? ''; },
    deletable: true,
    edit: async update => { message.payload = { ...message.payload, ...update }; return message; },
    delete: async () => { channel.store.delete(message.id); },
  };
  channel.store.set(message.id, message);
  return message;
}

/** A fake thread: records sent messages, members, and lock/archive state. */
function createThread(id = 'thread-1') {
  const thread = {
    id,
    locked: false,
    archived: false,
    deleted: false,
    memberIds: new Set(),
    store: new Map(),
    sent: [],
    members: {
      add: async userId => { thread.memberIds.add(userId); },
      remove: async userId => { thread.memberIds.delete(userId); },
      fetch: async userId => ({ id: userId, displayName: `Name-${userId}` }),
    },
    messages: {
      fetch: async arg => {
        if (arg && typeof arg === 'object') return new Collection([...thread.store]);
        const message = thread.store.get(arg);
        if (!message) throw new Error('Unknown Message');
        return message;
      },
    },
    send: async payload => { thread.sent.push(payload); return createMessage(thread, payload); },
    bulkDelete: async messages => { for (const messageId of messages.keys()) thread.store.delete(messageId); },
    setLocked: async value => { thread.locked = value; },
    setArchived: async value => { thread.archived = value; },
    delete: async () => { thread.deleted = true; },
  };
  return thread;
}

/** A fake text channel that games are started from. `threads.create` returns `thread`. */
function createChannel(id, thread) {
  const channel = {
    id,
    store: new Map(),
    sent: [],
    createdThreads: [],
    threads: { create: async options => { channel.createdThreads.push(options); return thread; } },
    send: async payload => { channel.sent.push(payload); return createMessage(channel, payload); },
  };
  return channel;
}

/** A fake client whose `channels.fetch` knows the given channels; extra fields (managers) are merged in. */
function createClient(channels, extra = {}) {
  const byId = new Map(channels.map(c => [c.id, c]));
  return { channels: { fetch: async id => byId.get(id) ?? null }, ...extra };
}

/**
 * A button or modal interaction. `message` is the fake message the button sits
 * on (if any): `update` edits it, as Discord does.
 */
function componentInteraction({ customId, user: from, channelId, kind = 'button', fields = {}, message = null }) {
  const interaction = {
    customId,
    user: from,
    channelId,
    replied: false,
    deferred: false,
    calls: [],
    message: message ?? { content: '' },
    isButton: () => kind === 'button',
    isModalSubmit: () => kind === 'modal',
    isMessageComponent: () => kind === 'button',
    isChatInputCommand: () => false,
    fields: { getTextInputValue: key => fields[key] },
    reply: async payload => { interaction.calls.push(['reply', payload]); interaction.replied = true; },
    update: async payload => {
      interaction.calls.push(['update', payload]);
      interaction.replied = true;
      if (message?.edit) await message.edit(payload);
    },
    deferUpdate: async () => { interaction.deferred = true; },
    deferReply: async () => { interaction.deferred = true; },
    editReply: async payload => { interaction.calls.push(['editReply', payload]); },
    followUp: async payload => { interaction.calls.push(['followUp', payload]); },
    showModal: async modal => { interaction.calls.push(['modal', modal.data.custom_id]); },
  };
  /** The `content` of every ephemeral/public reply, in order. */
  interaction.replies = () => interaction.calls.filter(([type]) => type === 'reply').map(([, p]) => p.content);
  /** The custom_id of the modal shown, if any. */
  interaction.modal = () => interaction.calls.find(([type]) => type === 'modal')?.[1] ?? null;
  return interaction;
}

/** A /<game> <sub> slash command interaction. */
function slashCommand({ sub, user: from, channel, channelId = channel?.id, guildId = 'guild-1', canManageThreads = false }) {
  const interaction = {
    guildId,
    user: from,
    channel,
    channelId,
    replied: false,
    calls: [],
    options: { getSubcommand: () => sub },
    memberPermissions: { has: () => canManageThreads },
    isChatInputCommand: () => true,
    reply: async payload => { interaction.calls.push(payload); interaction.replied = true; },
  };
  interaction.replies = () => interaction.calls.map(p => p.content);
  return interaction;
}

/** Titles of the embeds on a fake message (classic embeds). */
function embedTitles(message) {
  return (message?.payload?.embeds ?? []).map(e => e.data?.title ?? e.title);
}

/** custom_ids of every button on a fake message (action rows). */
function buttonIds(message) {
  return (message?.payload?.components ?? []).flatMap(row => (row.toJSON?.() ?? row).components?.map(c => c.custom_id) ?? []);
}

/** Every custom_id anywhere in a payload, including Components V2 containers. */
function allCustomIds(payload) {
  const ids = [];
  JSON.stringify(payload?.components ?? [], (key, value) => {
    if (key === 'custom_id') ids.push(value);
    return value;
  });
  return ids;
}

/** Runs `fn` with console output captured; returns { result, logs }. */
async function quietly(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const logs = [];
  for (const level of Object.keys(original)) console[level] = (...args) => logs.push(`${level}: ${args.join(' ')}`);
  try {
    return { result: await fn(), logs };
  } finally {
    Object.assign(console, original);
  }
}

module.exports = {
  user,
  createMessage,
  createThread,
  createChannel,
  createClient,
  componentInteraction,
  slashCommand,
  embedTitles,
  buttonIds,
  allCustomIds,
  quietly,
};
