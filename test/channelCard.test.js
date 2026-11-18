'use strict';

/**
 * The channel card (src/games/_core/channelCard.js): the status message each
 * game keeps in the channel it was started from, with a Join button that works
 * from there. Run for every game, plus the template.
 */

const { src } = require('./helpers/env');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly, allCustomIds,
} = require('./helpers/discord');

const { getGames } = src('games/_core/registry');
const { createChannelCard } = src('games/_core/channelCard');
const db = src('db/database');
const template = src('games/_template/index.js');

const MINIMUMS = { werewords: 3, wavelength: 2, nmj: 3, huesclues: 2, articulate: 4, highroll: 2 };
const GAMES = [...getGames(), template];
const TABLES = { werewords: 'werewords_games', wavelength: 'wavelength_games', nmj: 'nmj_games', huesclues: 'huesclues_games', articulate: 'articulate_games', highroll: 'highroll_games' };

/** Per game: state as if some play had happened (set after Start), and the result line the card shows. */
const RESULTS = {
  wavelength: {
    played: game => {
      game.sessionHistory = [{ clueGiverId: 'host', scores: { clueGiverScore: { total: 4 }, guesserScores: { p1: { total: 3 } } } }];
    },
    expected: /^🏁 Final standings: 🥇 <@host> 4 pts · 🥈 <@p1> 3 pts$/,
  },
  werewords: {
    played: game => {
      game.sessionHistory = [
        { gameNumber: 1, outcome: 'villagers_word', word: 'pear', winners: [], players: [] },
        { gameNumber: 2, outcome: 'werewolf_vote', word: 'apple', winners: [], players: [] },
      ];
    },
    expected: /^🏁 2 games played — Villagers 1, Werewolves 1\. Last word: \*\*apple\*\*$/,
  },
  huesclues: {
    played: game => {
      game.sessionHistory = [{ scores: { guessers: { p1: { total: 2 } }, cueGiver: { id: 'host', total: 5 } } }];
    },
    expected: /^🏁 Final standings: 🥇 <@host> 5 pts · 🥈 <@p1> 2 pts$/,
  },
  articulate: {
    played: game => {
      game.turnNumber = 3;
      game.teams = [
        { name: 'Red', emoji: '🔴', playerIds: ['host', 'p1'], position: 12 },
        { name: 'Blue', emoji: '🔵', playerIds: ['p2', 'p3'], position: 20 },
      ];
    },
    expected: /^🏁 Ended early — 🔵 Team Blue \(<@p2>, <@p3>\) led on square 20\.$/,
  },
  nmj: {
    played: game => { game.moves.push({ playerId: 'host', celebs: ['Tom Cruise'], category: 'No More actors' }); },
    expected: /^🛑 Game ended by <@host>\.$/,
  },
};

const managers = [];
after(() => { for (const m of managers) for (const game of m.games.values()) m.clearTimers(game); });

let sessionCount = 0;

/** Starts `manifest` with its real command; returns what the tests need. */
async function startGame(manifest, host = user('host', 'Host')) {
  const n = ++sessionCount;
  const thread = createThread(`${manifest.id}-card-thread-${n}`);
  const channel = createChannel(`${manifest.id}-card-channel-${n}`, thread);
  const manager = manifest.createManager();
  managers.push(manager);
  const client = createClient([thread, channel], { [manifest.clientKey]: manager });
  const start = slashCommand({ sub: 'start', user: host, channel });
  const { logs } = await quietly(() => manifest.command.execute(start, client));
  assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'));
  const game = manager.getGame(thread.id);
  const card = () => channel.store.get(game.cardMessageId)?.payload;
  const lobbyMessage = () => thread.store.get(game.messageId);

  /** Presses a button in the thread (on the lobby message). */
  const press = async (from, action) => {
    const interaction = componentInteraction({ customId: `${manifest.prefix}${action}`, user: from, channelId: thread.id, message: lobbyMessage() });
    const { logs: pressLogs } = await quietly(() => manifest.handleInteraction(interaction, client));
    assert.ok(!pressLogs.some(line => line.startsWith('error')), pressLogs.join('\n'));
    return interaction;
  };
  /** Presses Join on the card, in the starting channel. */
  const joinFromCard = async from => {
    const interaction = componentInteraction({ customId: `${manifest.prefix}card_join`, user: from, channelId: channel.id, message: channel.store.get(game.cardMessageId) });
    const { logs: pressLogs } = await quietly(() => manifest.handleInteraction(interaction, client));
    assert.ok(!pressLogs.some(line => line.startsWith('error')), pressLogs.join('\n'));
    return interaction;
  };
  const end = async () => {
    const command = slashCommand({ sub: 'end', user: host, channel, channelId: thread.id });
    await quietly(() => manifest.command.execute(command, client));
  };
  return { thread, channel, manager, client, start, game, card, lobbyMessage, press, joinFromCard, end };
}

