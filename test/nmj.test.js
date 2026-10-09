'use strict';

const { src } = require('./helpers/env');
const fs = require('fs');
const path = require('path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly,
} = require('./helpers/discord');

// ── A database left by an older version, with saved games in every phase ───────
// Created before the NMJ repository loads, so loading it runs the upgrade.
const db = src('db/database');
db.exec(`CREATE TABLE nmj_games (
  thread_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  message_id TEXT, status TEXT NOT NULL DEFAULT 'recruiting', players TEXT NOT NULL DEFAULT '[]',
  eliminated_players TEXT NOT NULL DEFAULT '[]', current_player_index INTEGER NOT NULL DEFAULT 0,
  banned_categories TEXT NOT NULL DEFAULT '[]', moves TEXT NOT NULL DEFAULT '[]', pending_move TEXT,
  name_another_required INTEGER NOT NULL DEFAULT 0, challenge_state TEXT, challenge_counts TEXT NOT NULL DEFAULT '{}',
  accepted_players TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`);
const insertOld = db.prepare(`INSERT INTO nmj_games VALUES (@thread_id, 'G', 'C', @creator_id, 'm', @status, @players,
  @eliminated_players, @current_player_index, @banned_categories, @moves, @pending_move, @name_another_required,
  @challenge_state, @challenge_counts, @accepted_players, @created_at)`);
const blank = { eliminated_players: '[]', current_player_index: 0, banned_categories: '[]', moves: '[]', pending_move: null, name_another_required: 0, challenge_state: null, challenge_counts: '{}', accepted_players: '[]' };
insertOld.run({ ...blank, thread_id: 't_lobby', creator_id: 'h1', status: 'recruiting', players: '["h1","x"]', created_at: 111 });
insertOld.run({ ...blank, thread_id: 't_order', creator_id: 'h2', status: 'ordering', players: '["h2","p","q"]', created_at: 222 });
insertOld.run({
  ...blank, thread_id: 't_play', creator_id: 'h3', status: 'playing', players: '["c","h3","d","e"]',
  eliminated_players: '["d"]', current_player_index: 3, banned_categories: '["No More actors"]',
  moves: JSON.stringify([{ playerId: 'c', celebs: ['Tom'], category: 'No More actors' }]),
  pending_move: JSON.stringify({ playerId: 'e', celebs: ['Ann'], category: 'No More singers', stage: 'respond' }),
  challenge_state: JSON.stringify({ challengerId: 'c', claimedCategoryText: 'actors', matchedCategory: 'No More actors', votes: { c: 'success' }, voteLocked: false }),
  challenge_counts: '{"c":2,"h3":3,"e":3}', accepted_players: '["h3"]', name_another_required: 1, created_at: 333,
});
insertOld.run({ ...blank, thread_id: 't_ended', creator_id: 'h4', status: 'ended', players: '["h4"]', created_at: 444 });

let repository;
const upgradeLogs = [];
{
  const log = console.log;
  console.log = (...args) => upgradeLogs.push(args.join(' '));
  try { repository = src('games/nmj/repository'); } finally { console.log = log; }
}
const NoMoreJockeysGameState = src('games/nmj/state');
const { NoMoreJockeysManager, CHALLENGE_TOKENS_PER_PLAYER } = src('games/nmj/manager');
const nmj = src('games/nmj/index.js');

const managers = [];
const newManager = () => { const m = new NoMoreJockeysManager(); managers.push(m); return m; };
after(() => { for (const m of managers) for (const id of [...m.games.keys()]) m.deleteGame(id); });

