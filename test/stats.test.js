'use strict';

/** Stats across games: the per-game hooks, the AI user context and the MCP scoreboards. */

const { src } = require('./helpers/env');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ContextRepository loads before any game, as it does in src/index.js.
const db = src('db/database');
const contextRepository = src('db/ContextRepository');
const McpServer = src('mcp/McpServer');
const { gamesWithStats, getPlayerStats, describePlayer, getScoreboard } = src('games/_core/stats');

const GUILD = 'guild-s';

before(() => {
  // Load the games, as src/index.js does at startup; each creates its own stats table.
  gamesWithStats();

  // One player with a record in every game.
  db.prepare(`INSERT INTO werewords_player_stats (guild_id, user_id, username, games_played, wins, losses)
    VALUES (?, 'u1', 'Una', 4, 3, 1)`).run(GUILD);
  db.prepare(`INSERT INTO wavelength_player_stats (guild_id, user_id, username, rounds_played, total_score, bullseyes)
    VALUES (?, 'u1', 'Una', 2, 7, 1)`).run(GUILD);
  const NoMoreJockeysGameState = src('games/nmj/state');
  const game = new NoMoreJockeysGameState(GUILD, 'C', 'T', 'u1', 'Una');
  game.players = new Map([['u1', { id: 'u1', username: 'Una' }], ['u2', { id: 'u2', username: 'Two' }]]);
  game.challengeResults = [{ challengerId: 'u1', targetId: 'u2', success: true }];
  src('games/nmj/stats').recordGame(game, 'u1');
  contextRepository.logMessage('chan', GUILD, 'u1', 'Una', 'hello');
});

describe('stats across games', () => {
  it('every current game provides stats', () => {
    assert.deepEqual(gamesWithStats().map(g => g.id), ['werewords', 'wavelength', 'nmj']);
  });

  it('a fresh database gets each game\'s stats tables, even with the context code loaded first', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%player_stats'").all().map(t => t.name).sort();
    assert.deepEqual(tables, ['nmj_player_stats', 'wavelength_player_stats', 'werewords_player_stats']);
  });

  it('collects a player\'s row from each game', () => {
    const rows = getPlayerStats(GUILD, 'u1');
    assert.deepEqual(Object.keys(rows), ['werewords', 'wavelength', 'nmj']);
    assert.equal(rows.werewords.wins, 3);
    assert.equal(rows.wavelength.total_score, 7);
    assert.equal(rows.nmj.knockouts, 1);
    assert.deepEqual(getPlayerStats(GUILD, 'nobody'), { werewords: null, wavelength: null, nmj: null });
  });

  it('describes a player in one sentence per game they\'ve played', () => {
    assert.deepEqual(describePlayer(GUILD, 'u1'), [
      'Werewords record: 4 games, 3 wins (75%).',
      'Wavelength: 2 rounds, avg score 3.5, 1 bullseyes.',
      'No More Jockeys: 1 games, 1 wins, 1 successful challenges.',
    ]);
    assert.deepEqual(describePlayer(GUILD, 'u2'), ['No More Jockeys: 1 games, 0 wins, 0 successful challenges.']);
  });

  it('returns a scoreboard per game, or null for an unknown game', () => {
    assert.deepEqual(getScoreboard('nmj', GUILD).map(r => r.user_id), ['u1', 'u2']);
    assert.equal(getScoreboard('cheesethief', GUILD), null);
  });
});

describe('ContextRepository', () => {
  it('getUserContext has every game\'s stats, plus the old wwStats / wlStats keys', () => {
    const context = contextRepository.getUserContext(GUILD, 'u1');
    assert.deepEqual(Object.keys(context.gameStats), ['werewords', 'wavelength', 'nmj']);
    assert.equal(context.wwStats, context.gameStats.werewords);
    assert.equal(context.wlStats, context.gameStats.wavelength);
    assert.equal(context.recentMessages.length, 1);
  });

  it('the AI\'s user context mentions every game the player has played', () => {
    const summary = contextRepository.buildUserContextString(GUILD, 'u1');
    assert.match(summary, /^User "Una" has sent 1 messages/);
    assert.match(summary, /Werewords record: 4 games/);
    assert.match(summary, /Wavelength: 2 rounds/);
    assert.match(summary, /No More Jockeys: 1 games, 1 wins/);
    assert.equal(contextRepository.buildUserContextString(GUILD, 'stranger'), null);
  });
});

describe('MCP scoreboards', () => {
  const server = new McpServer(contextRepository, 0);
  const get = path => server._route('GET', path, new URL(`http://localhost${path}`), null);

  it('lists the games with scoreboards', async () => {
    const capabilities = await get('/');
    assert.deepEqual(capabilities.games, [
      { id: 'werewords', name: 'Werewords' },
      { id: 'wavelength', name: 'Wavelength' },
      { id: 'nmj', name: 'No More Jockeys' },
    ]);
  });

  it('keeps the existing URLs: Werewords at /scoreboards/:guildId, and .../wavelength', async () => {
    assert.equal((await get(`/resources/scoreboards/${GUILD}`))[0].win_pct, 75);
    assert.equal((await get(`/resources/scoreboards/${GUILD}/wavelength`))[0].avg_score, 3.5);
  });

  it('serves any game\'s scoreboard, and 404s for unknown games', async () => {
    assert.deepEqual((await get(`/resources/scoreboards/${GUILD}/nmj`)).map(r => r.user_id), ['u1', 'u2']);
    await assert.rejects(get(`/resources/scoreboards/${GUILD}/cheesethief`), err => err.status === 404);
  });
});
