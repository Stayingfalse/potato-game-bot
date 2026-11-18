'use strict';

const { src } = require('./helpers/env');
const https = require('https');
const { EventEmitter } = require('events');
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const {
  user, createThread, createClient, componentInteraction, allCustomIds, findComponent, quietly,
} = require('./helpers/discord');

// ── A controllable avatar server ────────────────────────────────────────────────
// 'ok' answers with a tiny PNG, 'fail' errors straight away, 'hang' never answers.
const AVATAR_PNG = createCanvas(4, 4).toBuffer('image/png');
const avatar = { mode: 'ok', calls: 0, requests: [] };
https.get = (url, onResponse) => {
  avatar.calls++;
  const request = new EventEmitter();
  request.destroy = () => { request.destroyed = true; };
  avatar.requests.push(request);
  const mode = avatar.mode;
  setImmediate(() => {
    if (mode === 'fail') return request.emit('error', new Error('offline in tests'));
    if (mode === 'hang') return;
    const response = new EventEmitter();
    response.statusCode = 200;
    response.resume = () => {};
    onResponse(response);
    response.emit('data', AVATAR_PNG);
    response.emit('end');
  });
  return request;
};

const { WavelengthManager } = src('games/wavelength/manager');
const wavelength = src('games/wavelength/index.js');
const { _testing: imageGen } = src('games/wavelength/imageGen');

