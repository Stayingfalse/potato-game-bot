'use strict';

const { src } = require('./helpers/env');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand,
  embedTitles, buttonIds, quietly,
} = require('./helpers/discord');

// ── The werewords_games table as the live bot has it, with a saved game ────────
const db = src('db/database');
db.exec(`CREATE TABLE werewords_games (thread_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  host_id TEXT NOT NULL, host_username TEXT NOT NULL, message_id TEXT, board_message_id TEXT, phase TEXT NOT NULL DEFAULT 'lobby',
  players TEXT NOT NULL DEFAULT '[]', word TEXT, word_options TEXT NOT NULL DEFAULT '[]', tokens TEXT NOT NULL DEFAULT '{}',
  time_left INTEGER NOT NULL DEFAULT 240, votes TEXT NOT NULL DEFAULT '{}', game_number INTEGER NOT NULL DEFAULT 1,
  winner_guesser_user_id TEXT, created_at INTEGER NOT NULL, session_mode TEXT, voice_player_message_ids TEXT)`);
db.prepare(`INSERT INTO werewords_games (thread_id, guild_id, channel_id, host_id, host_username, message_id, phase, players, tokens, created_at, session_mode)
  VALUES ('old1', 'G', 'C', 'h', 'Host', 'lobby-msg', 'lobby', '[{"id":"h","username":"Host"}]',
  '{"yes_no":30,"maybe":12,"correct":1,"so_close_way_off":2}', 7, 'text')`).run();

const repository = src('games/werewords/repository');
const WerewordsGameState = src('games/werewords/state');
const { WerewordsManager } = src('games/werewords/manager');
const { ROLES } = src('games/werewords/roles');
src('games/werewords/phases/sessionEnd').revealPacing.scale = 0; // skip the pauses between role reveals
const werewords = src('games/werewords/index.js');

const managers = [];
const newManager = () => { const m = new WerewordsManager(); managers.push(m); return m; };
after(() => { for (const m of managers) for (const game of m.games.values()) m.clearTimers(game); });

const statsCount = () => db.prepare('SELECT COALESCE(SUM(games_played), 0) AS n FROM werewords_player_stats').get().n;

describe('upgrading the werewords_games table', () => {
  it('adds the new columns and loads the saved game with defaults', () => {
    const columns = db.prepare('PRAGMA table_info(werewords_games)').all().map(c => c.name);
    for (const column of ['ready_players', 'session_history', 'response_stats_shown', 'phase_ends_at', 'werewolf_revealed']) {
      assert.ok(columns.includes(column), column);
    }
    const game = WerewordsGameState.fromRow(repository.getAll()[0]);
    assert.equal(game.tokens.yes_no, 30);
    assert.equal(game.readyPlayers.size, 0);
    assert.deepEqual(game.sessionHistory, []);
    assert.equal(game.werewolfRevealed, false);
    assert.ok(Array.isArray(game.pendingSecretInteractions));
    repository.remove('old1');
  });

  it('round-trips a game through save and load', () => {
    const manager = newManager();
    const game = manager.createGame('G', 'C', 'rt', 'h', 'Host');
    for (const u of [user('h'), user('a'), user('b')]) manager.addPlayer('rt', u);
    manager.assignRoles('rt');
    Object.assign(game, { word: 'Apple', sessionMode: 'voice', phaseEndsAt: 123, werewolfRevealed: true });
    game.votes.set('a', 'b');
    game.readyPlayers.add('a');
    game.voicePlayerMessageIds.set('a', 'panel');
    game.sessionHistory = [{ gameNumber: 1, outcome: 'villagers_word', word: 'Pear', winners: ['a', 'b'], players: [] }];
    repository.upsert(game);
    const reloaded = WerewordsGameState.fromRow(repository.getAll().find(r => r.thread_id === 'rt'));
    assert.deepEqual(WerewordsGameState.toRow(reloaded), WerewordsGameState.toRow(game));
    manager.deleteGame('rt');
  });
});

