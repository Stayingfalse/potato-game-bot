'use strict';

const { src } = require('./helpers/env');
const https = require('https');
const { EventEmitter } = require('events');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly, allCustomIds,
} = require('./helpers/discord');

// Stay offline: avatar downloads for the dial images fail straight away.
https.get = () => {
  const request = new EventEmitter();
  setImmediate(() => request.emit('error', new Error('offline in tests')));
  return request;
};

const host = src('games/_core/host');
const { WavelengthManager } = src('games/wavelength/manager');
const wavelength = src('games/wavelength/index.js');
const { NoMoreJockeysManager } = src('games/nmj/manager');
const nmj = src('games/nmj/index.js');

// A clock the tests move by hand, so nobody waits two minutes.
let clock = 1_000_000;
host.setClock(() => clock);
after(() => host.setClock());

const H = user('h', 'Host');
const B = user('b', 'Bee');
const C = user('c', 'Cee');
const MOD = user('m', 'Mod');

/** Presses `customId` as `from` in `thread`; `mod` gives them Manage Threads. */
function presser(game, thread, client) {
  return async (from, customId, { mod = false, fields, kind = 'button' } = {}) => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, kind, fields });
    interaction.memberPermissions = { has: () => mod };
    await quietly(() => game.handleInteraction(interaction, client));
    return interaction;
  };
}

const replyPayload = interaction => interaction.calls.find(([type]) => type === 'reply')?.[1];

describe('host controls in Wavelength', () => {
  const manager = new WavelengthManager();
  after(() => { for (const game of manager.games.values()) manager.clearTimers(game); });
  const thread = createThread('host-wl');
  const channel = createChannel('chan-wl', thread);
  const client = createClient([thread, channel], { wavelengthManager: manager });
  const press = presser(wavelength, thread, client);
  let game;

  it('a player who is not the host is offered the take-over button', async () => {
    await wavelength.command.execute(slashCommand({ sub: 'start', user: H, channel }), client);
    game = manager.getGame(thread.id);
    await press(B, 'wl_join');
    await press(C, 'wl_join');

    const refused = await press(B, 'wl_start');
    assert.deepEqual(refused.replies(), ['Only the host can start the game.']);
    assert.deepEqual(allCustomIds(replyPayload(refused)), ['wl_take_host']);
    assert.equal(game.phase, 'lobby');
  });

  it('someone outside the game gets no take-over button and cannot take over', async () => {
    const outsider = user('z', 'Zed');
    const refused = await press(outsider, 'wl_start');
    assert.deepEqual(allCustomIds(replyPayload(refused)), []);
    assert.deepEqual((await press(outsider, 'wl_take_host')).replies(), ['Only players in this game can take over as host.']);
    assert.equal(game.hostId, 'h');
  });

  it('take-over is refused while the host is active', async () => {
    await press(H, 'wl_howto'); // any interaction from the host counts as activity
    clock += 30_000;
    const refused = await press(B, 'wl_take_host');
    assert.match(refused.replies()[0], /still hosting.*1 minute 30 seconds/);
    assert.equal(game.hostId, 'h');
  });

  it('take-over succeeds once the host has been inactive for two minutes', async () => {
    clock += host.TAKEOVER_AFTER_MS;
    const taken = await press(B, 'wl_take_host');
    assert.equal(game.hostId, 'b');
    assert.equal(game.hostUsername, 'Bee');
    assert.deepEqual(taken.calls.at(-1), ['update', { content: '👑 You are now the host.', components: [] }]);
    assert.match(thread.sent.at(-1).content, /<@b> is now the host \(the previous host was away\)/);
    // The old host has to wait like anyone else.
    assert.match((await press(H, 'wl_take_host')).replies()[0], /still hosting/);
    assert.equal(game.hostId, 'b');
  });

  it('the new host can run the game, and the old one cannot', async () => {
    assert.deepEqual((await press(H, 'wl_start')).replies(), ['Only the host can start the game.']);
    await press(B, 'wl_start');
    assert.equal(game.phase, 'setup');
  });

  it('a moderator with Manage Threads can use host controls', async () => {
    await press(MOD, 'wl_mode_endless', { mod: true });
    await press(MOD, 'wl_endless_order_round_robin', { mod: true });
    assert.deepEqual(game.sessionMode, { type: 'endless', clueOrder: 'round_robin' });
    await press(B, 'wl_pace_realtime');
    await press(B, 'wl_confirm_options');
    assert.equal(game.phase, 'cluing');
    assert.equal(game.hostId, 'b', 'acting as a moderator does not change the host');
  });

  it('the host can skip a stalled clue giver; other players cannot', async () => {
    const stalled = game.clueGiverId;
    const refused = await press(C, 'wl_skip_clue_giver');
    assert.deepEqual(refused.replies(), ['Only the host can skip the Clue Giver.']);
    assert.equal(game.clueGiverId, stalled);

    await press(B, 'wl_skip_clue_giver');
    assert.equal(game.phase, 'cluing');
    assert.notEqual(game.clueGiverId, stalled);
    assert.equal(game.clue, null);
    assert.ok(!game.guesses.has(game.clueGiverId), 'the new clue giver does not guess');
    assert.ok(thread.sent.some(m => m.content?.includes(`<@${stalled}>'s clue turn was skipped`)));
    assert.ok(thread.sent.at(-1).content.startsWith(`<@${game.clueGiverId}> — please give us your clue`));
  });

  it('skipping is refused outside the cluing phase', async () => {
    await press(user(game.clueGiverId), 'wl_spectrum_0');
    await press(user(game.clueGiverId), 'wl_clue_modal', { fields: { wl_clue_input: 'Volcano' }, kind: 'modal' });
    assert.equal(game.phase, 'guessing');
    assert.deepEqual((await press(B, 'wl_skip_clue_giver')).replies(), ['No active cluing phase.']);
  });
});

