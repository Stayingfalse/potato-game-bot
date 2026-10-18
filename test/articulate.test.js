'use strict';

/** Tests for Articulate (src/games/articulate). */

const { src } = require('./helpers/env');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly, allCustomIds,
} = require('./helpers/discord');

const articulate = src('games/articulate/index.js');
const repository = src('games/articulate/repository');
const ArticulateGameState = src('games/articulate/state');
const { ArticulateManager } = src('games/articulate/manager');
const board = src('games/articulate/board');
const rules = src('games/articulate/rules');
const stats = src('games/articulate/stats');
const flow = src('games/articulate/flow');

const managers = [];
const newManager = () => { const m = new ArticulateManager(); managers.push(m); return m; };
after(() => { for (const m of managers) for (const game of m.games.values()) m.clearTimers(game); });

/** Runs `fn` with Math.random returning `value`. */
async function withRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

describe('the board', () => {
  it('runs from Start (Object) to Finish, with a ♠ Control square every 8th square', () => {
    assert.equal(board.SQUARES.length, board.FINISH + 1);
    assert.deepEqual(board.SQUARES[0], { kind: 'start', category: 'object' });
    assert.equal(board.SQUARES[board.FINISH].kind, 'finish');
    assert.equal(board.SQUARES[8].kind, 'control');
    assert.equal(board.turnCategory(1), 'nature');
    assert.equal(board.turnCategory(8), null, 'a Control square uses ♠ entries');
    assert.equal(board.isSpinSquare(2), true, 'Action is a Spin square');
    assert.equal(board.isSpinSquare(1), false);
  });

  it('never moves a piece before the start or past the finish', () => {
    assert.equal(board.move(1, -3), 0);
    assert.equal(board.move(46, 5), board.FINISH);
  });

  it('spins 2 on wide green, 3 on narrow green, and nothing on orange or red', () => {
    assert.deepEqual(board.spin(() => 30 / 360), { angle: 30, key: 'red', steps: 0 });
    assert.deepEqual(board.spin(() => 90 / 360), { angle: 90, key: 'wide', steps: 2 });
    assert.deepEqual(board.spin(() => 180 / 360), { angle: 180, key: 'narrow', steps: 3 });
    const values = [65 / 360, 140 / 360]; // exactly on a line → spin again
    assert.equal(board.spin(() => values.shift()).key, 'orange');
  });
});

describe('the rules', () => {
  it('has one describer for a pair and two for bigger teams (one with the variation)', () => {
    assert.equal(rules.describerCount(2, false), 1);
    assert.equal(rules.describerCount(3, false), 2);
    assert.equal(rules.describerCount(5, false), 2);
    assert.equal(rules.describerCount(5, true), 1);
  });

  it('rotates describers so everyone takes a turn', () => {
    const team = { playerIds: ['a', 'b', 'c'], describerIndex: 0 };
    assert.deepEqual(rules.describersFor(team, false), ['a', 'b']);
    rules.advanceDescribers(team, false);
    assert.deepEqual(rules.describersFor(team, false), ['c', 'a']);
  });

  it('drafts in snake order', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => rules.draftPicker(2, n)), [0, 1, 1, 0, 0, 1]);
  });

  it('deals random teams as evenly as possible', () => {
    const teams = rules.randomTeams(['a', 'b', 'c', 'd', 'e'], 2);
    assert.deepEqual(teams.map(t => t.playerIds.length).sort(), [2, 3]);
    assert.equal(rules.maxTeamsFor(7), 3);
  });

  it('draws cards without repeats; ♠ entries come from any category', () => {
    const used = {};
    const words = new Set(Array.from({ length: rules.WORDS.world.length }, () => rules.drawCard('world', used).word));
    assert.equal(words.size, rules.WORDS.world.length);
    const spade = rules.drawCard(null, used);
    assert.equal(spade.spade, true);
    assert.ok(board.CATEGORY_ORDER.includes(spade.category));
  });

  it('has a big, clean word list in every category', () => {
    const all = [];
    for (const category of board.CATEGORY_ORDER) {
      assert.ok(rules.WORDS[category].length >= 150, category);
      all.push(...rules.WORDS[category].map(w => w.toLowerCase()));
    }
    assert.equal(new Set(all).size, all.length, 'no word appears twice');
  });
});