describe('a session through the real command and handlers', () => {
  const thread = createThread('ww-thread');
  const channel = createChannel('ww-channel', thread);
  let manager = newManager();
  let client = createClient([thread, channel], { werewordsManager: manager });
  const HOST = user('host', 'Host'), A = user('a', 'Ann'), B = user('b', 'Bob'), C = user('c', 'Cat'), D = user('d', 'Dan'), X = user('x', 'Xan');
  let game;
  const message = id => thread.store.get(id);
  const lastSent = () => thread.sent.at(-1);
  const restart = async () => {
    for (const g of manager.games.values()) manager.clearTimers(g);
    manager = newManager();
    client = createClient([thread, channel], { werewordsManager: manager });
    await quietly(() => werewords.restore(client));
    return manager.getGame(thread.id);
  };
  const press = async (from, customId, { on, fields, kind = 'button' } = {}) => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, kind, fields, message: on });
    const { logs } = await quietly(() => werewords.handleInteraction(interaction, client));
    assert.ok(!logs.some(line => line.startsWith('error')), `${customId}: ${logs.join('\n')}`);
    return interaction;
  };
  const guess = async (from, text) => {
    await werewords.handleMessage({ author: { id: from.id }, guild: {}, content: text, deletable: false, channel: thread }, client);
    return lastSent() && [...thread.store.values()].at(-1);
  };
  const setRoles = (target, roles) => {
    for (const [id, role] of Object.entries(roles)) {
      Object.assign(target.players.get(id), { role, secretRole: role === ROLES.MAYOR ? ROLES.VILLAGER : null });
    }
  };

  it('/werewords start opens a public thread with the lobby as its first message', async () => {
    const start = slashCommand({ sub: 'start', user: HOST, channel });
    await werewords.command.execute(start, client);
    game = manager.getGame(thread.id);
    assert.equal(channel.createdThreads[0].type, 11);
    assert.equal(channel.createdThreads[0].autoArchiveDuration, 1440);
    assert.match(start.replies()[0], /game created by <@host>/);
    assert.deepEqual(buttonIds(message(game.messageId)), ['ww_join', 'ww_leave', 'ww_start', 'ww_cancel']);

    const again = slashCommand({ sub: 'start', user: HOST, channel });
    await werewords.command.execute(again, client);
    assert.match(again.replies()[0], /^You already have an active \*\*Werewords\*\* game/);
    assert.equal(channel.createdThreads.length, 1);
  });

  it('lobby: join and leave; old ww_join_<threadId> buttons still find their game', async () => {
    const lobby = message(game.messageId);
    assert.deepEqual((await press(HOST, 'ww_start', { on: lobby })).replies(), ['Need at least **3 players** to start. Currently: **1**.']);
    for (const u of [A, B, C, D, X]) await press(u, 'ww_join', { on: lobby });
    await press(X, 'ww_leave', { on: lobby });
    assert.deepEqual([...game.players.keys()], ['host', 'a', 'b', 'c', 'd']);
    assert.ok(thread.memberIds.has('d') && !thread.memberIds.has('x'));

    const legacy = manager.createGame('G', 'C', '987654321', 'z', 'Zed');
    const old = componentInteraction({ customId: 'ww_join_987654321', user: X, channelId: channel.id });
    await quietly(() => werewords.handleInteraction(old, client));
    assert.ok(legacy.players.has('x') && !game.players.has('x'));
    manager.deleteGame('987654321');
  });

  it('start: the mode choice is on the lobby message, then one game message is posted', async () => {
    const lobby = message(game.messageId);
    assert.deepEqual((await press(A, 'ww_start', { on: lobby })).replies(), ['Only the host can start the game.']);
    await press(HOST, 'ww_start', { on: lobby });
    assert.deepEqual(buttonIds(lobby), ['ww_mode_text', 'ww_mode_voice']);

    const sentBefore = thread.sent.length;
    await press(HOST, 'ww_mode_text', { on: lobby });
    assert.equal(game.phase, 'playing');
    assert.deepEqual(embedTitles(lobby), ['🔮  Werewords — In Progress']);
    assert.equal(thread.sent.length, sentBefore + 1, 'only the game message is posted');
    assert.deepEqual(embedTitles(message(game.boardMessageId)), ['🔮  Werewords — Game 1 Started!']);
    assert.deepEqual(buttonIds(message(game.boardMessageId)), ['ww_secret', 'ww_end_game']);
  });

  it('ready-up: the word and each ready are saved; the board replaces the list once all are ready', async () => {
    setRoles(game, { host: ROLES.MAYOR, a: ROLES.WEREWOLF, b: ROLES.SEER, c: ROLES.VILLAGER, d: ROLES.VILLAGER });
    assert.equal((await press(HOST, 'ww_secret')).calls[0][0], 'reply');
    await press(HOST, 'ww_word_1');
    assert.equal(game.word, game.wordOptions[1]);
    for (const u of [A, B, C]) await press(u, 'ww_ready');
    assert.equal(game.timerInterval, null, 'the countdown waits for everyone');

    const gameMessage = game.boardMessageId;
    await press(D, 'ww_ready');
    assert.ok(game.timerInterval);
    assert.equal(game.boardMessageId, gameMessage);
    assert.deepEqual(embedTitles(message(gameMessage)), ['🔮  Werewords — Game Board']);
    const saved = WerewordsGameState.fromRow(repository.getAll().find(r => r.thread_id === thread.id));
    assert.equal(saved.word, game.word);
    assert.deepEqual([...saved.readyPlayers].sort(), ['a', 'b', 'c', 'd', 'host']);
  });

  it('a typed guess gets the Mayor\'s answer buttons; a correct guess moves the game message to the reveal', async () => {
    const guessMessage = await guess(C, 'apple');
    assert.match(guessMessage.content, /<@c> guesses: \*\*"apple"\*\*/);
    assert.deepEqual((await press(A, 'ww_guess_correct_c', { on: guessMessage })).replies(), ['Only the Mayor can respond to guesses.']);
    await press(HOST, 'ww_guess_soclose_c', { on: guessMessage });
    assert.equal(game.tokens.so_close_way_off, 1);

    const board = game.boardMessageId;
    await press(HOST, 'ww_guess_correct_c', { on: guessMessage });
    assert.equal(game.phase, 'reveal');
    assert.equal(game.winnerGuesserUserId, 'c');
    assert.notEqual(game.boardMessageId, board);
    assert.match(message(board).content, /^⬇️ Continued below:/);
    assert.deepEqual(buttonIds(message(board)), []);
    assert.deepEqual(buttonIds(message(game.boardMessageId)), ['ww_reveal']);
  });

  it('reveal: the Werewolf reveals, can reopen their picker, and survives a restart', async () => {
    const revealMessage = message(game.boardMessageId);
    assert.deepEqual((await press(B, 'ww_reveal', { on: revealMessage })).replies(), ['Only the Werewolf can reveal themselves.']);
    const reveal = await press(A, 'ww_reveal', { on: revealMessage });
    assert.deepEqual(reveal.calls.map(([type]) => type), ['update', 'followUp']);
    assert.deepEqual(buttonIds(revealMessage), ['ww_seer_panel']);
    assert.ok(game.phaseEndsAt <= Date.now() + 20_000);
    assert.deepEqual((await press(B, 'ww_seer_panel')).replies(), ['Only the Werewolf can pick the Seer.']);
    assert.match((await press(A, 'ww_seer_panel')).replies()[0], /^🔮 \*\*Pick who you think is the Seer\.\*\*/);

    const deadline = game.phaseEndsAt;
    const sentBefore = thread.sent.length;
    game = await restart();
    assert.equal(game.werewolfRevealed, true);
    assert.equal(game.phaseEndsAt, deadline);
    assert.ok(game.revealTimeout);
    assert.equal(thread.sent.length, sentBefore, 'restore posts nothing');
  });

  it('the Werewolf names the Seer: the result is recorded and the summary offers a rematch', async () => {
    const statsBefore = statsCount();
    await press(A, 'ww_seer_pick_b');
    assert.equal(game.phase, 'ended');
    assert.deepEqual(embedTitles(message(game.boardMessageId)), ['😈  Werewolves Win!']);
    assert.equal(game.sessionHistory.length, 1);
    assert.equal(game.sessionHistory[0].outcome, 'werewolf_seer');
    assert.deepEqual(game.sessionHistory[0].winners, ['a']);
    assert.equal(statsCount(), statsBefore + 5);

    const summary = lastSent();
    assert.match(summary.embeds[0].data.title, /^📊  Session Summary — 1 game played/);
    assert.deepEqual(buttonIds({ payload: summary }), ['ww_rematch_same', 'ww_rematch_open', 'ww_close_session']);
    assert.match(embedTitles(message(game.messageId))[0], /Game 1 Complete/, 'the lobby message shows the result');
  });

  it('End Game cancels a game without counting it, and still offers a rematch', async () => {
    await press(HOST, 'ww_rematch_same', { on: [...thread.store.values()].at(-1) });
    assert.equal(game.gameNumber, 2);
    assert.deepEqual(embedTitles(message(game.boardMessageId)), ['🔮  Werewords — Game 2 Started!']);

    const statsBefore = statsCount();
    await press(HOST, 'ww_end_game');
    assert.equal(game.phase, 'ended');
    assert.deepEqual(embedTitles(message(game.boardMessageId)), ['🛑  Game Cancelled']);
    assert.equal(statsCount(), statsBefore);
    assert.equal(game.sessionHistory.length, 1);
    assert.deepEqual(buttonIds({ payload: lastSent() }), ['ww_rematch_same', 'ww_rematch_open', 'ww_close_session']);
  });

  it('when the Yes/No tokens run out, the game message moves to the vote', async () => {
    await press(HOST, 'ww_rematch_same', { on: [...thread.store.values()].at(-1) });
    setRoles(game, { host: ROLES.MAYOR, a: ROLES.WEREWOLF, b: ROLES.VILLAGER, c: ROLES.VILLAGER, d: ROLES.VILLAGER });
    await press(HOST, 'ww_word_2');
    for (const u of [A, B, C, D]) await press(u, 'ww_ready');
    game.tokens.yes_no = 1;
    const guessMessage = await guess(B, 'fruit?');
    await press(HOST, 'ww_guess_yes_b', { on: guessMessage });

    assert.equal(game.phase, 'voting');
    const vote = message(game.boardMessageId);
    assert.deepEqual(embedTitles(vote), ['🔤  Werewords — Revealed!', '🃏 Response Cards — This Game', '🗳️  Werewords — Vote!']);
    assert.deepEqual(buttonIds(vote), ['ww_vote_host', 'ww_vote_a', 'ww_vote_b', 'ww_vote_c', 'ww_vote_d']);
    await press(B, 'ww_vote_a');
    await press(C, 'ww_vote_a');
    assert.equal(vote.payload.embeds[2].data.fields[0].name, 'Voted (2 / 5)');
  });

  it('a restart mid-vote keeps the votes and the deadline; the last vote decides the game', async () => {
    const deadline = game.phaseEndsAt;
    game = await restart();
    assert.equal(game.phaseEndsAt, deadline);
    assert.equal(game.votes.size, 2);
    assert.ok(game.revealTimeout);

    for (const u of [HOST, A, D]) await press(u, 'ww_vote_a');
    assert.equal(game.phase, 'ended');
    assert.deepEqual(embedTitles(message(game.boardMessageId)), ['🎉  Townsfolk Win!']);
    assert.equal(game.sessionHistory.length, 2);
    assert.match(lastSent().embeds[0].data.title, /^📊  Session Summary — 2 games played/);
  });

  it('a session between games survives a restart; open sign-ups post a fresh lobby', async () => {
    game = await restart();
    assert.equal(game.phase, 'ended');
    const oldLobby = game.messageId;
    await press(HOST, 'ww_rematch_open');
    assert.equal(game.phase, 'lobby');
    assert.equal(game.gameNumber, 4);
    assert.notEqual(game.messageId, oldLobby);
    assert.match(message(game.messageId).content, /Game 4 sign-ups open/);
    assert.deepEqual(buttonIds(message(game.messageId)), ['ww_join', 'ww_leave', 'ww_start', 'ww_cancel']);
  });

  it('/werewords end: refused for players, allowed for moderators, closes everything', async () => {
    const notHost = slashCommand({ sub: 'end', user: A, channel, channelId: thread.id });
    await werewords.command.execute(notHost, client);
    assert.match(notHost.replies()[0], /^Only the game creator/);

    const outside = slashCommand({ sub: 'end', user: HOST, channel, channelId: 'elsewhere' });
    await werewords.command.execute(outside, client);
    assert.match(outside.replies()[0], /^This command must be used inside/);

    const moderator = slashCommand({ sub: 'end', user: A, channel, channelId: thread.id, canManageThreads: true });
    await quietly(() => werewords.command.execute(moderator, client));
    assert.equal(manager.getGame(thread.id), null);
    assert.deepEqual(repository.getAll(), []);
    assert.ok(thread.sent.some(p => p.content === '🛑 Session ended by <@a>.' && p.embeds.length === 1));
    assert.deepEqual(embedTitles(message(game.messageId)), ['🔮  Werewords — Session Ended']);
  });
});

