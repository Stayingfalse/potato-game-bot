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
    const seconds = Math.round(game.guessEndsAt / 1000);
    assert.ok(Math.abs(game.guessEndsAt - (Date.now() + 3 * 60 * 1000)) < 5000, 'deadline is three minutes away');
    const roundMessage = await thread.messages.fetch(game.roundMessageId);
    assert.ok(JSON.stringify(roundMessage.payload.components).includes(`⏳ Guesses lock <t:${seconds}:R>`), 'deadline on the round message');
  });

  it('guessing: nudge and submit; the round ends and stats are recorded', async () => {
    await press(B, 'wl_guess_panel');
    await press(B, 'wl_nudge_b_25');
    assert.equal(game.guesses.get('b').position, 75);
    assert.deepEqual((await press(H, 'wl_nudge_b_5')).replies(), ['This is not your guess panel.']);
    await press(B, 'wl_submit_b');
    assert.equal(game.phase, 'ended');
    assert.equal(game.guessTimeout, null);
    assert.equal(game.guessEndsAt, null, 'deadline cleared when the round ends');
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
    // Saved 2½ minutes into the round: 30 seconds are left.
    game.guessEndsAt = Date.now() + 30_000;
    repository.upsert(game);

    const restored = newManager();
    await quietly(() => wavelength.restore(createClient([thread], { wavelengthManager: restored })));
    const back = restored.getGame(thread.id);
    assert.ok(back instanceof WavelengthGameState);
    assert.equal(back.phase, 'guessing');
    assert.ok(back.guessTimeout);
    assert.equal(back.guessEndsAt, game.guessEndsAt, 'the deadline is kept, not restarted');
    assert.ok(back.guessTimeout._idleTimeout <= 30_000 && back.guessTimeout._idleTimeout > 25_000,
      `re-armed for the remaining time, not 3 minutes (got ${back.guessTimeout._idleTimeout} ms)`);
  });

  it('a deadline that passed while the bot was down locks guesses straight away', async () => {
    const previous = managers.at(-1).getGame(thread.id);
    managers.at(-1).clearTimers(previous);
    previous.guessEndsAt = Date.now() - 1000;
    repository.upsert(previous);

    const restored = newManager();
    await quietly(() => wavelength.restore(createClient([thread], { wavelengthManager: restored })));
    const back = restored.getGame(thread.id);
    await quietly(() => waitFor(() => back.phase === 'ended'));
    assert.deepEqual(back.sessionHistory.at(-1).missedIds, [...back.guesses.keys()], 'the untouched guesser did not guess');
    // Back to a round in progress for the next test.
    restored.clearTimers(back);
    back.phase = 'guessing';
    back.guessEndsAt = null;
    repository.upsert(back);
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

/** Polls until `check()` is true (timers in these tests are a few milliseconds). */
async function waitFor(check, timeoutMs = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('the real-time guess deadline', () => {
  const handlers = src('games/wavelength/handlers');
  const { renderPublicClueText } = src('games/wavelength/phases/cluing');
  const H = user('h', 'Host'), B = user('b', 'Bee'), C = user('c', 'Cee'), D = user('d', 'Dee');

  /** A round in the guessing phase with `h` giving the clue and the others guessing. */
  function guessingRound(threadId, players, pace = 'realtime') {
    const thread = createThread(threadId);
    const manager = newManager();
    const client = createClient([thread], { wavelengthManager: manager });
    const game = manager.createGame('G2', 'C', threadId, 'h', 'Host');
    for (const p of players) manager.addPlayer(threadId, p);
    manager.setSessionMode(threadId, { type: 'endless', clueOrder: 'round_robin' });
    manager.setGameOptions(threadId, pace, false);
    manager.startGame(threadId, [{ left: 'Cold', right: 'Hot' }, { left: 'Bad', right: 'Good' }]);
    game.chosenSpectrum = game.spectrumOptions[0];
    game.clue = 'lava';
    game.targetPosition = 80;
    game.phase = 'guessing';
    const press = async (from, customId) => {
      const interaction = componentInteraction({ customId, user: from, channelId: threadId });
      await quietly(() => wavelength.handleInteraction(interaction, client));
      return interaction;
    };
    return { thread, manager, client, game, press };
  }

  const statsFor = userId => db.prepare("SELECT * FROM wavelength_player_stats WHERE guild_id = 'G2' AND user_id = ?").get(userId);

  it('stores the deadline on the game and shows it as a live countdown', async () => {
    const { client, game } = guessingRound('dl-1', [H, B]);
    await handlers.scheduleGuessTimeout(game, client, { now: 1_700_000_000_000 });
    assert.equal(game.guessEndsAt, 1_700_000_000_000 + 3 * 60 * 1000);
    assert.equal(repository.getAll().find(r => r.thread_id === 'dl-1').guess_ends_at, game.guessEndsAt);
    assert.match(renderPublicClueText(game), /⏳ Guesses lock <t:1700000180:R>/);
  });

  it('in turn-based pace there is no timer and the message says the round waits', async () => {
    const { client, game } = guessingRound('dl-2', [H, B], 'turnbased');
    await handlers.scheduleGuessTimeout(game, client);
    assert.equal(game.guessTimeout, null);
    assert.equal(game.guessEndsAt, null);
    const text = renderPublicClueText(game);
    assert.doesNotMatch(text, /Guesses lock/);
    assert.match(text, /waits for everyone/);
  });

  it('at the timeout an AFK player is left out; a player who only nudged still counts', async () => {
    const { client, game, press } = guessingRound('dl-3', [H, B, C, D]);
    await press(B, 'wl_nudge_b_25');      // moved to 75, never submitted
    await press(C, 'wl_nudge_c_25');
    await press(C, 'wl_submit_c');        // submitted at 75
    // D never opens the panel.
    await quietly(async () => {
      await handlers.scheduleGuessTimeout(game, client, { durationMs: 5 });
      await waitFor(() => game.phase === 'ended');
    });

    const round = game.sessionHistory.at(-1);
    assert.deepEqual(Object.keys(round.guesses).sort(), ['b', 'c'], 'only real guesses are kept (and drawn)');
    assert.deepEqual(round.missedIds, ['d']);
    assert.deepEqual(Object.keys(round.scores.guesserScores).sort(), ['b', 'c']);
    assert.equal(round.scores.avgPosition, 75, 'the AFK default of 50 does not pull the average');
    assert.equal(round.scores.deviation, 0);
    assert.equal(game.guessEndsAt, null);

    assert.ok(statsFor('b'), 'nudged-only guesser is in stats');
    assert.equal(statsFor('d'), undefined, 'AFK player has no stats row');

    const { renderRevealBreakdownText } = src('games/wavelength/phases/reveal');
    const text = renderRevealBreakdownText(game, round);
    assert.match(text, /😴 <@d> didn't guess/);
    assert.match(text, /<@b> — pos `75`/);
  });

  it('nobody guessed: the reveal still works and says so', async () => {
    const { client, game, thread } = guessingRound('dl-4', [H, B, C]);
    await quietly(async () => {
      await handlers.scheduleGuessTimeout(game, client, { durationMs: 1 });
      await waitFor(() => game.phase === 'ended');
    });

    const round = game.sessionHistory.at(-1);
    assert.deepEqual(round.guesses, {});
    assert.deepEqual(round.missedIds.sort(), ['b', 'c']);
    assert.equal(round.scores.avgPosition, null);
    assert.equal(round.scores.clueGiverScore.total, 0, 'no synergy bonus without guesses');
    const results = JSON.stringify(thread.sent.at(-1).components);
    assert.ok(results.includes('Nobody guessed this round.'));
    assert.ok(results.includes("😴 <@b> didn't guess"));
  });
});