describe('host controls in No More Jockeys', () => {
  const manager = new NoMoreJockeysManager();
  after(() => { for (const id of [...manager.games.keys()]) manager.deleteGame(id); });
  const thread = createThread('host-nmj');
  const channel = createChannel('chan-nmj', thread);
  const client = createClient([thread, channel], { nmjManager: manager });
  const press = presser(nmj, thread, client);
  let game;

  it('a host cannot take over a second game of the same type', async () => {
    await nmj.command.execute(slashCommand({ sub: 'start', user: H, channel }), client);
    game = manager.getGame(thread.id);
    await press(B, 'nmj_join');
    await press(C, 'nmj_join');

    // Bee already hosts another No More Jockeys game in this server.
    const otherThread = createThread('host-nmj-2');
    const otherChannel = createChannel('chan-nmj-2', otherThread);
    const otherClient = createClient([otherThread, otherChannel], { nmjManager: manager });
    await nmj.command.execute(slashCommand({ sub: 'start', user: B, channel: otherChannel }), otherClient);

    clock += host.TAKEOVER_AFTER_MS + 1;
    assert.match((await press(B, 'nmj_take_host')).replies()[0], /already hosting another game of this type in <#host-nmj-2>/);
    assert.equal(game.hostId, 'h');
    manager.deleteGame('host-nmj-2');
  });

  it('the host skips a stalled turn with no penalty; other players cannot', async () => {
    await press(H, 'nmj_start');
    await press(H, 'nmj_spin');
    await press(H, 'nmj_begin');
    assert.equal(game.phase, 'playing');

    const stalled = game.currentPlayerId();
    const bystander = [H, B, C].find(p => p.id !== 'h' && p.id !== stalled) ?? B;
    assert.deepEqual((await press(bystander, 'nmj_skip_turn')).replies(), ['Only the host can skip a turn.']);
    assert.equal(game.currentPlayerId(), stalled);

    await press(H, 'nmj_skip_turn');
    assert.notEqual(game.currentPlayerId(), stalled);
    assert.equal(game.players.size, 3, 'nobody is knocked out');
    assert.ok(thread.sent.some(m => m.content?.includes(`<@${stalled}>'s turn was skipped by <@h> — no penalty.`)));
  });

  it('a moderator can skip a turn too', async () => {
    const stalled = game.currentPlayerId();
    await press(MOD, 'nmj_skip_turn', { mod: true });
    assert.notEqual(game.currentPlayerId(), stalled);
  });

  it('there is nothing to skip while a move is waiting for responses', async () => {
    const mover = user(game.currentPlayerId());
    await press(mover, 'nmj_move_modal', { fields: { nmj_celeb: 'Tom Cruise', nmj_category: 'No More Oscar winners' }, kind: 'modal' });
    assert.deepEqual((await press(H, 'nmj_skip_turn')).replies(), ['There is no turn to skip right now.']);
  });
});