const players = count => Array.from({ length: count }, (_, i) => user(`p${i + 1}`, `Player${i + 1}`));

for (const manifest of GAMES) {
  describe(`${manifest.name}: the channel card`, () => {
    it('is the reply to /start: lobby, players without pings, Join and a thread link', async () => {
      const s = await startGame(manifest);
      assert.ok(s.game.cardMessageId, 'the card id is kept on the game');
      const reply = s.start.calls[0];
      assert.equal(reply.flags, undefined, 'the card is public');
      assert.deepEqual(reply.allowedMentions, { parse: [] });
      const card = s.card();
      assert.match(card.content, new RegExp(`\\*\\*${manifest.name}\\*\\* — hosted by <@host>\\n🟢 Lobby open — 1(/\\d+)? players?\\n<@host>`));
      const ids = allCustomIds(card);
      assert.deepEqual(ids, [`${manifest.prefix}card_join`]);
      assert.ok(JSON.stringify(card.components).includes(`"url":"https://discord.com/channels/guild-1/${s.thread.id}"`));
      const row = db.prepare(`SELECT card_message_id FROM ${TABLES[manifest.id]} WHERE thread_id = ?`).get(s.thread.id);
      assert.equal(row.card_message_id, s.game.cardMessageId, 'the card id is saved');
      s.manager.deleteGame(s.thread.id);
    });

    it('Join on the card adds the player, the thread member, the lobby message and the card', async () => {
      const s = await startGame(manifest);
      const [a] = players(1);
      const join = await s.joinFromCard(a);
      assert.ok(s.game.players.has(a.id));
      assert.ok(s.thread.memberIds.has(a.id));
      const [type, payload] = join.calls[0];
      assert.equal(type, 'reply');
      assert.equal(payload.flags, MessageFlags.Ephemeral);
      assert.ok(payload.content.includes(`<#${s.thread.id}>`), payload.content);
      assert.ok(JSON.stringify(s.lobbyMessage().payload).includes('<@p1>'), 'the lobby message lists the new player');
      assert.match(s.card().content, /Lobby open — 2(\/\d+)? players\n<@host>, <@p1>/);

      assert.match((await s.joinFromCard(a)).replies()[0], /^You are already in the game/);
      assert.equal(s.game.players.size, 2);
      s.manager.deleteGame(s.thread.id);
    });

    it('Join on the card is refused when the lobby is full', async () => {
      const s = await startGame(manifest);
      s.manager.maxPlayers = 1;
      assert.match((await s.joinFromCard(user('late', 'Late'))).replies()[0], /^The game is full/);
      assert.equal(s.game.players.size, 1);
      s.manager.deleteGame(s.thread.id);
    });

    it('shows "in progress" once the game starts, refuses Join, and "Cancelled" when ended before anything was played', async () => {
      const s = await startGame(manifest);
      for (const p of players(MINIMUMS[manifest.id] - 1)) await s.joinFromCard(p);
      await s.press(user('host', 'Host'), 'start');
      assert.notEqual(s.game.phase, 'lobby');
      const count = MINIMUMS[manifest.id];
      assert.match(s.card().content, new RegExp(`🎮 Game in progress — ${count} players`));
      assert.deepEqual(allCustomIds(s.card()), [], 'no Join button');
      assert.ok(JSON.stringify(s.card().components).includes('"url"'), 'the thread link stays');

      assert.match((await s.joinFromCard(user('late', 'Late'))).replies()[0], /^This game has already started/);
      assert.ok(!s.game.players.has('late'));

      await s.end();
      assert.equal(s.manager.getGame(s.thread.id), null);
      assert.match(s.card().content, /\n✖️ Cancelled — thread closed$/);
      assert.deepEqual(s.card().components, []);
      assert.deepEqual(s.channel.sent, [], 'nothing else is posted in the channel');
      assert.match((await s.joinFromCard(user('later', 'Later'))).replies()[0], /^This game is no longer running/);
    });

    if (RESULTS[manifest.id]) {
      it('shows the session result when it is ended after play', async () => {
        const s = await startGame(manifest);
        for (const p of players(MINIMUMS[manifest.id] - 1)) await s.joinFromCard(p);
        await s.press(user('host', 'Host'), 'start');
        const { played, expected } = RESULTS[manifest.id];
        played(s.game);
        await s.end();
        assert.equal(s.manager.getGame(s.thread.id), null);
        const lines = s.card().content.split('\n');
        assert.equal(lines.length, 3, s.card().content);
        assert.match(lines[1], expected);
        assert.equal(lines[2], '🔒 Thread closed');
        assert.deepEqual(s.channel.sent, []);
      });
    }

    it('shows "Cancelled" when the lobby is cancelled', async () => {
      const s = await startGame(manifest);
      await s.press(user('host', 'Host'), 'cancel');
      assert.equal(s.manager.getGame(s.thread.id), null);
      assert.match(s.card().content, /✖️ Cancelled — thread closed$/);
      assert.deepEqual(s.card().components, []);
      assert.deepEqual(s.channel.sent, []);
    });

    it('Leave in the thread updates the card', async () => {
      const s = await startGame(manifest);
      const [a] = players(1);
      await s.press(a, 'join');
      assert.match(s.card().content, /<@host>, <@p1>/);
      await s.press(a, 'leave');
      assert.ok(!s.card().content.includes('<@p1>'));
      s.manager.deleteGame(s.thread.id);
    });
  });
}

