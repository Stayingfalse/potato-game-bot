'use strict';

const { src } = require('./helpers/env');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly,
} = require('./helpers/discord');

// Stay offline: avatar downloads for the dial images fail straight away.
https.get = () => {
  const request = new EventEmitter();
  setImmediate(() => request.emit('error', new Error('offline in tests')));
  return request;
};

// ── A table from before the six later columns, with a saved lobby ──────────────
const db = src('db/database');
db.exec(`CREATE TABLE wavelength_games (thread_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  host_id TEXT NOT NULL, host_username TEXT NOT NULL, message_id TEXT, phase TEXT NOT NULL DEFAULT 'lobby',
  players TEXT NOT NULL DEFAULT '[]', clue_giver_id TEXT, spectrum_options TEXT NOT NULL DEFAULT '[]', chosen_spectrum TEXT,
  target_position INTEGER, clue TEXT, guesses TEXT NOT NULL DEFAULT '{}', game_number INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL)`);
db.prepare(`INSERT INTO wavelength_games (thread_id, guild_id, channel_id, host_id, host_username, phase, players, created_at)
  VALUES ('old1', 'G', 'C', 'h', 'Host', 'lobby', '[{"id":"h","username":"Host","avatarURL":""}]', 5)`).run();

const repository = src('games/wavelength/repository');
const WavelengthGameState = src('games/wavelength/state');
const { WavelengthManager, MIN_PLAYERS } = src('games/wavelength/manager');
const wavelength = src('games/wavelength/index.js');

const managers = [];
const newManager = () => { const m = new WavelengthManager(); managers.push(m); return m; };
after(() => { for (const m of managers) for (const game of m.games.values()) m.clearTimers(game); });

describe('upgrading an older wavelength_games table', () => {
  it('adds the missing columns, matching a fresh install', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'games', 'wavelength', 'repository.js'), 'utf8').match(/const SCHEMA = `([\s\S]*?)`;/)[1];
    const fresh = new Database(':memory:');
    fresh.exec(schema);
    const shape = table => table.map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(shape(db.prepare('PRAGMA table_info(wavelength_games)').all()), shape(fresh.prepare('PRAGMA table_info(wavelength_games)').all()));
  });

  it('loads the saved game with defaults for the new columns', () => {
    const game = WavelengthGameState.fromRow(repository.getAll()[0]);
    assert.equal(game.gamePace, 'realtime');
    assert.equal(game.autoAdvanceRounds, false);
    assert.deepEqual(game.sessionHistory, []);
    assert.equal(game.roundMessageId, null);
    assert.ok(game.players instanceof Map);
    repository.remove('old1');
  });

  it('round-trips a game in progress through save and load', () => {
    const manager = newManager();
    const game = manager.createGame('G', 'C', 'rt', 'h', 'Host');
    manager.addPlayer('rt', user('h', 'Host'));
    manager.addPlayer('rt', user('b', 'Bee'));
    manager.setSessionMode('rt', { type: 'endless', clueOrder: 'snake' });
    manager.startGame('rt', [{ left: 'Cold', right: 'Hot' }, { left: 'Bad', right: 'Good' }]);
    game.clue = 'lava';
    game.autoAdvanceRounds = true;
    repository.upsert(game);
    const reloaded = WavelengthGameState.fromRow(repository.getAll().find(r => r.thread_id === 'rt'));
    assert.deepEqual(WavelengthGameState.toRow(reloaded), WavelengthGameState.toRow(game));
    manager.deleteGame('rt');
    assert.equal(MIN_PLAYERS, 2);
  });
});