describe('upgrading a table from the creator_id/status layout', () => {
  it('converts every saved game and logs it', () => {
    assert.ok(upgradeLogs.some(line => line.includes('4 saved game(s) converted')));
    const columns = db.prepare('PRAGMA table_info(nmj_games)').all().map(c => c.name);
    assert.ok(columns.includes('host_id') && columns.includes('host_username') && columns.includes('phase'));
    assert.ok(!columns.includes('creator_id') && !columns.includes('status'));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'nmj_games_pre_host_id'").get(), undefined);
  });

  it('ends up with the same table as a fresh install', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'games', 'nmj', 'repository.js'), 'utf8').match(/const SCHEMA = `([\s\S]*?)`;/)[1];
    const fresh = new Database(':memory:');
    fresh.exec(schema);
    assert.deepEqual(db.prepare('PRAGMA table_info(nmj_games)').all(), fresh.prepare('PRAGMA table_info(nmj_games)').all());
  });

  it('keeps each game playable: host, phase, turn order and the move in progress', () => {
    const games = Object.fromEntries(repository.getAll().map(row => [row.thread_id, NoMoreJockeysGameState.fromRow(row)]));
    assert.deepEqual(Object.keys(games).sort(), ['t_ended', 't_lobby', 't_order', 't_play']);

    const lobby = games.t_lobby;
    assert.equal(lobby.hostId, 'h1');
    assert.equal(lobby.phase, 'lobby');
    assert.deepEqual(lobby.turnOrder(), ['h1', 'x']);
    assert.deepEqual(lobby.players.get('x'), { id: 'x', username: null });
    assert.equal(lobby._createdAt, 111);

    assert.equal(games.t_order.phase, 'ordering');
    assert.deepEqual(games.t_order.turnOrder(), ['h2', 'p', 'q']);

    const playing = games.t_play;
    assert.deepEqual(playing.alivePlayers(), ['c', 'h3', 'e']);
    assert.equal(playing.currentPlayerId(), 'e');
    assert.equal(playing.pendingMove.stage, 'respond');
    assert.equal(playing.challengeState.votes.get('c'), 'success');
    assert.equal(playing.challengeCounts.get('c'), 2);
    assert.ok(playing.acceptedPlayers.has('h3'));

    assert.equal(games.t_ended.phase, 'ended');
  });

  it('round-trips through save and load, and leaves the table alone on the next startup', () => {
    const playing = NoMoreJockeysGameState.fromRow(repository.getAll().find(r => r.thread_id === 't_play'));
    repository.upsert(playing);
    const reloaded = NoMoreJockeysGameState.fromRow(repository.getAll().find(r => r.thread_id === 't_play'));
    assert.deepEqual(NoMoreJockeysGameState.toRow(reloaded), NoMoreJockeysGameState.toRow(playing));
    for (const row of repository.getAll()) repository.remove(row.thread_id);
  });
});

