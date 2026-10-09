'use strict';

/** The bot as a whole: startup, commands, the single interaction listener, restore. */

const { src, SRC } = require('./helpers/env');
const path = require('path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const discord = require('discord.js');
const { user, componentInteraction, slashCommand, quietly } = require('./helpers/discord');

process.env.DASHBOARD_ENABLED = 'false';

/** Starts src/index.js without logging in to Discord and returns the client it built. */
async function bootBot() {
  const created = [];
  const OriginalClient = discord.Client;
  discord.Client = class extends OriginalClient {
    constructor(...args) { super(...args); created.push(this); }
    async login() { return 'not logged in (test)'; }
  };
  try {
    await quietly(async () => require(path.join(SRC, 'index.js')));
  } finally {
    discord.Client = OriginalClient;
  }
  return created[0];
}

describe('startup', () => {
  let client;
  before(async () => { client = await bootBot(); });

  it('creates a manager per game, reachable by id and by the game\'s client key', () => {
    assert.deepEqual([...client.games.keys()], ['werewords', 'wavelength', 'nmj']);
    for (const [, { game, manager }] of client.games) assert.equal(client[game.clientKey], manager);
    assert.equal(client.cheeseThiefManager, undefined);
    assert.equal(client.herdMentalityManager, undefined);
  });

  it('serves each game\'s command plus the non-game commands', () => {
    assert.deepEqual([...client.commands.keys()].sort(), ['birthday', 'nmj', 'wavelength', 'werewords']);
  });

  it('registers one interactionCreate listener', () => {
    assert.equal(client.listenerCount('interactionCreate'), 1);
    assert.equal(client.listenerCount('messageCreate'), 1);
  });

  describe('the interactionCreate listener', () => {
    const fire = async interaction => {
      await client.listeners('interactionCreate')[0](interaction);
      await new Promise(resolve => setImmediate(resolve));
    };

    it('routes buttons and modals to the game that owns the prefix', async () => {
      const routed = [];
      const games = [...client.games.values()].map(({ game }) => [game, game.handleInteraction]);
      try {
        for (const [game] of games) game.handleInteraction = async i => routed.push([game.id, i.customId]);
        for (const id of ['ww_ready', 'wl_submit_x', 'nmj_join', 'zz_unknown']) {
          await fire(componentInteraction({ customId: id, user: user('u'), channelId: 'c' }));
        }
        await fire(componentInteraction({ customId: 'wl_clue_modal', user: user('u'), channelId: 'c', kind: 'modal' }));
      } finally {
        for (const [game, handler] of games) game.handleInteraction = handler;
      }
      assert.deepEqual(routed, [['werewords', 'ww_ready'], ['wavelength', 'wl_submit_x'], ['nmj', 'nmj_join'], ['wavelength', 'wl_clue_modal']]);
    });

    it('ignores leftover Cheese Thief and Herd Mentality buttons', async () => {
      for (const id of ['ct_secret', 'hm_join_123']) {
        const interaction = componentInteraction({ customId: id, user: user('u'), channelId: 'c' });
        const { logs } = await quietly(() => fire(interaction));
        assert.deepEqual(interaction.calls, []);
        assert.deepEqual(logs, []);
      }
    });

    it('answers each game\'s buttons with its own "no game here" reply', async () => {
      const cases = [
        ['ww_word_modal', 'modal', 'There is no active game.'],
        ['wl_clue_modal', 'modal', 'No active cluing phase.'],
        ['nmj_accept', 'button', 'There is no active No More Jockeys game in this thread.'],
      ];
      for (const [customId, kind, expected] of cases) {
        const interaction = componentInteraction({ customId, user: user('u'), channelId: 'nowhere', kind });
        await fire(interaction);
        assert.deepEqual(interaction.replies(), [expected], customId);
      }
    });

    it('runs slash commands and reports their errors', async () => {
      const command = client.commands.get('birthday');
      const original = command.execute;
      try {
        let ran = 0;
        command.execute = async () => { ran++; };
        await fire({ ...slashCommand({ user: user('u') }), commandName: 'birthday' });
        assert.equal(ran, 1);

        command.execute = async () => { throw new Error('x'); };
        const failing = { ...slashCommand({ user: user('u') }), commandName: 'birthday' };
        failing.reply = async p => failing.calls.push(p);
        await quietly(() => fire(failing));
        assert.deepEqual(failing.calls.map(p => p.content), ['❌ An error occurred running that command.']);
      } finally {
        command.execute = original;
      }
    });
  });
});

describe('restore', () => {
  const { restoreGames } = src('db/restore');
  const { getGames } = src('games/_core/registry');
  const db = src('db/database');

  it('runs every game\'s restore; one failure is logged and doesn\'t stop the others', async () => {
    const nmj = getGames().find(g => g.id === 'nmj');
    const original = nmj.restore;
    const ran = [];
    const originals = getGames().map(g => [g, g.restore]);
    try {
      for (const [game] of originals) game.restore = async () => { ran.push(game.id); };
      nmj.restore = async () => { throw new Error('broken'); };
      const { logs } = await quietly(() => restoreGames({}));
      assert.deepEqual(ran.sort(), ['wavelength', 'werewords']);
      assert.ok(logs.some(line => line.includes('[Restore] No More Jockeys failed')));
    } finally {
      for (const [game, restore] of originals) game.restore = restore;
      nmj.restore = original;
    }
  });

  it('leaves the removed games\' old tables and rows alone', async () => {
    db.exec("CREATE TABLE IF NOT EXISTS cheese_thief_games (thread_id TEXT PRIMARY KEY, phase TEXT)");
    db.exec("INSERT INTO cheese_thief_games VALUES ('ct-old', 'voting')");
    const client = { channels: { fetch: async () => null } };
    for (const { clientKey, createManager } of getGames()) client[clientKey] = createManager();
    await quietly(() => restoreGames(client));
    assert.deepEqual(db.prepare('SELECT thread_id FROM cheese_thief_games').all(), [{ thread_id: 'ct-old' }]);
  });
});

describe('deploy-commands', () => {
  it('sends every command to Discord', async () => {
    let body = null;
    const originalPut = discord.REST.prototype.put;
    discord.REST.prototype.put = async function (route, options) { body = options.body; };
    try {
      await quietly(async () => {
        require(path.join(SRC, 'deploy-commands.js'));
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    } finally {
      discord.REST.prototype.put = originalPut;
    }
    assert.deepEqual(body.map(c => c.name).sort(), ['birthday', 'nmj', 'wavelength', 'werewords']);
    const werewords = body.find(c => c.name === 'werewords');
    assert.deepEqual(werewords.options.map(o => o.name), ['start', 'end']);
  });
});
