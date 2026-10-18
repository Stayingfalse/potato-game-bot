'use strict';

/** Tests for Hues & Clues (src/games/huesclues). */

const { src } = require('./helpers/env');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly, allCustomIds,
} = require('./helpers/discord');

const huesClues = src('games/huesclues/index.js');
const repository = src('games/huesclues/repository');
const HuesCluesGameState = src('games/huesclues/state');
const { HuesCluesManager } = src('games/huesclues/manager');
const board = src('games/huesclues/board');
const rules = src('games/huesclues/rules');
const stats = src('games/huesclues/stats');

const managers = [];
const newManager = () => { const m = new HuesCluesManager(); managers.push(m); return m; };
after(() => { for (const m of managers) for (const game of m.games.values()) m.clearTimers(game); });

const cell = ref => board.parseCell(ref);

describe('the board', () => {
  it('reads grid refs either way round, and rejects squares off the board', () => {
    assert.deepEqual(cell('F12'), { row: 5, col: 11 });
    assert.deepEqual(cell(' f 12 '), { row: 5, col: 11 });
    assert.deepEqual(cell('12F'), { row: 5, col: 11 });
    assert.deepEqual(cell('A1'), { row: 0, col: 0 });
    assert.deepEqual(cell('P30'), { row: 15, col: 29 });
    for (const bad of ['Q1', 'A0', 'A31', 'F', '12', 'FF12', '']) assert.equal(cell(bad), null, bad);
    assert.equal(board.formatCell({ row: 15, col: 29 }), 'P30');
  });

  it('gives every square a fixed colour and draws well-spread cards', () => {
    assert.match(board.cellColor({ row: 0, col: 0 }), /^#[0-9a-f]{6}$/);
    assert.equal(board.cellColor(cell('H9')), board.cellColor(cell('H9')));
    assert.notEqual(board.cellColor(cell('H9')), board.cellColor(cell('H10')));
    for (let i = 0; i < 50; i++) {
      const card = board.drawCard();
      assert.equal(card.length, 4);
      for (const a of card) for (const b of card) if (a !== b) assert.ok(board.distance(a, b) >= 3);
    }
  });
});

describe('the rules', () => {
  it('checks clue length, colour names and grid refs', () => {
    assert.deepEqual(rules.validateClue('  Ocean ', 1), { ok: true, clue: 'Ocean' });
    assert.equal(rules.validateClue('deep ocean', 1).ok, false);
    assert.deepEqual(rules.validateClue('deep   ocean', 2), { ok: true, clue: 'deep ocean' });
    assert.equal(rules.validateClue('very deep ocean', 2).ok, false);
    for (const banned of ['Red', 'blueish', 'sky-blue', 'greys', 'F12', '12f']) {
      assert.equal(rules.validateClue(banned, 1).ok, false, banned);
    }
    for (const allowed of ['Reddit', 'bluebell', 'sky', 'teal', 'Fire']) assert.equal(rules.validateClue(allowed, 1).ok, true, allowed);
    assert.equal(rules.validateClue('', 1).ok, false);
  });

  it('scores each token 3 / 2 / 1 by distance; the cue giver gets 1 per token in the frame', () => {
    const target = cell('F12');
    const scores = rules.scoreTurn(target, {
      a: [cell('F12'), cell('G13')], // on it, in the frame
      b: [cell('D10'), cell('J1')],  // touching the frame, miss
      c: [null, cell('E11')],        // no first token, in the frame
    }, 'cue');
    assert.deepEqual(scores.guessers, {
      a: { points: [3, 2], total: 5 },
      b: { points: [1, 0], total: 1 },
      c: { points: [0, 2], total: 2 },
    });
    assert.deepEqual(scores.cueGiver, { id: 'cue', inFrame: 3, total: 3 });
  });
});

describe('a game through the real command and buttons', () => {
  const thread = createThread('hc-thread');
  const channel = createChannel('hc-channel', thread);
  const manager = newManager();
  const client = createClient([thread, channel], { huesCluesManager: manager });
  const HOST = user('host', 'Host'), A = user('a', 'Ann'), B = user('b', 'Bob');
  const users = { host: HOST, a: A, b: B };
  let game;
  const sessionMessage = () => thread.store.get(game.messageId);
  const turnMessage = () => thread.store.get(game.turnMessageId);
  const text = message => JSON.stringify(message.payload.components);
  const pings = () => thread.sent.filter(p => p.content).map(p => p.content);

  const interact = async (from, customId, { kind = 'button', fields = {}, message = null } = {}) => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, kind, fields, message });
    const { logs } = await quietly(() => huesClues.handleInteraction(interaction, client));
    assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'));
    return interaction;
  };
  const press = (from, customId) => interact(from, customId, { message: game.phase === 'lobby' || game.phase === 'setup' ? sessionMessage() : turnMessage() });
  const panel = interaction => interaction.calls.filter(([type]) => type === 'editReply').at(-1)?.[1];

  it('/huesclues start opens a thread with the lobby, and refuses a second game', async () => {
    const start = slashCommand({ sub: 'start', user: HOST, channel });
    await huesClues.command.execute(start, client);
    game = manager.getGame(thread.id);
    assert.ok(game.messageId);
    assert.match(start.replies()[0], /game created/);
    assert.ok(text(sessionMessage()).includes('hc_join'));

    const again = slashCommand({ sub: 'start', user: HOST, channel });
    await huesClues.command.execute(again, client);
    assert.match(again.replies()[0], /^You already have an active/);
  });

  it('lobby: join and leave; only the host starts, with at least 2 players', async () => {
    assert.deepEqual((await press(HOST, 'hc_start')).replies(), ['Need at least **2 players** to start. Currently: **1**.']);
    await press(A, 'hc_join');
    assert.deepEqual((await press(A, 'hc_join')).replies(), ['You are already in the game.']);
    await press(B, 'hc_join');
    await press(B, 'hc_leave');
    await press(B, 'hc_join');
    assert.deepEqual([...game.players.keys()], ['host', 'a', 'b']);
    assert.ok(thread.memberIds.has('b'));
    assert.deepEqual((await press(A, 'hc_start')).replies(), ['Only the host can start the game.']);
    await press(HOST, 'hc_start');
    assert.equal(game.phase, 'setup');
    assert.deepEqual([...game.turnOrder].sort(), ['a', 'b', 'host'], 'cue giver order is shuffled from the players');
  });

  it('setup: the host picks a mode and its X, can reshuffle, then starts', async () => {
    assert.deepEqual(allCustomIds(sessionMessage().payload).filter(id => id.startsWith('hc_mode')), ['hc_mode_turns', 'hc_mode_points', 'hc_mode_endless']);
    assert.deepEqual((await press(A, 'hc_mode_turns')).replies(), ['Only the host can set up the game.']);
    await press(HOST, 'hc_mode_turns');
    assert.ok(text(sessionMessage()).includes('2 each (official)'), 'official count for 3 players is 2');
    await press(HOST, 'hc_mode_back');
    assert.equal(game.sessionMode, null);
    await press(HOST, 'hc_mode_turns');
    await press(HOST, 'hc_target_1');
    assert.deepEqual(game.sessionMode, { type: 'clue_turns', target: 1 });
    assert.equal(game.autoAdvanceRounds, true, 'auto-advance is on by default');
    await press(HOST, 'hc_reshuffle');
    assert.equal(game.turnOrder.length, 3);

    await press(HOST, 'hc_begin');
    assert.equal(game.phase, 'picking');
    assert.equal(game.cueGiverId, game.turnOrder[0]);
    assert.ok(text(sessionMessage()).includes('Game On'), 'the setup message becomes a record of the order');
    assert.ok(game.turnMessageId && game.turnMessageId !== game.messageId, 'each turn gets its own message');
    assert.ok(text(turnMessage()).includes('hc_cue_panel'));
    assert.match(pings().at(-1), new RegExp(`^<@${game.cueGiverId}> — you're the cue giver`));
  });

  let cue, guessers;
  it('the cue giver sees their card, picks a colour and gives a valid one-word clue', async () => {
    cue = users[game.cueGiverId];
    guessers = game.turnOrder.filter(id => id !== cue.id).map(id => users[id]);
    game.card = ['B4', 'F12', 'M21', 'I28'].map(cell);

    assert.deepEqual((await press(guessers[0], 'hc_cue_panel')).replies(), ['Only the cue giver can do that.']);
    const opened = await press(cue, 'hc_cue_panel');
    assert.match(panel(opened).content, /Your card:.*F12/);
    assert.ok(panel(opened).files.length === 1, 'the card image is attached');
    assert.deepEqual((await interact(cue, 'hc_clue1')).replies(), ['Pick a colour from your card first.']);

    await interact(cue, 'hc_pick_1');
    assert.deepEqual(game.target, cell('F12'));
    assert.equal((await interact(cue, 'hc_clue1')).modal(), 'hc_clue1_modal');

    const tooLong = await interact(cue, 'hc_clue1_modal', { kind: 'modal', fields: { hc_clue_input: 'lime fizz' } });
    assert.match(tooLong.replies()[0], /at most \*\*1 word\*\*/);
    const colour = await interact(cue, 'hc_clue1_modal', { kind: 'modal', fields: { hc_clue_input: 'Greenish' } });
    assert.match(colour.replies()[0], /No basic colour names/);
    assert.equal(game.phase, 'picking');

    await interact(cue, 'hc_clue1_modal', { kind: 'modal', fields: { hc_clue_input: 'Lime' } });
    assert.equal(game.phase, 'guessing');
    assert.deepEqual(game.clues, ['Lime']);
    assert.ok(text(turnMessage()).includes('Lime'));
    assert.ok(text(turnMessage()).includes('hc_guess_panel'));
    assert.match(pings().at(-1), /the clue is in!/);
  });

  it('guessers line up a token with a grid ref and the arrows, then lock in', async () => {
    const [g1, g2] = guessers;
    assert.deepEqual((await press(cue, 'hc_guess_panel')).replies(), ['You\'re the cue giver this turn — sit tight!']);
    const opened = await press(g1, 'hc_guess_panel');
    assert.match(panel(opened).content, /first token is on \*\*H15\*\*/, 'starts in the middle of the board');

    assert.equal((await interact(g1, 'hc_type_ref')).modal(), 'hc_ref_modal');
    const bad = await interact(g1, 'hc_ref_modal', { kind: 'modal', fields: { hc_ref_input: 'Z99' } });
    assert.match(bad.replies()[0], /isn't a square on the board/);
    await interact(g1, 'hc_ref_modal', { kind: 'modal', fields: { hc_ref_input: 'e11' } });
    await interact(g1, 'hc_move_right');
    const moved = await interact(g1, 'hc_move_down');
    assert.match(panel(moved).content, /on \*\*F12\*\*/);

    const locked = await interact(g1, 'hc_lock');
    assert.match(panel(locked).content, /locked in at \*\*F12\*\*/);
    assert.deepEqual((await interact(g1, 'hc_move_up')).replies(), ['Your token is already locked in for this round.']);
    assert.equal(game.phase, 'guessing');
    assert.match(pings().at(-1), new RegExp(`^<@${g2.id}> — just you left`));

    await interact(g2, 'hc_ref_modal', { kind: 'modal', fields: { hc_ref_input: 'A1' } });
    await interact(g2, 'hc_move_up'); // can't go off the board
    await interact(g2, 'hc_lock');
    assert.deepEqual(game.tokens.get(g2.id).cells, [cell('A1')]);
  });

  it('once every first token is in, the cue giver gives a second clue', async () => {
    assert.equal(game.phase, 'followup');
    assert.ok(text(turnMessage()).includes('hc_no_more'));
    assert.ok(turnMessage().payload.files.length === 1, 'the board with everyone\'s first tokens is shown');
    assert.match(pings().at(-1), new RegExp(`^<@${cue.id}> — everyone has placed a token`));

    assert.deepEqual((await press(guessers[0], 'hc_clue2')).replies(), ['Only the cue giver can do that.']);
    assert.equal((await press(cue, 'hc_clue2')).modal(), 'hc_clue2_modal');
    const tooLong = await interact(cue, 'hc_clue2_modal', { kind: 'modal', fields: { hc_clue_input: 'fresh cut grass' } });
    assert.match(tooLong.replies()[0], /at most \*\*2 words\*\*/);
    await interact(cue, 'hc_clue2_modal', { kind: 'modal', fields: { hc_clue_input: 'fresh grass' } });
    assert.equal(game.phase, 'guessing');
    assert.equal(game.guessRound, 2);
    assert.deepEqual(game.clues, ['Lime', 'fresh grass']);
  });

  it('second tokens can\'t go on a square with a first token', async () => {
    const [g1, g2] = guessers;
    // Second tokens start on your own first token, which is off limits.
    const opened = await press(g1, 'hc_guess_panel');
    assert.match(panel(opened).content, /\*\*F12\*\* already has your first token/);
    const lockButton = panel(opened).components.flatMap(row => row.toJSON().components).find(c => c.custom_id === 'hc_lock');
    assert.equal(lockButton.disabled, true);
    assert.match((await interact(g1, 'hc_lock')).replies()[0], /^❌ \*\*F12\*\* already has your first token/);

    // Typing someone else's first square is refused, naming them; the token stays put.
    const typed = await interact(g2, 'hc_ref_modal', { kind: 'modal', fields: { hc_ref_input: 'F12' } });
    assert.match(typed.replies()[0], new RegExp(`^❌ \\*\\*F12\\*\\* already has \\*\\*${g1.username}'s\\*\\* first token`));
    assert.deepEqual(game.tokens.get(g2.id).draft, cell('A1'));

    // The arrows can pass over a first token, but the panel says so and won't lock.
    await interact(g1, 'hc_ref_modal', { kind: 'modal', fields: { hc_ref_input: 'A2' } });
    const onA1 = await interact(g1, 'hc_move_left');
    assert.match(panel(onA1).content, new RegExp(`\\*\\*A1\\*\\* already has \\*\\*${g2.username}'s\\*\\* first token`));
    assert.equal(game.tokens.get(g1.id).cells.length, 1, 'not locked');
  });

  it('the turn is scored when every second token is in', async () => {
    const [g1, g2] = guessers;
    await interact(g1, 'hc_ref_modal', { kind: 'modal', fields: { hc_ref_input: 'F11' } });
    const ready = await interact(g1, 'hc_move_down');
    await interact(g1, 'hc_move_up');
    assert.match(panel(ready).content, /token is on \*\*G11\*\*/);
    await interact(g1, 'hc_lock');
    await interact(g2, 'hc_ref_modal', { kind: 'modal', fields: { hc_ref_input: 'H14' } });
    const resultsBefore = game.turnMessageId;
    await interact(g2, 'hc_lock');

    assert.equal(game.phase, 'ended');
    const turn = game.sessionHistory[0];
    assert.deepEqual(turn.scores.guessers, {
      [g1.id]: { points: [3, 2], total: 5 }, // F12, F11
      [g2.id]: { points: [0, 1], total: 1 }, // A1, H14
    });
    assert.deepEqual(turn.scores.cueGiver, { id: cue.id, inFrame: 2, total: 2 });

    assert.notEqual(game.turnMessageId, resultsBefore, 'results are posted as a fresh message');
    assert.ok(text(thread.store.get(resultsBefore)).includes('results'), 'the old turn message points to them');
    const results = text(turnMessage());
    assert.ok(results.includes('Turn 1 Results'));
    assert.ok(results.includes('attachment://huesclues_reveal.png'));
    assert.ok(!results.includes('pts**'), 'scores live in the image, not the text');
    assert.match(results, /Next turn <t:\d+:R>/);
    assert.ok(game.advanceAt > Date.now() && game.autoAdvanceTimeout, 'the next turn is scheduled');
  });

  it('records stats for the cue giver and guessers', () => {
    const [g1, g2] = guessers;
    assert.deepEqual(stats.scoreboard('guild-1').map(r => [r.user_id, r.total_score, r.bullseyes]), [[g1.id, 5, 1], [cue.id, 2, 0], [g2.id, 1, 0]]);
    assert.equal(stats.getPlayer('guild-1', cue.id).turns_as_cue_giver, 1);
  });

  it('auto-advance can be switched off, and the host starts the next turn instead', async () => {
    const notHost = users[game.turnOrder.find(id => id !== 'host')];
    assert.deepEqual((await press(notHost, 'hc_toggle_auto')).replies(), ['Only the host can change auto-advance.']);
    await press(HOST, 'hc_toggle_auto');
    assert.equal(game.autoAdvanceRounds, false);
    assert.equal(game.advanceAt, null);
    assert.equal(game.autoAdvanceTimeout, null);
    assert.ok(text(turnMessage()).includes('hc_next'));

    const results = turnMessage();
    await press(HOST, 'hc_next');
    assert.equal(game.phase, 'picking');
    assert.equal(game.gameNumber, 2);
    assert.equal(game.cueGiverId, game.turnOrder[1]);
    assert.deepEqual(allCustomIds(results.payload), [], 'the old results lose their buttons');
  });

  it('the host can lock the remaining tokens if someone is away', async () => {
    const turnCue = users[game.cueGiverId];
    await interact(turnCue, 'hc_pick_0');
    await interact(turnCue, 'hc_clue1_modal', { kind: 'modal', fields: { hc_clue_input: 'Sky' } });
    const waiting = game.waitingGuesserIds();
    assert.equal(waiting.length, 2);
    const [first] = waiting;
    await interact(users[first], 'hc_lock');

    const notHost = game.turnOrder.find(id => id !== 'host');
    assert.deepEqual((await press(users[notHost], 'hc_force_lock')).replies(), ['Only the host can lock the remaining tokens.']);
    await press(HOST, 'hc_force_lock');
    assert.equal(game.phase, 'followup');
    const [, absent] = waiting;
    assert.deepEqual(game.tokens.get(absent).cells, [null]);
  });

  it('finishes the session when everyone has given their clues', async () => {
    const turnCue = users[game.cueGiverId];
    await press(turnCue, 'hc_no_more');
    assert.deepEqual(game.clues, ['Sky', null]);
    await press(HOST, 'hc_force_lock');
    assert.equal(game.phase, 'ended');
    await press(HOST, 'hc_next');

    // Turn 3: the last player clues.
    const lastCue = users[game.cueGiverId];
    await interact(lastCue, 'hc_pick_2');
    await interact(lastCue, 'hc_clue1_modal', { kind: 'modal', fields: { hc_clue_input: 'Dusk' } });
    await press(HOST, 'hc_force_lock');
    await press(lastCue, 'hc_no_more');
    await press(HOST, 'hc_force_lock');

    assert.equal(game.phase, 'ended');
    assert.equal(rules.evaluateSessionGoal(game).complete, true);
    assert.ok(text(turnMessage()).includes('Session over'));
    assert.match((await press(HOST, 'hc_next')).replies()[0], /session is over/);
  });

  it('New Game reopens the lobby; Close ends the session and archives the thread', async () => {
    await press(HOST, 'hc_new_game');
    assert.equal(game.phase, 'lobby');
    assert.deepEqual(game.sessionHistory, []);
    assert.equal(game.players.size, 3, 'players stay signed up');
    assert.ok(text(sessionMessage()).includes('Lobby Open'));

    await press(HOST, 'hc_close');
    assert.equal(manager.getGame(thread.id), null);
    assert.ok(JSON.stringify(thread.sent.at(-1).components).includes('Session Closed'));
    assert.deepEqual(repository.getAll(), []);
  });
});

