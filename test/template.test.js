'use strict';

/**
 * Tests for the template game (src/games/_template, "High Roll"). When you copy
 * the template to make a game, copy this file to test/<your-id>.test.js too and
 * change the paths, names and customIds.
 */

const { src } = require('./helpers/env');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly,
} = require('./helpers/discord');

const highRoll = src('games/_template/index.js');
const repository = src('games/_template/repository');
const HighRollGameState = src('games/_template/state');
const { HighRollManager } = src('games/_template/manager');
const stats = src('games/_template/stats');
const { scheduleRollTimeout } = src('games/_template/flow');
const { getGames } = src('games/_core/registry');

const managers = [];
const newManager = () => { const m = new HighRollManager(); managers.push(m); return m; };
after(() => { for (const m of managers) for (const game of m.games.values()) m.clearTimers(game); });

/** Makes Math.random return the given values in turn (for predictable rolls). */
function withRolls(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => (values[i++] - 1) / 100; // roll = value
  return Promise.resolve(fn()).finally(() => { Math.random = original; });
}

describe('the template manifest', () => {
  it('has every field the registry needs', () => {
    for (const field of ['id', 'name', 'prefix', 'clientKey', 'createManager', 'command', 'handleInteraction']) {
      assert.ok(highRoll[field] != null, field);
    }
    assert.equal(highRoll.command.data.name, highRoll.id);
  });

  it('is not loaded into the bot, and its prefix clashes with no real game', () => {
    const games = getGames();
    assert.ok(!games.some(g => g.id === highRoll.id));
    for (const game of games) {
      assert.ok(!game.prefix.startsWith(highRoll.prefix) && !highRoll.prefix.startsWith(game.prefix), game.id);
    }
  });
});

describe('a game through the real command and buttons', () => {
  const thread = createThread('hr-thread');
  const channel = createChannel('hr-channel', thread);
  const manager = newManager();
  const client = createClient([thread, channel], { highRollManager: manager });
  const HOST = user('host', 'Host'), A = user('a', 'Ann'), B = user('b', 'Bob');
  let game;
  const gameMessage = () => thread.store.get(game.messageId);
  const text = () => JSON.stringify(gameMessage().payload.components);

  const press = async (from, customId) => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, message: gameMessage() });
    const { logs } = await quietly(() => highRoll.handleInteraction(interaction, client));
    assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'));
    return interaction;
  };

  it('/highroll start opens a thread with the lobby, and refuses a second game', async () => {
    const start = slashCommand({ sub: 'start', user: HOST, channel });
    await highRoll.command.execute(start, client);
    game = manager.getGame(thread.id);
    assert.ok(game.messageId);
    assert.match(start.replies()[0], /game created/);
    assert.ok(text().includes('hr_join'));

    const again = slashCommand({ sub: 'start', user: HOST, channel });
    await highRoll.command.execute(again, client);
    assert.match(again.replies()[0], /^You already have an active/);
  });

  it('lobby: join and leave; only the host starts, with enough players', async () => {
    assert.deepEqual((await press(HOST, 'hr_start')).replies(), ['Need at least **2 players** to start. Currently: **1**.']);
    await press(A, 'hr_join');
    assert.deepEqual((await press(A, 'hr_join')).replies(), ['You are already in the game.']);
    await press(B, 'hr_join');
    await press(B, 'hr_leave');
    await press(B, 'hr_join');
    assert.deepEqual([...game.players.keys()], ['host', 'a', 'b']);
    assert.ok(thread.memberIds.has('b'));
    assert.deepEqual((await press(A, 'hr_start')).replies(), ['Only the host can start the game.']);
    await press(HOST, 'hr_start');
    assert.equal(game.phase, 'rolling');
    assert.ok(game.rollTimeout);
    assert.ok(text().includes('hr_roll'));
  });

  it('rolling: once each; the round ends when everyone has rolled', async () => {
    await withRolls([40, 90, 15], async () => {
      await press(HOST, 'hr_roll');
      assert.deepEqual((await press(HOST, 'hr_roll')).replies(), ['You already rolled **40**.']);
      await press(A, 'hr_roll');
      assert.equal(game.phase, 'rolling');
      await press(B, 'hr_roll');
    });
    assert.equal(game.phase, 'ended');
    assert.deepEqual(Object.fromEntries(game.rolls), { host: 40, a: 90, b: 15 });
    assert.equal(game.rollTimeout, null);
    assert.ok(text().includes('🏆 <@a> — **90**'));
    assert.ok(text().includes('hr_again'));
  });

  it('records stats for everyone who rolled', () => {
    assert.deepEqual(stats.scoreboard('guild-1').map(r => [r.user_id, r.wins, r.best_roll]), [['a', 1, 90], ['host', 0, 40], ['b', 0, 15]]);
    assert.equal(stats.describe(stats.getPlayer('guild-1', 'a')), 'High Roll: 1 games, 1 wins, best roll 90.');
  });

  it('Play Again starts the next round; Close ends the session and archives the thread', async () => {
    assert.deepEqual((await press(A, 'hr_again')).replies(), ['Only the host can start the next game.']);
    await press(HOST, 'hr_again');
    assert.equal(game.phase, 'rolling');
    assert.equal(game.gameNumber, 2);
    assert.equal(game.rolls.size, 0);

    await press(HOST, 'hr_close');
    assert.equal(manager.getGame(thread.id), null);
    assert.equal(game.rollTimeout, null);
    assert.ok(text().includes('Session Closed'));
    assert.deepEqual(repository.getAll(), []);
  });
});

