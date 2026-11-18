'use strict';

/**
 * The channel card: a short status message in the channel a game was started
 * from (the reply to `/<game> start`). It keeps people in that channel up to
 * date without them opening the thread:
 *
 *   lobby      host, "Lobby open — N/max players", the players, a Join button
 *              that works from the channel, and a link to the thread
 *   playing    "Game in progress — N players" and a link to the thread
 *   finished   the result in a line or two, and "Thread closed"
 *   cancelled  "Cancelled — thread closed", for a session closed before anything was played
 *
 * Each game makes one card with createChannelCard() and calls it from a few
 * places: post() in the start command, update() whenever the lobby or phase
 * changes, and finish()/cancel() when the session ends. The card's message id
 * is saved on the game as `cardMessageId`.
 *
 * Updating a card never throws and never blocks the game for long: a missing
 * card, channel or message, or a failed edit, is ignored.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { fetchChannel } = require('./threads');
const { editMessage } = require('./messages');

const NO_PINGS = { parse: [] };

/** Edits of one card run one after another, in the order they were asked for. */
const queues = new Map();

function enqueue(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task).catch(() => {});
  queues.set(key, next);
  next.then(() => { if (queues.get(key) === next) queues.delete(key); });
  return next;
}

/** Link to a thread (or any channel) that works from anywhere in the guild. */
function threadUrl(game) {
  return `https://discord.com/channels/${game.guildId}/${game.threadId}`;
}

function linkButton(game) {
  return new ButtonBuilder().setLabel('Open thread').setEmoji('🧵').setStyle(ButtonStyle.Link).setURL(threadUrl(game));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {object} options
 * @param {string} options.name        display name, e.g. 'Wavelength'
 * @param {string} options.emoji       shown before the name
 * @param {string} options.prefix      the manifest's customId prefix; the Join button is `<prefix>card_join`
 * @param {string} options.clientKey   property on `client` that holds the game's manager
 * @param {{upsert: Function}} options.repository  saves the game once the card's id is known
 * @param {(game: object) => boolean} [options.isLobby]  whether players can still join
 */
function createChannelCard({ name, emoji, prefix, clientKey, repository, isLobby = game => game.phase === 'lobby' }) {
  const joinId = `${prefix}card_join`;

  /**
   * The card for a game. Pure.
   * @param {object} game
   * @param {{ status?: 'lobby'|'playing'|'finished'|'cancelled', result?: string, maxPlayers?: number }} [options]
   *   `status` defaults to lobby or playing from the game's phase; `result` (for finished)
   *   is one or two lines, with its own leading emoji
   */
  function render(game, { status, result, maxPlayers } = {}) {
    status ??= isLobby(game) ? 'lobby' : 'playing';
    const lines = [`${emoji} **${name}** — hosted by <@${game.hostId}>`];
    const components = [];
    const count = game.players.size;

    if (status === 'lobby') {
      const players = Number.isFinite(maxPlayers) ? `${count}/${maxPlayers} players` : plural(count, 'player');
      lines.push(`🟢 Lobby open — ${players}`);
      if (count > 0) lines.push([...game.players.keys()].map(id => `<@${id}>`).join(', '));
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(joinId).setLabel('Join').setEmoji('✋').setStyle(ButtonStyle.Success),
        linkButton(game),
      ));
    } else if (status === 'playing') {
      lines.push(`🎮 Game in progress — ${plural(count, 'player')}`);
      components.push(new ActionRowBuilder().addComponents(linkButton(game)));
    } else if (status === 'finished') {
      lines.push(result || '🏁 *Ended before a result.*');
      lines.push('🔒 Thread closed');
    } else {
      lines.push('✖️ Cancelled — thread closed');
    }

    return { content: lines.join('\n'), components, allowedMentions: NO_PINGS };
  }

  const maxPlayersOf = client => client?.[clientKey]?.maxPlayers;

  /**
   * Replies to the start command with the lobby card and remembers its id.
   * The reply itself is the command's answer, so a failure to reply is not
   * hidden; only finding the reply's id afterwards is best-effort.
   */
  async function post(interaction, game, client) {
    const payload = render(game, { status: 'lobby', maxPlayers: maxPlayersOf(client) });
    const response = await interaction.reply({ ...payload, withResponse: true });
    const message = response?.resource?.message
      ?? await Promise.resolve(interaction.fetchReply?.()).catch(() => null);
    if (message?.id) {
      game.cardMessageId = message.id;
      try { repository.upsert(game); } catch { /* the card is a nicety */ }
    }
    return message ?? null;
  }

  /** Edits the card. Never throws; resolves once the edit is done or has failed. */
  function edit(client, game, options) {
    if (!game?.cardMessageId || !game.channelId) return Promise.resolve();
    let payload;
    try {
      payload = render(game, { ...options, maxPlayers: maxPlayersOf(client) });
    } catch {
      return Promise.resolve();
    }
    return enqueue(game.cardMessageId, async () => {
      const channel = await fetchChannel(client, game.channelId);
      await editMessage(channel, game.cardMessageId, payload);
    });
  }

  /** Shows the lobby or "in progress", whichever the game is in now. */
  const update = (client, game) => edit(client, game, {});
  /** Shows the session's result and "Thread closed". */
  const finish = (client, game, result) => edit(client, game, { status: 'finished', result });
  /** Shows "Cancelled": for a session closed before anything was played. */
  const cancel = (client, game) => edit(client, game, { status: 'cancelled' });

  /**
   * The card's Join button, pressed in the starting channel. Adds the player
   * like the lobby's Join does, adds them to the thread, then redraws the
   * lobby message (`refreshLobby`) and the card.
   *
   * @param {object} [options]
   * @param {(game: object, client: object) => Promise<unknown>} [options.refreshLobby]  redraws the lobby message in the thread
   * @param {(game: object, user: object) => boolean} [options.addPlayer]  defaults to the manager's addPlayer
   */
  async function handleJoin(interaction, client, { refreshLobby, addPlayer } = {}) {
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS });
    const manager = client[clientKey];
    const messageId = interaction.message?.id;
    const game = messageId ? [...manager.games.values()].find(g => g.cardMessageId === messageId) : null;
    if (!game) return reply('This game is no longer running.');

    const { user } = interaction;
    if (!isLobby(game)) return reply(`This game has already started — follow along in <#${game.threadId}>.`);
    if (game.players.has(user.id)) return reply(`You are already in the game — <#${game.threadId}>.`);
    if (game.players.size >= manager.maxPlayers) return reply(`The game is full (${manager.maxPlayers} players max).`);

    const added = addPlayer ? addPlayer(game, user) : manager.addPlayer(game.threadId, user);
    if (!added) return reply('You could not join this game.');

    const thread = await fetchChannel(client, game.threadId);
    await thread?.members.add(user.id).catch(() => {});
    await reply(`✅ You joined **${name}**! Head to the thread: <#${game.threadId}>`);

    try {
      await refreshLobby?.(game, client);
    } catch (err) {
      console.error(`[${name}] Could not redraw the lobby after a join from the channel:`, err);
    }
    await update(client, game);
  }

  return { joinId, render, post, update, finish, cancel, handleJoin };
}

module.exports = { createChannelCard, threadUrl };