describe('simultaneous lock-ins', () => {
  it('post the results once', async () => {
    const thread = createThread('hc-race');
    const manager = newManager();
    const client = createClient([thread], { huesCluesManager: manager });
    const game = manager.createGame('guild-4', 'C', thread.id, 'h', 'Host');
    for (const id of ['h', 'x', 'y']) manager.addPlayer(thread.id, user(id));
    manager.beginSetup(game);
    manager.setSessionMode(game, { type: 'endless' });
    game.autoAdvanceRounds = false;
    manager.startTurn(game);
    manager.pickColour(game, 0);
    manager.giveClue(game, 1, 'Sea');
    manager.lockRemaining(game);
    manager.openFollowup(game);
    manager.giveClue(game, 2, null);

    const [g1, g2] = game.waitingGuesserIds().map(id => user(id));
    const lock = from => huesClues.handleInteraction(componentInteraction({ customId: 'hc_lock', user: from, channelId: thread.id }), client);
    await quietly(() => Promise.all([lock(g1), lock(g2)]));

    assert.equal(game.phase, 'ended');
    assert.equal(game.sessionHistory.length, 1);
    const resultsMessages = thread.sent.filter(p => JSON.stringify(p.components ?? []).includes('Results'));
    assert.equal(resultsMessages.length, 1);
  });
});