describe('restoring a game mid-play', () => {
  it('restarts the countdown only once everyone was ready, and posts nothing', async () => {
    const thread = createThread('mid-play');
    const saving = newManager();
    const game = saving.createGame('G', 'C', thread.id, 'h', 'Host');
    for (const u of [user('h'), user('a'), user('b')]) saving.addPlayer(thread.id, u);
    saving.assignRoles(thread.id);
    Object.assign(game, { phase: 'playing', word: 'Kiwi', timeLeft: 100, boardMessageId: (await thread.send({})).id });
    repository.upsert(game);

    const notReady = newManager();
    await quietly(() => werewords.restore(createClient([thread], { werewordsManager: notReady })));
    assert.equal(notReady.getGame(thread.id).timerInterval, null);

    game.readyPlayers = new Set(['h', 'a', 'b']);
    repository.upsert(game);
    const ready = newManager();
    const sentBefore = thread.sent.length;
    await quietly(() => werewords.restore(createClient([thread], { werewordsManager: ready })));
    const restored = ready.getGame(thread.id);
    assert.ok(restored.timerInterval);
    assert.equal(restored.word, 'Kiwi');
    assert.equal(thread.sent.length, sentBefore);
    assert.deepEqual(embedTitles(thread.store.get(restored.boardMessageId)), ['🔮  Werewords — Game Board']);
  });
});