describe('the private guess panel', () => {
  const thread = createThread('wl-panel');
  const manager = new WavelengthManager();
  const client = createClient([thread], { wavelengthManager: manager });
  const H = user('h', 'Host'), B = user('b', 'Bee'), C = user('c', 'Cee');
  let game, guesser, other;

  before(async () => {
    game = manager.createGame('G', 'C', thread.id, 'h', 'Host');
    for (const u of [H, B, C]) manager.addPlayer(thread.id, u);
    manager.setSessionMode(thread.id, { type: 'endless', clueOrder: 'round_robin' });
    manager.startGame(thread.id, [{ left: 'Cold', right: 'Hot' }, { left: 'Bad', right: 'Good' }]);
    game.chosenSpectrum = game.spectrumOptions[0];
    game.clue = 'Lava';
    game.phase = 'guessing';
    game.roundMessageId = (await thread.send({})).id;
    [guesser, other] = [...game.guesses.keys()].map(id => [H, B, C].find(u => u.id === id));
  });
  after(() => { manager.clearTimers(game); imageGen.setAvatarTimeout(); });
  beforeEach(() => {
    imageGen.clearAvatarCache();
    imageGen.setAvatarTimeout(50);
    avatar.mode = 'ok';
    avatar.calls = 0;
    avatar.requests = [];
  });

  /** Runs one interaction; `deferUpdate`/`deferReply` are recorded in `calls` so their order is visible. */
  const press = async (from, customId, { kind = 'button', fields = {} } = {}) => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, kind, fields });
    for (const name of ['deferUpdate', 'deferReply']) {
      const original = interaction[name];
      interaction[name] = async (...args) => { interaction.calls.push([name, ...args]); return original(...args); };
    }
    await quietly(() => wavelength.handleInteraction(interaction, client));
    return interaction;
  };
  const callTypes = interaction => interaction.calls.map(([type]) => type);
  const lastEdit = interaction => interaction.calls.filter(([type]) => type === 'editReply').at(-1)?.[1];
  const position = () => game.guesses.get(guesser.id).position;

  it('opening the panel defers an ephemeral reply, then shows the dial and the Type a number button', async () => {
    const interaction = await press(guesser, 'wl_guess_panel');
    assert.deepEqual(callTypes(interaction), ['deferReply', 'editReply']);
    const panel = lastEdit(interaction);
    assert.equal(panel.files.length, 1);
    assert.ok(allCustomIds(panel).includes(`wl_guess_type_${guesser.id}`));
  });

  it('keeps within Discord\'s limits: at most 5 rows of at most 5 buttons', async () => {
    const rows = lastEdit(await press(guesser, 'wl_guess_panel')).components.map(row => row.toJSON());
    assert.ok(rows.length <= 5);
    for (const row of rows) assert.ok(row.components.length <= 5);
  });

  it('a nudge defers first, then edits the panel with the new position and dial', async () => {
    const before = position();
    const interaction = await press(guesser, `wl_nudge_${guesser.id}_5`);
    assert.deepEqual(callTypes(interaction), ['deferUpdate', 'editReply']);
    assert.equal(position(), before + 5);
    const panel = lastEdit(interaction);
    assert.match(panel.content, new RegExp(`\\*\\*${before + 5}\\*\\*`));
    assert.equal(panel.files.length, 1);
    assert.deepEqual(panel.attachments, [], 'the old dial image is replaced, not stacked');
  });

  it('downloads the avatar once for repeated nudges', async () => {
    await press(guesser, 'wl_guess_panel');
    for (const delta of [1, 1, -1, 5, -5]) await press(guesser, `wl_nudge_${guesser.id}_${delta}`);
    assert.equal(avatar.calls, 1);
  });

  it('a failed avatar download is not cached, so the next image retries it', async () => {
    avatar.mode = 'fail';
    const first = await press(guesser, `wl_nudge_${guesser.id}_1`);
    assert.equal(lastEdit(first).files.length, 1, 'still drawn, with the initial instead');
    avatar.mode = 'ok';
    await press(guesser, `wl_nudge_${guesser.id}_-1`);
    await press(guesser, `wl_nudge_${guesser.id}_1`);
    assert.equal(avatar.calls, 2);
  });

  it('a slow avatar times out and the panel still renders', async () => {
    avatar.mode = 'hang';
    const started = Date.now();
    const interaction = await press(guesser, `wl_nudge_${guesser.id}_-1`);
    assert.ok(Date.now() - started < 1000, 'did not wait for the avatar');
    assert.deepEqual(callTypes(interaction), ['deferUpdate', 'editReply']);
    assert.equal(lastEdit(interaction).files.length, 1);
    assert.equal(avatar.requests[0].destroyed, true, 'the hung request is abandoned');
    assert.equal(imageGen.avatarCache.size, 0, 'and forgotten so it can be retried');
  });

  it('checks happen before deferring and answer privately', async () => {
    const interaction = await press(other, `wl_nudge_${guesser.id}_5`);
    assert.deepEqual(callTypes(interaction), ['reply']);
    assert.deepEqual(interaction.replies(), ['This is not your guess panel.']);
    assert.equal(interaction.deferred, false);
  });

  it('Type a number opens a modal prefilled with the current position', async () => {
    const interaction = await press(guesser, `wl_guess_type_${guesser.id}`);
    assert.equal(interaction.modal(), `wl_guess_modal_${guesser.id}`);
    assert.deepEqual((await press(other, `wl_guess_type_${guesser.id}`)).replies(), ['This is not your guess panel.']);
  });

  it('the modal sets the position and updates the panel', async () => {
    const interaction = await press(guesser, `wl_guess_modal_${guesser.id}`, { kind: 'modal', fields: { wl_guess_input: ' 42 ' } });
    assert.equal(position(), 42);
    assert.deepEqual(callTypes(interaction), ['deferUpdate', 'editReply']);
    assert.match(lastEdit(interaction).content, /\*\*42\*\*/);
    await press(guesser, `wl_guess_modal_${guesser.id}`, { kind: 'modal', fields: { wl_guess_input: '0' } });
    assert.equal(position(), 0);
    await press(guesser, `wl_guess_modal_${guesser.id}`, { kind: 'modal', fields: { wl_guess_input: '100' } });
    assert.equal(position(), 100);
  });

  it('the modal rejects anything but a whole number from 0 to 100', async () => {
    for (const bad of ['abc', '101', '4.5', '-1', '', '1e2']) {
      const interaction = await press(guesser, `wl_guess_modal_${guesser.id}`, { kind: 'modal', fields: { wl_guess_input: bad } });
      assert.deepEqual(callTypes(interaction), ['reply'], `input ${JSON.stringify(bad)}`);
      assert.match(interaction.replies()[0], /whole number from \*\*0\*\* to \*\*100\*\*/);
      assert.equal(position(), 100);
    }
    const stranger = await press(other, `wl_guess_modal_${guesser.id}`, { kind: 'modal', fields: { wl_guess_input: '10' } });
    assert.deepEqual(stranger.replies(), ['This is not your guess panel.']);
    assert.equal(position(), 100);
  });

  it('submit defers, then locks the panel: every button disabled', async () => {
    const interaction = await press(guesser, `wl_submit_${guesser.id}`);
    assert.equal(game.guesses.get(guesser.id).submitted, true);
    assert.equal(game.phase, 'guessing', 'the other guesser has not submitted yet');
    assert.deepEqual(callTypes(interaction).slice(0, 2), ['deferUpdate', 'editReply']);
    const panel = lastEdit(interaction);
    assert.match(panel.content, /Locked in at position \*\*100\*\*/);
    for (const id of allCustomIds(panel)) assert.equal(findComponent(panel, id).disabled, true, id);
  });

  it('after submitting, nudges, Type a number and the modal are refused', async () => {
    assert.deepEqual((await press(guesser, `wl_nudge_${guesser.id}_-5`)).replies(), ['✅ You have already submitted your guess.']);
    assert.deepEqual((await press(guesser, `wl_guess_type_${guesser.id}`)).replies(), ['✅ You have already submitted your guess.']);
    const modal = await press(guesser, `wl_guess_modal_${guesser.id}`, { kind: 'modal', fields: { wl_guess_input: '3' } });
    assert.deepEqual(modal.replies(), ['✅ You have already submitted your guess.']);
    assert.deepEqual((await press(guesser, `wl_submit_${guesser.id}`)).replies(), ['✅ Already submitted.']);
    assert.equal(position(), 100);
  });
});