describe('auto-advance', () => {
  it('starts the next turn when the countdown runs out', async () => {
    const thread = createThread('hc-auto');
    const manager = newManager();
    const client = createClient([thread], { huesCluesManager: manager });
    const game = manager.createGame('guild-2', 'C', thread.id, 'h', 'Host');
    manager.addPlayer(thread.id, user('h'));
    manager.addPlayer(thread.id, user('x'));
    manager.beginSetup(game);
    manager.setSessionMode(game, { type: 'endless' });
    manager.startTurn(game);
    manager.pickColour(game, 0);
    manager.giveClue(game, 1, 'Sea');
    manager.lockRemaining(game);
    manager.openFollowup(game);
    manager.giveClue(game, 2, null);
    manager.lockRemaining(game);
    manager.finishTurn(game);

    const { scheduleAutoAdvance } = src('games/huesclues/flow');
    game.advanceAt = Date.now() + 20;
    scheduleAutoAdvance(game, client);
    await quietly(() => new Promise(resolve => setTimeout(resolve, 80)));
    assert.equal(game.phase, 'picking');
    assert.equal(game.gameNumber, 2);
  });
});

describe('restore', () => {
  it('brings back a turn mid-guessing, redrawn in place', async () => {
    const thread = createThread('hc-restore');
    const saving = newManager();
    const game = saving.createGame('guild-3', 'C', thread.id, 'h', 'Host');
    saving.addPlayer(thread.id, user('h'));
    saving.addPlayer(thread.id, user('y'));
    saving.beginSetup(game);
    saving.setSessionMode(game, { type: 'first_to_points', target: 25 });
    saving.startTurn(game);
    saving.pickColour(game, 2);
    saving.giveClue(game, 1, 'Moss');
    const guesser = game.waitingGuesserIds()[0];
    saving.setDraft(game, guesser, cell('C3'));
    game.turnMessageId = (await thread.send({})).id;
    repository.upsert(game);

    const restored = newManager();
    await quietly(() => huesClues.restore(createClient([thread], { huesCluesManager: restored })));
    const back = restored.getGame(thread.id);
    assert.ok(back instanceof HuesCluesGameState);
    assert.equal(back.phase, 'guessing');
    assert.deepEqual(back.target, game.target);
    assert.deepEqual(back.clues, ['Moss']);
    assert.deepEqual(back.tokens.get(guesser).draft, cell('C3'));
    assert.deepEqual(back.sessionMode, { type: 'first_to_points', target: 25 });
    assert.equal(thread.sent.length, 1, 'redrawn in place');
    assert.ok(JSON.stringify(thread.store.get(back.turnMessageId).payload.components).includes('hc_guess_panel'));
  });

  it('drops a saved game whose thread is gone', async () => {
    await quietly(() => huesClues.restore(createClient([], { huesCluesManager: newManager() })));
    assert.deepEqual(repository.getAll(), []);
  });
});

describe('/huesclues end', () => {
  it('is refused for other players and allowed for the host', async () => {
    const thread = createThread('hc-end');
    const channel = createChannel('hc-end-channel', thread);
    const manager = newManager();
    const client = createClient([thread, channel], { huesCluesManager: manager });
    await huesClues.command.execute(slashCommand({ sub: 'start', user: user('h', 'Host'), channel }), client);

    const other = slashCommand({ sub: 'end', user: user('z'), channel, channelId: thread.id });
    await huesClues.command.execute(other, client);
    assert.match(other.replies()[0], /^Only the game creator/);

    await huesClues.command.execute(slashCommand({ sub: 'end', user: user('h'), channel, channelId: thread.id }), client);
    assert.equal(manager.getGame(thread.id), null);
  });
});