describe('a full game through the real handlers', () => {
  const thread = createThread('nmj-thread');
  const origin = createChannel('nmj-origin', thread);
  const manager = newManager();
  const client = createClient([thread, origin], { nmjManager: manager });
  const H = user('h', 'Host'), A = user('a', 'Ann'), B = user('b', 'Bob');
  let game;

  const press = async (from, customId, fields, kind = 'button') => {
    const interaction = componentInteraction({ customId, user: from, channelId: thread.id, kind, fields });
    const { logs } = await quietly(() => nmj.handleInteraction(interaction, client));
    assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'));
    return interaction;
  };
  const modal = (from, customId, fields) => press(from, customId, fields, 'modal');

  it('lobby: join, leave and rejoin; only the host can start', async () => {
    game = manager.createGame('G', origin.id, thread.id, 'h', 'Host');
    manager.addPlayer(thread.id, H);
    game.messageId = (await thread.send({})).id;

    await press(A, 'nmj_join');
    assert.deepEqual((await press(A, 'nmj_join')).replies(), ['You are already in the game.']);
    await press(B, 'nmj_join'); await press(B, 'nmj_leave'); await press(B, 'nmj_join');
    assert.deepEqual(game.turnOrder(), ['h', 'a', 'b']);
    assert.deepEqual(game.players.get('a'), { id: 'a', username: 'Ann' });
    assert.ok(thread.memberIds.has('b'));

    assert.deepEqual((await press(A, 'nmj_start')).replies(), ['Only the game creator can start the game.']);
    await press(H, 'nmj_start');
    assert.equal(game.phase, 'ordering');
    assert.deepEqual((await press(user('c'), 'nmj_join')).replies(), ['This game is no longer recruiting.']);
  });

  it('ordering: spin shuffles, begin deals challenge tokens and prompts the first player', async () => {
    await press(H, 'nmj_spin');
    assert.deepEqual([...game.turnOrder()].sort(), ['a', 'b', 'h']);
    game.players = new Map(['h', 'a', 'b'].map(id => [id, game.players.get(id)])); // deterministic from here
    await press(H, 'nmj_begin');
    assert.equal(game.phase, 'playing');
    assert.deepEqual([...game.challengeCounts], [['h', 3], ['a', 3], ['b', 3]]);
    assert.ok(thread.sent.at(-1).content.startsWith('<@h> - Please Give'));
  });

  it('a move everyone accepts is committed and the turn passes on', async () => {
    assert.deepEqual((await press(A, 'nmj_take_turn')).replies(), ['It is not your turn.']);
    assert.equal((await press(H, 'nmj_take_turn')).modal(), 'nmj_move_modal');
    await modal(H, 'nmj_move_modal', { nmj_celeb: 'Tom Cruise', nmj_category: 'No More Oscar winners' });
    await press(A, 'nmj_accept');
    assert.equal(game.currentPlayerId(), 'h');
    await press(B, 'nmj_accept');
    assert.equal(game.moves.length, 1);
    assert.equal(game.currentPlayerId(), 'a');
  });

  it('a successful challenge eliminates the player and refunds the challenger', async () => {
    await modal(A, 'nmj_move_modal', { nmj_celeb: 'Meryl Streep', nmj_category: 'No More actresses' });
    assert.equal((await press(B, 'nmj_challenge')).modal(), 'nmj_challenge_modal');
    await modal(B, 'nmj_challenge_modal', { nmj_challenge_category: 'oscar winners' });
    assert.equal(game.challengeState.matchedCategory, 'No More Oscar winners');
    assert.equal(game.challengeCounts.get('b'), 2);

    await press(H, 'nmj_vote_success');
    const saved = NoMoreJockeysGameState.fromRow(repository.getAll().find(r => r.thread_id === thread.id));
    assert.deepEqual(NoMoreJockeysGameState.toRow(saved), NoMoreJockeysGameState.toRow(game), 'saved mid-challenge');

    await press(A, 'nmj_vote_fail');
    await press(B, 'nmj_vote_success');
    assert.deepEqual(game.eliminatedPlayers, ['a']);
    assert.equal(game.challengeCounts.get('b'), CHALLENGE_TOKENS_PER_PLAYER);
    assert.equal(game.currentPlayerId(), 'b');
  });

  it('the last player standing wins; the thread is archived and the result posted where it started', async () => {
    await modal(B, 'nmj_move_modal', { nmj_celeb: 'Brad Pitt', nmj_category: 'No More blondes' });
    await press(H, 'nmj_challenge');
    await modal(H, 'nmj_challenge_modal', { nmj_challenge_category: 'actresses' });
    await press(H, 'nmj_vote_success');
    await press(B, 'nmj_vote_success');

    assert.equal(game.phase, 'ended');
    assert.equal(manager.getGame(thread.id), null);
    assert.deepEqual([thread.locked, thread.archived], [true, true]);
    assert.equal(origin.sent.length, 1);
    assert.ok(JSON.stringify(origin.sent[0].components).includes('wins No More Jockeys'));
    assert.deepEqual(repository.getAll(), []);
  });

  it('records the finished game in each player\'s stats', () => {
    const rows = db.prepare('SELECT * FROM nmj_player_stats ORDER BY user_id').all();
    const byId = Object.fromEntries(rows.map(r => [r.user_id, r]));
    assert.deepEqual(Object.keys(byId), ['a', 'b', 'h']);
    for (const row of rows) assert.equal(row.games_played, 1);
    assert.deepEqual([byId.h.wins, byId.a.wins, byId.b.wins], [1, 0, 0]);
    assert.deepEqual([byId.h.knockouts, byId.b.knockouts], [1, 1]);
    assert.deepEqual([byId.a.times_eliminated, byId.b.times_eliminated, byId.h.times_eliminated], [1, 1, 0]);
    assert.equal(byId.a.username, 'Ann');
  });
});