describe('a full session through the real command and handlers', () => {
  const thread = createThread('wl-thread');
  const channel = createChannel('wl-channel', thread);
  const manager = newManager();
  const client = createClient([thread, channel], { wavelengthManager: manager });
  const H = user('h', 'Host'), B = user('b', 'Bee'), C = user('c', 'Cee');
  let game;

  const press = async (from, customId, fields, kind = 'button') => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, kind, fields });
    await quietly(() => wavelength.handleInteraction(interaction, client));
    return interaction;
  };

  it('/wavelength start opens the game thread with the lobby', async () => {
    const start = slashCommand({ sub: 'start', user: H, channel });
    await wavelength.command.execute(start, client);
    game = manager.getGame(thread.id);
    assert.ok(game.messageId);
    assert.match(start.replies()[0], /game created/);
  });

  it('lobby: needs two players; join and leave; only the host starts', async () => {
    assert.deepEqual((await press(H, 'wl_start')).replies(), ['Need at least **2 players** to start. Currently: **1**.']);
    await press(B, 'wl_join'); await press(C, 'wl_join'); await press(C, 'wl_leave');
    assert.deepEqual([...game.players.keys()], ['h', 'b']);
    assert.equal(game.players.get('b').avatarURL, 'https://cdn.invalid/b.png');
    assert.deepEqual((await press(B, 'wl_start')).replies(), ['Only the host can start the game.']);
    await press(H, 'wl_start');
    assert.equal(game.phase, 'setup');
  });

  it('setup: endless, round robin, real time → the first round starts', async () => {
    await press(H, 'wl_mode_endless');
    await press(H, 'wl_endless_order_round_robin');
    assert.deepEqual(game.sessionMode, { type: 'endless', clueOrder: 'round_robin' });
    await press(H, 'wl_pace_realtime');
    await press(H, 'wl_confirm_options');
    assert.equal(game.phase, 'cluing');
    assert.equal(game.clueGiverId, 'h');
    assert.ok(game.roundMessageId);
    assert.ok(thread.sent.at(-1).content.startsWith('<@h> — please give us your clue'));
  });

  it('cluing: only the clue giver picks the spectrum and gives the clue', async () => {
    assert.deepEqual((await press(B, 'wl_open_cg_panel')).replies(), ['Only the Clue Giver can open this panel.']);
    await press(H, 'wl_spectrum_0');
    assert.deepEqual(game.chosenSpectrum, game.spectrumOptions[0]);
    assert.equal((await press(H, 'wl_enter_clue')).modal(), 'wl_clue_modal');
    await press(H, 'wl_clue_modal', { wl_clue_input: 'Volcano' }, 'modal');
    assert.equal(game.phase, 'guessing');
    assert.ok(game.guessTimeout, 'real-time guess timer');
  });

  it('guessing: nudge and submit; the round ends and stats are recorded', async () => {
    await press(B, 'wl_guess_panel');
    await press(B, 'wl_nudge_b_25');
    assert.equal(game.guesses.get('b').position, 75);
    assert.deepEqual((await press(H, 'wl_nudge_b_5')).replies(), ['This is not your guess panel.']);
    await press(B, 'wl_submit_b');
    assert.equal(game.phase, 'ended');
    assert.equal(game.guessTimeout, null);
    const stats = db.prepare("SELECT user_id FROM wavelength_player_stats WHERE guild_id = 'guild-1' ORDER BY user_id").all();
    assert.deepEqual(stats.map(s => s.user_id), ['b', 'h']);
  });

  it('between rounds the session is still open, so the host can\'t start another', async () => {
    const again = slashCommand({ sub: 'start', user: H, channel });
    await wavelength.command.execute(again, client);
    assert.match(again.replies()[0], /^You already have an active \*\*Wavelength\*\* game/);
  });

  it('auto-advance, then closing the session stops every timer and deletes the game', async () => {
    await press(H, 'wl_toggle_autoadvance');
    assert.equal(game.autoAdvanceRounds, true);
    const autoTimer = game.autoAdvanceTimeout;
    assert.ok(autoTimer);
    await press(H, 'wl_close_session');
    assert.equal(manager.getGame(thread.id), null);
    assert.equal(game.autoAdvanceTimeout, null);
    assert.ok(autoTimer._destroyed);
    assert.deepEqual(repository.getAll(), []);
    assert.ok(thread.sent.some(p => JSON.stringify(p.components ?? []).includes('Session Closed')));
  });
});

describe('restore', () => {
  const thread = createThread('wl-restore');

  it('re-arms the guess timer for a round in progress', async () => {
    const saving = newManager();
    const game = saving.createGame('G', 'C', thread.id, 'h', 'Host');
    saving.addPlayer(thread.id, user('h', 'Host'));
    saving.addPlayer(thread.id, user('b', 'Bee'));
    saving.setSessionMode(thread.id, { type: 'endless', clueOrder: 'random' });
    saving.startGame(thread.id, [{ left: 'a', right: 'b' }, { left: 'c', right: 'd' }]);
    game.chosenSpectrum = game.spectrumOptions[0];
    game.clue = 'x';
    game.phase = 'guessing';
    game.roundMessageId = (await thread.send({})).id;
    repository.upsert(game);

    const restored = newManager();
    await quietly(() => wavelength.restore(createClient([thread], { wavelengthManager: restored })));
    const back = restored.getGame(thread.id);
    assert.ok(back instanceof WavelengthGameState);
    assert.equal(back.phase, 'guessing');
    assert.ok(back.guessTimeout);
  });

  it('re-arms auto-advance between rounds', async () => {
    const previous = managers.at(-1).getGame(thread.id);
    managers.at(-1).clearTimers(previous);
    previous.phase = 'ended';
    previous.autoAdvanceRounds = true;
    repository.upsert(previous);

    const restored = newManager();
    await quietly(() => wavelength.restore(createClient([thread], { wavelengthManager: restored })));
    assert.ok(restored.getGame(thread.id).autoAdvanceTimeout);
    assert.equal(restored.getGame(thread.id).guessTimeout, null);
  });

  it('drops a saved game whose thread is gone', async () => {
    await quietly(() => wavelength.restore(createClient([], { wavelengthManager: newManager() })));
    assert.deepEqual(repository.getAll(), []);
  });
});