describe('the rolling deadline', () => {
  it('ends the round with whoever has rolled', async () => {
    const thread = createThread('hr-deadline');
    const manager = newManager();
    const client = createClient([thread], { highRollManager: manager });
    const game = manager.createGame('guild-2', 'C', thread.id, 'h', 'Host');
    manager.addPlayer(thread.id, user('h'));
    manager.addPlayer(thread.id, user('x'));
    manager.startRound(thread.id);
    game.rolls.set('h', 33);
    game.phaseEndsAt = Date.now() + 20;
    scheduleRollTimeout(game, client);

    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(game.phase, 'ended');
    assert.deepEqual(game.winnerIds(), ['h']);
  });
});

describe('restore', () => {
  it('brings back a round in progress with its rolls and remaining time, posting nothing new', async () => {
    const thread = createThread('hr-restore');
    const saving = newManager();
    const game = saving.createGame('guild-3', 'C', thread.id, 'h', 'Host');
    saving.addPlayer(thread.id, user('h'));
    saving.addPlayer(thread.id, user('y'));
    saving.startRound(thread.id);
    game.rolls.set('h', 77);
    game.messageId = (await thread.send({})).id;
    repository.upsert(game);
    saving.clearTimers(game);

    const restored = newManager();
    await quietly(() => highRoll.restore(createClient([thread], { highRollManager: restored })));
    const back = restored.getGame(thread.id);
    assert.ok(back instanceof HighRollGameState);
    assert.equal(back.rolls.get('h'), 77);
    assert.equal(back.phaseEndsAt, game.phaseEndsAt);
    assert.ok(back.rollTimeout);
    assert.equal(thread.sent.length, 1, 'redrawn in place');
  });

  it('drops a saved game whose thread is gone', async () => {
    await quietly(() => highRoll.restore(createClient([], { highRollManager: newManager() })));
    assert.deepEqual(repository.getAll(), []);
  });
});

describe('/highroll end', () => {
  it('is refused for other players and allowed for the host', async () => {
    const thread = createThread('hr-end');
    const channel = createChannel('hr-end-channel', thread);
    const manager = newManager();
    const client = createClient([thread, channel], { highRollManager: manager });
    await highRoll.command.execute(slashCommand({ sub: 'start', user: user('h', 'Host'), channel }), client);

    const other = slashCommand({ sub: 'end', user: user('z'), channel, channelId: thread.id });
    await highRoll.command.execute(other, client);
    assert.match(other.replies()[0], /^Only the game creator/);

    await highRoll.command.execute(slashCommand({ sub: 'end', user: user('h'), channel, channelId: thread.id }), client);
    assert.equal(manager.getGame(thread.id), null);
  });
});
