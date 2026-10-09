'use strict';

const { src } = require('./helpers/env');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { user, createThread, componentInteraction, quietly } = require('./helpers/discord');

const db = src('db/database');
const { shuffle, sampleN } = src('games/_core/random');
const { safeReply, replyWithError, withErrorReply, GENERIC_ERROR } = src('games/_core/errors');
const threads = src('games/_core/threads');
const { editMessage, editOrSend } = src('games/_core/messages');
const createRepository = src('games/_core/createRepository');
const BaseGameState = src('games/_core/BaseGameState');
const BaseGameManager = src('games/_core/BaseGameManager');
const { getGames, findGameByCustomId } = src('games/_core/registry');
const { routeGameInteraction } = src('games/_core/router');

describe('random', () => {
  it('shuffle returns a reordered copy without touching the input', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    assert.deepEqual([...result].sort(), [1, 2, 3, 4, 5]);
    assert.deepEqual(input, [1, 2, 3, 4, 5]);
  });

  it('sampleN picks n distinct items', () => {
    assert.equal(sampleN([1, 2, 3, 4, 5], 2).length, 2);
    assert.equal(new Set(sampleN([1, 2, 3, 4, 5], 5)).size, 5);
  });
});

describe('errors', () => {
  const fakeInteraction = (state = {}) => componentInteraction({ customId: 'x', user: user('u'), channelId: 'c', ...state });

  it('replies, or follows up once the interaction is acknowledged', async () => {
    const fresh = fakeInteraction();
    await replyWithError(fresh);
    assert.deepEqual(fresh.calls.map(([type, p]) => [type, p.content]), [['reply', GENERIC_ERROR]]);

    const deferred = fakeInteraction();
    deferred.deferred = true;
    await replyWithError(deferred, 'custom');
    assert.deepEqual(deferred.calls.map(([type, p]) => [type, p.content]), [['followUp', 'custom']]);
  });

  it('never throws when the reply itself fails', async () => {
    const broken = fakeInteraction();
    broken.reply = async () => { throw new Error('gone'); };
    await safeReply(broken, { content: 'x' });
  });

  it('withErrorReply logs the error and tells the user', async () => {
    const interaction = fakeInteraction();
    const { result, logs } = await quietly(() => withErrorReply('label', interaction, async () => { throw new Error('boom'); }));
    assert.equal(result, undefined);
    assert.deepEqual(interaction.replies(), [GENERIC_ERROR]);
    assert.ok(logs.some(line => line.includes('[label]')));
    assert.equal(await withErrorReply('label', fakeInteraction(), async () => 42), 42);
  });
});

describe('threads', () => {
  it('the permissions message names the thread type', () => {
    assert.match(threads.missingThreadPermissionsMessage({ isPrivate: true }), /Private Threads[\s\S]*Boost/);
    assert.doesNotMatch(threads.missingThreadPermissionsMessage({ isPrivate: false }), /Boost/);
  });

  it('createGameThread creates the thread and adds the host, or returns null', async () => {
    const added = [];
    const channel = { threads: { create: async options => ({ options, members: { add: async id => added.push(id) } }) } };
    const thread = await threads.createGameThread(channel, { name: 'n', isPrivate: false, autoArchiveDuration: 1440, reason: 'r', hostId: 'h' });
    assert.equal(thread.options.type, 11); // PublicThread
    assert.deepEqual(added, ['h']);
    const failing = { threads: { create: async () => { throw new Error('Missing Permissions'); } } };
    assert.equal(await threads.createGameThread(failing, { hostId: 'h' }), null);
  });

  it('deleteThread falls back to archiving', async () => {
    const thread = createThread();
    thread.delete = async () => { throw new Error('no'); };
    await threads.deleteThread(thread, 'reason');
    assert.equal(thread.archived, true);
  });

  it('lockAndArchive locks and archives, optionally after a delay', async () => {
    const now = createThread();
    await threads.lockAndArchive(now);
    assert.deepEqual([now.locked, now.archived], [true, true]);

    const later = createThread();
    await threads.lockAndArchive(later, { delayMs: 20 });
    assert.equal(later.locked, false);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual([later.locked, later.archived], [true, true]);
  });

  it('fetchChannel returns null for unknown channels', async () => {
    assert.equal(await threads.fetchChannel({ channels: { fetch: async () => { throw new Error('404'); } } }, 'x'), null);
  });
});

describe('messages', () => {
  it('editOrSend edits an existing message', async () => {
    const thread = createThread();
    const existing = await thread.send({ content: 'old' });
    const result = await editOrSend(thread, existing.id, { content: 'new' });
    assert.equal(result.created, false);
    assert.equal(existing.content, 'new');
    assert.equal(thread.sent.length, 1);
  });

  it('editOrSend never sends a duplicate when an edit fails', async () => {
    const thread = createThread();
    const existing = await thread.send({ content: 'old' });
    existing.edit = async () => { throw new Error('transient'); };
    assert.equal(await editOrSend(thread, existing.id, { content: 'new' }), null);
    assert.equal(thread.sent.length, 1);
  });

  it('editOrSend sends when the message is gone, unless told not to', async () => {
    const thread = createThread();
    assert.equal((await editOrSend(thread, 'missing', { content: 'x' })).created, true);
    assert.equal(await editOrSend(thread, 'missing', { content: 'x' }, { createIfMissing: false }), null);
    assert.equal(await editOrSend(null, 'missing', {}), null);
  });

  it('editMessage edits in place and tolerates missing channels or ids', async () => {
    const thread = createThread();
    const message = await thread.send({ content: 'a' });
    await editMessage(thread, message.id, { content: 'b' });
    assert.equal(message.content, 'b');
    assert.equal(await editMessage(null, message.id, {}), null);
    assert.equal(await editMessage(thread, null, {}), null);
  });
});