describe('/nmj start and end', () => {
  const thread = createThread('cmd-thread');
  const channel = createChannel('cmd-channel', thread);
  const manager = newManager();
  const client = createClient([thread, channel], { nmjManager: manager });
  const host = user('host1', 'HostOne');

  it('start creates a public game thread with the host in it, and refuses a second game', async () => {
    const first = slashCommand({ sub: 'start', user: host, channel });
    await nmj.command.execute(first, client);
    const game = manager.getGameByHost('guild-1', 'host1');
    assert.equal(game.hostUsername, 'HostOne');
    assert.deepEqual(game.turnOrder(), ['host1']);
    assert.equal(channel.createdThreads[0].type, 11);
    assert.ok(game.messageId);

    const second = slashCommand({ sub: 'start', user: host, channel });
    await nmj.command.execute(second, client);
    assert.match(second.replies()[0], /^You already have an active/);
  });

  it('end is refused for other players', async () => {
    const attempt = slashCommand({ sub: 'end', user: user('other'), channel, channelId: thread.id });
    await nmj.command.execute(attempt, client);
    assert.match(attempt.replies()[0], /^Only the game creator/);
  });

  it('restore brings the game back and re-renders its message in place', async () => {
    const restored = newManager();
    await quietly(() => nmj.restore(createClient([thread], { nmjManager: restored })));
    const game = restored.getGame(thread.id);
    assert.ok(game instanceof NoMoreJockeysGameState);
    assert.equal(game.hostId, 'host1');
    assert.equal(thread.sent.length, 1, 'nothing new posted');
  });
});

describe('stats', () => {
  const stats = src('games/nmj/stats');

  it('counts failed challenges, and keeps a known username when a later game has none', () => {
    const game = new NoMoreJockeysGameState('stats-guild', 'C', 'T', 'p1', 'P1');
    game.players = new Map([['p1', { id: 'p1', username: 'P1' }], ['p2', { id: 'p2', username: 'P2' }]]);
    game.challengeResults = [
      { challengerId: 'p2', targetId: 'p1', success: false },
      { challengerId: 'p1', targetId: 'p2', success: true },
    ];
    stats.recordGame(game, 'p1');
    game.players.set('p2', { id: 'p2', username: null });
    stats.recordGame(game, 'p1');

    const p1 = stats.getPlayer('stats-guild', 'p1');
    const p2 = stats.getPlayer('stats-guild', 'p2');
    assert.deepEqual([p1.games_played, p1.wins, p1.knockouts, p1.failed_challenges], [2, 2, 2, 0]);
    assert.deepEqual([p2.games_played, p2.wins, p2.failed_challenges, p2.times_eliminated], [2, 0, 2, 2]);
    assert.equal(p2.username, 'P2');
    assert.deepEqual(stats.scoreboard('stats-guild').map(r => r.user_id), ['p1', 'p2']);
    assert.equal(stats.describe(p1), 'No More Jockeys: 2 games, 2 wins, 2 successful challenges.');
    assert.equal(stats.describe(null), null);
  });

  it('a game ended early with /nmj end isn\'t counted', async () => {
    const thread = createThread('ended-early');
    const channel = createChannel('ended-early-channel', thread);
    const manager = newManager();
    const client = createClient([thread, channel], { nmjManager: manager });
    const game = manager.createGame('early-guild', channel.id, thread.id, 'e1', 'E1');
    for (const id of ['e1', 'e2', 'e3']) manager.addPlayer(thread.id, user(id));
    manager.beginGame(thread.id);
    game.challengeResults.push({ challengerId: 'e2', targetId: 'e1', success: false });

    const reloaded = NoMoreJockeysGameState.fromRow(repository.getAll().find(r => r.thread_id === thread.id) ?? NoMoreJockeysGameState.toRow(game));
    repository.upsert(game);
    assert.deepEqual(NoMoreJockeysGameState.fromRow(repository.getAll().find(r => r.thread_id === thread.id)).challengeResults, game.challengeResults, 'challenge results are saved');
    assert.ok(reloaded);

    const end = slashCommand({ sub: 'end', user: user('e1'), channel, channelId: thread.id });
    await quietly(() => nmj.command.execute(end, client));
    assert.equal(manager.getGame(thread.id), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nmj_player_stats WHERE guild_id = 'early-guild'").get().n, 0);
  });

  it('adds the challenge_results column to a table from before it existed', () => {
    db.exec('ALTER TABLE nmj_games DROP COLUMN challenge_results');
    delete require.cache[require.resolve('../src/games/nmj/repository')];
    src('games/nmj/repository');
    const columns = db.prepare('PRAGMA table_info(nmj_games)').all().map(c => c.name);
    assert.ok(columns.includes('challenge_results'));
  });
});