describe('a game through the real command and buttons', () => {
  const thread = createThread('ar-thread');
  const channel = createChannel('ar-channel', thread);
  const voice = { id: 'ar-voice', members: new Map() };
  const manager = newManager();
  const client = createClient([thread, channel, voice], { articulateManager: manager });
  const HOST = user('host', 'Host'), A = user('a', 'Ann'), B = user('b', 'Bob'), C = user('c', 'Cat'), D = user('d', 'Dan');
  const users = { host: HOST, a: A, b: B, c: C, d: D };
  let game;
  const sessionMessage = () => thread.store.get(game.messageId);
  const turnMessage = () => thread.store.get(game.turnMessageId);
  const text = message => JSON.stringify(message.payload.components);
  const pings = () => thread.sent.filter(p => p.content).map(p => p.content);

  const interact = async (from, customId, { kind = 'button', values = [], message = null } = {}) => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, kind, values, message });
    const { logs } = await quietly(() => articulate.handleInteraction(interaction, client));
    assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'));
    return interaction;
  };
  const press = (from, customId, opts = {}) => interact(from, customId, {
    message: ['lobby', 'setup'].includes(game.phase) ? sessionMessage() : turnMessage(), ...opts,
  });
  const panel = interaction => interaction.calls.filter(([type]) => type === 'editReply').at(-1)?.[1];
  const describers = () => game.describerIds.map(id => users[id]);
  const opponent = () => users[game.teams.find((_, i) => i !== game.currentTeam).playerIds[0]];
  const teamIndexOf = id => game.teams.findIndex(t => t.playerIds.includes(id));

  it('/articulate start opens a thread with the lobby', async () => {
    const start = slashCommand({ sub: 'start', user: HOST, channel });
    await articulate.command.execute(start, client);
    game = manager.getGame(thread.id);
    assert.match(start.replies()[0], /game created/);
    assert.ok(text(sessionMessage()).includes('ar_join'));
  });

  it('needs four players; only the host starts', async () => {
    await press(A, 'ar_join');
    await press(B, 'ar_join');
    assert.match((await press(HOST, 'ar_start')).replies()[0], /at least \*\*4 players\*\*/);
    await press(C, 'ar_join');
    await press(D, 'ar_join');
    assert.deepEqual((await press(A, 'ar_start')).replies(), ['Only the host can start the game.']);
    await press(HOST, 'ar_start');
    assert.equal(game.phase, 'setup');
    assert.ok(text(sessionMessage()).includes('ar_method_random'));
  });

  it('setup: number of teams depends on players; random teams can be reshuffled', async () => {
    assert.match((await press(HOST, 'ar_teams_3')).replies()[0], /enough players/, 'five players make two teams');
    assert.match((await press(HOST, 'ar_method_keep')).replies()[0], /no teams from a previous game/);
    await press(HOST, 'ar_method_random');
    assert.deepEqual(game.teams.map(t => t.playerIds.length).sort(), [2, 3]);
    assert.ok(manager.canStart(game));
    await press(HOST, 'ar_reshuffle');
    assert.equal(game.teams.flatMap(t => t.playerIds).length, 5);
  });

  it('setup: captains draft in turn from a menu', async () => {
    await press(HOST, 'ar_method_captains');
    const [cap0, cap1] = game.draft.ids;
    assert.equal(manager.draftCaptain(game), cap0);
    const undrafted = () => manager.undraftedIds(game);
    const wrong = await press(users[cap1], 'ar_draft', { kind: 'select', values: [undrafted()[0]] });
    assert.match(wrong.replies()[0], /It's <@.+>'s pick/);
    await press(users[cap0], 'ar_draft', { kind: 'select', values: [undrafted()[0]] });
    assert.equal(manager.draftCaptain(game), cap1);
    await press(users[cap1], 'ar_draft', { kind: 'select', values: [undrafted()[0]] });
    await press(users[cap1], 'ar_draft', { kind: 'select', values: [undrafted()[0]] }); // snake: cap1 picks twice
    assert.deepEqual(undrafted(), []);
    assert.ok(manager.canStart(game));
  });

  it('setup: players pick their own team; the host places the rest', async () => {
    await press(HOST, 'ar_method_choose');
    assert.equal(manager.canStart(game), false);
    await press(HOST, 'ar_join_team_0');
    await press(B, 'ar_join_team_1');
    await press(C, 'ar_join_team_0');
    await press(C, 'ar_join_team_1'); // changed their mind
    await press(D, 'ar_join_team_1');
    assert.match(text(sessionMessage()), /Not in a team/);
    await press(HOST, 'ar_place_rest');
    assert.deepEqual(game.teams.map(t => t.playerIds), [['host', 'a'], ['b', 'c', 'd']]);
  });

  it('setup: the host chooses the voice channel, timer and describers', async () => {
    await press(HOST, 'ar_voice', { kind: 'channelSelect', values: ['ar-voice'] });
    assert.equal(game.options.voiceChannelId, 'ar-voice');
    assert.deepEqual((await press(A, 'ar_timer_45')).replies(), ['Only the host can set up the game.']);
    await press(HOST, 'ar_timer_45');
    assert.equal(game.options.turnSeconds, 45);
    await press(HOST, 'ar_timer_30');
    await press(HOST, 'ar_describers');
    assert.equal(game.options.singleDescriber, true);
    await press(HOST, 'ar_describers');
    assert.equal(game.options.singleDescriber, false);
  });

  it('starting posts the first turn and calls its describers', async () => {
    voice.members = new Map([['host', {}], ['b', {}]]);
    await withRandom(0.99, () => press(HOST, 'ar_begin')); // team Blue goes first
    assert.equal(game.phase, 'ready');
    assert.equal(game.currentTeam, 1);
    assert.deepEqual(game.describerIds.length, 2, 'a team of three has two describers');
    assert.ok(text(sessionMessage()).includes('Game 1'));
    const turn = text(turnMessage());
    assert.ok(turn.includes('ar_panel'));
    assert.ok(turn.includes('attachment://articulate_board.png'));
    assert.match(turn, /Not in voice:/);
    assert.match(pings().at(-1), /you're describing for Team Blue/);
  });

  it('describers see the card privately; both panels stay in step; one pass per turn', async () => {
    const [d1, d2] = describers();
    assert.match((await press(opponent(), 'ar_panel')).replies()[0], /Only this turn's describers/);
    const panel1 = await press(d1, 'ar_panel');
    const panel2 = await press(d2, 'ar_panel');
    assert.match(panel(panel1).content, /press \*\*Start\*\*/);
    assert.match((await press(opponent(), 'ar_foul')).replies()[0], /only call a foul while the timer is running/);

    await interact(d1, 'ar_go');
    assert.equal(game.phase, 'describing');
    assert.ok(game.turnTimeout, 'the timer is running');
    const first = game.turn.card.word;
    assert.match(panel(panel2).content, new RegExp(`# ${first}`), 'the other describer sees the card too');

    await interact(d2, `ar_got_${game.turn.cardNumber}`);
    assert.match((await interact(d1, 'ar_got_1')).replies()[0], /already been counted/, 'a second press on the same card counts once');
    await interact(d1, `ar_pass_${game.turn.cardNumber}`);
    assert.match((await interact(d1, `ar_pass_${game.turn.cardNumber}`)).replies()[0], /only pass once per turn/);
    await interact(d1, `ar_got_${game.turn.cardNumber}`);
    assert.deepEqual(game.turn.correct.map(c => c.word)[0], first);
    assert.equal(game.turn.correct.length, 2);
    assert.match(text(turnMessage()), /✅ \*\*2\*\*/);
  });

  it('when time runs out the team moves one square per correct guess', async () => {
    const blue = game.teams[1];
    await quietly(() => flow.finishDescribing(game, client));
    assert.equal(blue.position, 2);
    // Square 2 is Action, a Spin square.
    assert.equal(game.phase, 'spin');
    assert.ok(text(turnMessage()).includes('ar_spin'));
  });

  it('a Spin square: the team spins and can send another team back (never past the start)', async () => {
    assert.match((await press(opponent(), 'ar_spin')).replies()[0], /Only Team Blue/);
    await withRandom(90 / 360, () => press(users.b, 'ar_spin'));
    assert.deepEqual(game.spinResult.steps, 2);
    const ids = allCustomIds(turnMessage().payload);
    assert.ok(ids.includes('ar_bonus_1') && ids.includes('ar_bonus_0'));

    const spinMessage = turnMessage();
    await press(users.b, 'ar_bonus_1');
    assert.equal(game.teams[1].position, 4, 'forward 2; landing by bonus triggers nothing');
    assert.match(text(spinMessage), /moved forward/, 'the old turn becomes a summary');
    assert.equal(game.currentTeam, 0, 'Red\'s turn next');
    assert.equal(game.phase, 'ready');
  });

  it('a foul from the other team forfeits the turn', async () => {
    const [describer] = describers();
    assert.equal(game.describerIds.length, 1, 'a pair has one describer');
    await interact(describer, 'ar_go');
    await interact(describer, `ar_got_${game.turn.cardNumber}`);
    const teammate = users[game.team.playerIds.find(id => id !== describer.id)];
    assert.match((await press(teammate, 'ar_foul')).replies()[0], /Only the other teams/);
    const ask = await press(users.c, 'ar_foul');
    assert.equal(ask.calls[0][1].components.length, 1, 'asks to confirm');
    const foulTurn = turnMessage();
    await interact(users.c, 'ar_foul_confirm');
    assert.equal(game.teams[0].position, 0, 'no move');
    assert.equal(game.currentTeam, 1);
    assert.match(text(foulTurn), /Foul\*\* called by <@c>/);
  });

  it('landing on ♠ starts a Control round; the first team to shout takes the next turn', async () => {
    game.teams[1].position = 6; // two correct guesses land on square 8, a Control square
    const [d1] = describers();
    await interact(d1, 'ar_go');
    await interact(d1, `ar_got_${game.turn.cardNumber}`);
    await interact(d1, `ar_got_${game.turn.cardNumber}`);
    await quietly(() => flow.finishDescribing(game, client));
    assert.equal(game.phase, 'control');
    assert.ok(game.control.card.spade);
    assert.match(text(turnMessage()), /Control Round/);

    const opened = await press(d1, 'ar_panel');
    assert.deepEqual(allCustomIds(panel(opened)).filter(id => id.startsWith('ar_win_')), ['ar_win_1_0', 'ar_win_1_1']);
    assert.match((await interact(users.host, 'ar_win_1_0')).replies()[0], /Only this turn's describers/);
    await interact(d1, 'ar_tie_1');
    assert.equal(game.control.cardNumber, 2, 'a tie takes a new card');
    await interact(d1, 'ar_win_2_0');
    assert.equal(game.currentTeam, 0, 'Red won the Control round and takes the next turn');
    assert.equal(game.phase, 'ready');
  });

  it('reaching the finish needs a Control round win; losing it means trying again next turn', async () => {
    game.teams[0].position = board.FINISH - 1;
    const [describer] = describers();
    await interact(describer, 'ar_go');
    await interact(describer, `ar_got_${game.turn.cardNumber}`);
    await quietly(() => flow.finishDescribing(game, client));
    assert.equal(game.phase, 'control');
    assert.equal(game.control.reason, 'finish');
    assert.match(text(turnMessage()), /Win this ♠ round to win the game/);

    await interact(describer, 'ar_win_1_1'); // Blue shouted first
    assert.equal(game.currentTeam, 1);
    assert.equal(game.phase, 'ready');

    // Blue's turn ends with nothing; then Red, still on the finish, gets another Control round.
    const [blueDescriber] = describers();
    await interact(blueDescriber, 'ar_go');
    await quietly(() => flow.finishDescribing(game, client));
    assert.equal(game.currentTeam, 0);
    assert.equal(game.phase, 'control');
    assert.match(pings().at(-1), /Control round, every team can guess/);

    const [redDescriber] = describers();
    await interact(redDescriber, 'ar_win_1_0');
    assert.equal(game.phase, 'ended');
    assert.equal(game.winnerTeam, 0);
    assert.match(text(turnMessage()), /Team Red Win/);
  });

  it('records stats', () => {
    assert.equal(stats.getPlayer('guild-1', 'host').games_won, 1);
    assert.equal(stats.getPlayer('guild-1', 'b').games_won, 0);
    const describedCards = stats.scoreboard('guild-1').reduce((sum, row) => sum + row.cards_described, 0);
    assert.ok(describedCards >= 5);
    assert.ok(stats.scoreboard('guild-1').some(row => row.fouls === 1));
  });

  it('rematch keeps the teams and starts again from the start', async () => {
    assert.deepEqual((await press(A, 'ar_rematch')).replies(), ['Only the host can do that.']);
    const winnerMessage = turnMessage();
    await press(HOST, 'ar_rematch');
    assert.deepEqual(allCustomIds(winnerMessage.payload), [], 'the winner message loses its buttons');
    assert.equal(game.phase, 'ready');
    assert.deepEqual(game.teams.map(t => t.position), [0, 0]);
    assert.equal(game.gameNumber, 2);
  });

  it('New Game reopens the lobby and setup can keep the teams; Close ends the session', async () => {
    game.phase = 'ended';
    game.winnerTeam = 1;
    await press(HOST, 'ar_new_game');
    assert.equal(game.phase, 'lobby');
    assert.ok(text(sessionMessage()).includes('Lobby Open'));
    await press(HOST, 'ar_start');
    await press(HOST, 'ar_method_keep');
    assert.deepEqual(game.teams.map(t => t.playerIds.sort()), [['a', 'host'], ['b', 'c', 'd']]);

    await press(HOST, 'ar_cancel');
    assert.equal(manager.getGame(thread.id), null);
    assert.ok(JSON.stringify(thread.sent.at(-1).components).includes('Session Closed'));
    assert.deepEqual(repository.getAll(), []);
  });
});

/** A started game with two teams of two, on Red's turn. */
function startedGame(threadId, manager) {
  const game = manager.createGame('guild-2', 'C', threadId, 'h', 'Host');
  for (const id of ['h', 'w', 'x', 'y']) manager.addPlayer(threadId, user(id));
  manager.beginSetup(game);
  manager.setTeamMethod(game, 'choose');
  manager.joinTeam(game, 'h', 0);
  manager.joinTeam(game, 'w', 0);
  manager.joinTeam(game, 'x', 1);
  manager.joinTeam(game, 'y', 1);
  manager.startGame(game);
  manager.startTurn(game, 0);
  return game;
}

describe('the timer', () => {
  it('ends the turn when time runs out', async () => {
    const thread = createThread('ar-timer');
    const manager = newManager();
    const client = createClient([thread], { articulateManager: manager });
    const game = startedGame(thread.id, manager);
    manager.beginDescribing(game);
    manager.gotIt(game, game.turn.cardNumber);
    game.turn.endsAt = Date.now() - rules.TIMER_GRACE_MS + 20;
    flow.scheduleTurnTimer(game, client);
    await quietly(() => new Promise(resolve => setTimeout(resolve, 80)));
    assert.equal(game.teams[0].position, 1);
    assert.equal(game.currentTeam, 1, 'next team');
  });
});

describe('restore', () => {
  it('re-arms a running timer with the time it had left', async () => {
    const thread = createThread('ar-restore');
    const saving = newManager();
    const game = startedGame(thread.id, saving);
    saving.beginDescribing(game);
    saving.gotIt(game, game.turn.cardNumber);
    game.turnMessageId = (await thread.send({})).id;
    repository.upsert(game);
    saving.clearTimers(game);

    const restored = newManager();
    await quietly(() => articulate.restore(createClient([thread], { articulateManager: restored })));
    const back = restored.getGame(thread.id);
    assert.ok(back instanceof ArticulateGameState);
    assert.equal(back.phase, 'describing');
    assert.equal(back.turn.correct.length, 1);
    assert.ok(back.turnTimeout);
    assert.equal(thread.sent.length, 1, 'redrawn in place');
    restored.clearTimers(back);
  });

  it('finishes a turn whose time ran out while the bot was down', async () => {
    const thread = createThread('ar-restore-late');
    const saving = newManager();
    const game = startedGame(thread.id, saving);
    saving.beginDescribing(game);
    saving.gotIt(game, game.turn.cardNumber);
    game.turn.endsAt = Date.now() - 60_000;
    repository.upsert(game);
    saving.clearTimers(game);

    const restored = newManager();
    await quietly(() => articulate.restore(createClient([thread], { articulateManager: restored })));
    const back = restored.getGame(thread.id);
    assert.equal(back.teams[0].position, 1);
    assert.equal(back.currentTeam, 1);
    assert.equal(back.phase, 'ready');
  });
});

describe('/articulate end', () => {
  it('is refused for other players and allowed for the host', async () => {
    const thread = createThread('ar-end');
    const channel = createChannel('ar-end-channel', thread);
    const manager = newManager();
    const client = createClient([thread, channel], { articulateManager: manager });
    await articulate.command.execute(slashCommand({ sub: 'start', user: user('h', 'Host'), channel }), client);

    const other = slashCommand({ sub: 'end', user: user('z'), channel, channelId: thread.id });
    await articulate.command.execute(other, client);
    assert.match(other.replies()[0], /^Only the game creator/);

    await articulate.command.execute(slashCommand({ sub: 'end', user: user('h'), channel, channelId: thread.id }), client);
    assert.equal(manager.getGame(thread.id), null);
  });
});