describe('createRepository', () => {
  db.exec('CREATE TABLE test_games (thread_id TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL)');
  const repository = createRepository({
    table: 'test_games',
    toRow: game => ({ thread_id: game.threadId, name: game.name, created_at: game.createdAt }),
  });

  it('inserts, then updates every column except created_at', () => {
    repository.upsert({ threadId: 't1', name: 'first', createdAt: 100 });
    repository.upsert({ threadId: 't1', name: 'second', createdAt: 999 });
    assert.deepEqual(repository.getAll(), [{ thread_id: 't1', name: 'second', created_at: 100 }]);
    repository.remove('t1');
    assert.deepEqual(repository.getAll(), []);
  });

  it('runs a game-owned schema, and rolls a failed migration back', () => {
    createRepository({ table: 'owned', schema: 'CREATE TABLE IF NOT EXISTS owned (thread_id TEXT PRIMARY KEY, v TEXT)', toRow: g => g });
    db.exec("INSERT INTO owned VALUES ('a', 'old')");
    assert.throws(() => createRepository({
      table: 'owned',
      toRow: g => g,
      migrate: d => { d.exec("UPDATE owned SET v = 'new'"); throw new Error('mid-migration'); },
    }));
    assert.equal(db.prepare('SELECT v FROM owned').get().v, 'old');
  });
});

describe('BaseGameManager', () => {
  const upserts = [];
  const removes = [];
  const repository = { upsert: game => upserts.push(game.threadId), remove: id => removes.push(id) };

  class TestManager extends BaseGameManager {
    constructor() { super({ repository, timerKeys: ['timeout', 'interval'], maxPlayers: 2 }); }
    createPlayer(u) { return { id: u.id, username: u.username, score: 0 }; }
  }

  it('registers games with the shared fields and saves them', () => {
    const manager = new TestManager();
    const game = manager.registerGame(new BaseGameState('g', 'c', 't', 'h', 'Host'));
    assert.equal(manager.getGame('t'), game);
    assert.equal(game.phase, 'lobby');
    assert.ok(game.players instanceof Map);
    assert.ok(game._createdAt > 0);
    assert.deepEqual(upserts, ['t']);
    assert.equal(manager.getGameByHost('g', 'h'), game);
    assert.equal(manager.getGameByHost('other', 'h'), null);
  });

  it('adds players with the game\'s player shape, up to the cap', () => {
    const manager = new TestManager();
    manager.registerGame(new BaseGameState('g', 'c', 't', 'h', 'Host'));
    assert.equal(manager.addPlayer('t', user('a', 'A')), true);
    assert.equal(manager.addPlayer('t', user('a', 'A')), false, 'no duplicates');
    assert.equal(manager.addPlayer('t', user('b', 'B')), true);
    assert.equal(manager.addPlayer('t', user('c', 'C')), false, 'full');
    assert.deepEqual(manager.getGame('t').players.get('a'), { id: 'a', username: 'A', score: 0 });
    assert.equal(manager.removePlayer('t', 'a'), true);
    assert.equal(manager.removePlayer('t', 'a'), false);
    assert.equal(manager.addPlayer('missing', user('x')), false);
  });

  it('clears timers and removes the game on delete', async () => {
    const manager = new TestManager();
    const game = manager.registerGame(new BaseGameState('g', 'c', 't', 'h', 'Host'));
    let fired = false;
    game.timeout = setTimeout(() => { fired = true; }, 10);
    game.interval = setInterval(() => { fired = true; }, 10);
    assert.equal(manager.deleteGame('t'), true);
    assert.equal(manager.deleteGame('t'), false);
    assert.equal(manager.saveGame('t'), false);
    assert.deepEqual([game.timeout, game.interval], [null, null]);
    assert.ok(removes.includes('t'));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(fired, false);
  });
});

describe('registry and router', () => {
  it('discovers every game folder, in order', () => {
    assert.deepEqual(getGames().map(g => g.id), ['werewords', 'wavelength', 'nmj']);
    for (const game of getGames()) {
      assert.equal(typeof game.handleInteraction, 'function', game.id);
      assert.equal(game.command.data.name, game.id);
    }
  });

  it('finds a game by customId prefix', () => {
    assert.equal(findGameByCustomId('ww_ready').id, 'werewords');
    assert.equal(findGameByCustomId('wl_clue_modal').id, 'wavelength');
    assert.equal(findGameByCustomId('nmj_join').id, 'nmj');
    assert.equal(findGameByCustomId('ct_join_1'), null, 'removed game');
    assert.equal(findGameByCustomId('rmr:abc'), null);
  });

  it('routes to the owning game, and reports a thrown error to the user', async () => {
    const nmj = getGames().find(g => g.id === 'nmj');
    const original = nmj.handleInteraction;
    try {
      nmj.handleInteraction = async () => { throw new Error('boom'); };
      const interaction = componentInteraction({ customId: 'nmj_join', user: user('u'), channelId: 'c' });
      const { result, logs } = await quietly(() => routeGameInteraction(interaction, {}));
      assert.equal(result, true);
      assert.deepEqual(interaction.replies(), [GENERIC_ERROR]);
      assert.ok(logs.some(line => line.includes('[No More Jockeys interaction error]')));
      assert.equal(await routeGameInteraction(componentInteraction({ customId: 'zz_x', user: user('u') }), {}), false);
    } finally {
      nmj.handleInteraction = original;
    }
  });
});
