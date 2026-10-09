'use strict';

/** The per-game stats hook: every game with stats offers getPlayer and scoreboard. */

const { src } = require('./helpers/env');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const db = src('db/database');
const { getGames } = src('games/_core/registry');

const GUILD = 'guild-s';

before(() => {
  // Loading the games creates each one's stats table, as at startup.
  getGames();

  db.prepare(`INSERT INTO werewords_player_stats (guild_id, user_id, username, games_played, wins, losses)
    VALUES (?, 'u1', 'Una', 4, 3, 1)`).run(GUILD);
  db.prepare(`INSERT INTO wavelength_player_stats (guild_id, user_id, username, rounds_played, total_score, bullseyes)
    VALUES (?, 'u1', 'Una', 2, 7, 1)`).run(GUILD);
  const NoMoreJockeysGameState = src('games/nmj/state');
  const game = new NoMoreJockeysGameState(GUILD, 'C', 'T', 'u1', 'Una');
  game.players = new Map([['u1', { id: 'u1', username: 'Una' }], ['u2', { id: 'u2', username: 'Two' }]]);
  game.challengeResults = [{ challengerId: 'u1', targetId: 'u2', success: true }];
  src('games/nmj/stats').recordGame(game, 'u1');
});

describe('stats across games', () => {
  it('every current game provides the stats hook', () => {
    const withStats = getGames().filter(game => game.stats);
    assert.deepEqual(withStats.map(g => g.id), ['werewords', 'wavelength', 'nmj']);
    for (const game of withStats) {
      assert.equal(typeof game.stats.getPlayer, 'function', game.id);
      assert.equal(typeof game.stats.scoreboard, 'function', game.id);
    }
  });

  it('a fresh database gets each game\'s stats table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%player_stats'").all().map(t => t.name).sort();
    assert.deepEqual(tables, ['nmj_player_stats', 'wavelength_player_stats', 'werewords_player_stats']);
  });

  it('reads a player\'s row from each game, or null', () => {
    const stats = id => getGames().find(g => g.id === id).stats;
    assert.equal(stats('werewords').getPlayer(GUILD, 'u1').wins, 3);
    assert.equal(stats('wavelength').getPlayer(GUILD, 'u1').total_score, 7);
    assert.equal(stats('nmj').getPlayer(GUILD, 'u1').knockouts, 1);
    assert.equal(stats('werewords').getPlayer(GUILD, 'nobody'), null);
  });

  it('returns each game\'s scoreboard', () => {
    const stats = id => getGames().find(g => g.id === id).stats;
    assert.equal(stats('werewords').scoreboard(GUILD)[0].win_pct, 75);
    assert.equal(stats('wavelength').scoreboard(GUILD)[0].avg_score, 3.5);
    assert.deepEqual(stats('nmj').scoreboard(GUILD).map(r => r.user_id), ['u1', 'u2']);
  });
});