describe('High Roll (the template): the result on the card', () => {
  it('shows the winner when the session is closed', async () => {
    const s = await startGame(template);
    await s.joinFromCard(user('a', 'Ann'));
    await s.press(user('host', 'Host'), 'start');
    const original = Math.random;
    const rolls = [0.3, 0.8];
    Math.random = () => rolls.shift();
    try {
      await s.press(user('host', 'Host'), 'roll');
      await s.press(user('a', 'Ann'), 'roll');
    } finally {
      Math.random = original;
    }
    assert.equal(s.game.phase, 'ended');
    await s.press(user('host', 'Host'), 'close');
    assert.equal(s.card().content, '🎲 **High Roll** — hosted by <@host>\n🏆 <@a> won with a roll of **81**.\n🔒 Thread closed');
  });

  it('restore keeps the card id and posts nothing', async () => {
    const s = await startGame(template);
    const cardId = s.game.cardMessageId;
    const manager = template.createManager();
    managers.push(manager);
    const client = createClient([s.thread, s.channel], { highRollManager: manager });
    await quietly(() => template.restore(client));
    assert.equal(manager.getGame(s.thread.id).cardMessageId, cardId);
    assert.deepEqual(s.channel.sent, []);
    manager.deleteGame(s.thread.id);
  });
});

describe('card failures never break the game', () => {
  const failingCases = {
    'the card message is gone': s => { s.channel.store.delete(s.game.cardMessageId); },
    'editing the card fails': s => { s.channel.store.get(s.game.cardMessageId).edit = async () => { throw new Error('Missing Access'); }; },
    'the channel cannot be read': s => { s.channel.messages.fetch = async () => { throw new Error('Missing Access'); }; },
    'the channel is gone': s => { s.client.channels.fetch = async id => (id === s.thread.id ? s.thread : null); },
  };
  for (const [name, breakIt] of Object.entries(failingCases)) {
    it(`${name}: join, start and end still work`, async () => {
      const s = await startGame(template);
      breakIt(s);
      await s.press(user('a', 'Ann'), 'join');
      await s.press(user('host', 'Host'), 'start');
      assert.equal(s.game.phase, 'rolling');
      await s.end();
      assert.equal(s.manager.getGame(s.thread.id), null);
      assert.ok(JSON.stringify(s.lobbyMessage().payload).includes('Session Closed'));
    });
  }

  it('a start reply whose message cannot be fetched leaves the game without a card', async () => {
    const thread = createThread('no-card-thread');
    const channel = createChannel('no-card-channel', thread);
    const manager = template.createManager();
    managers.push(manager);
    const client = createClient([thread, channel], { highRollManager: manager });
    const start = slashCommand({ sub: 'start', user: user('host', 'Host'), channel });
    start.fetchReply = async () => { throw new Error('Unknown interaction'); };
    await quietly(() => template.command.execute(start, client));
    const game = manager.getGame(thread.id);
    assert.equal(game.cardMessageId, null);
    assert.match(start.replies()[0], /Lobby open/);
    const press = async (from, customId) => {
      const interaction = componentInteraction({ customId, user: from, channelId: thread.id, message: thread.store.get(game.messageId) });
      const { logs } = await quietly(() => template.handleInteraction(interaction, client));
      assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'));
    };
    await press(user('a', 'Ann'), 'hr_join');
    await press(user('host', 'Host'), 'hr_start');
    await press(user('host', 'Host'), 'hr_close');
    assert.equal(manager.getGame(thread.id), null);
    assert.deepEqual(channel.sent, []);
  });

  it('uses the message from reply({ withResponse }) when Discord returns one', async () => {
    const card = createChannelCard({ name: 'Test', emoji: '🧪', prefix: 'tt_', clientKey: 'x', repository: { upsert() {} } });
    const game = { guildId: 'g', threadId: 't', hostId: 'h', phase: 'lobby', players: new Map([['h', {}]]) };
    const interaction = { reply: async payload => { assert.equal(payload.withResponse, true); return { resource: { message: { id: 'm-1' } } }; } };
    await card.post(interaction, game, {});
    assert.equal(game.cardMessageId, 'm-1');
  });
});
