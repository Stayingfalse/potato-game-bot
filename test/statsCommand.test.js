'use strict';

/** /stats, /leaderboard and the "🏆 Leaderboard" button on a game's results screen. */

const { src } = require('./helpers/env');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { user, componentInteraction, allCustomIds } = require('./helpers/discord');

const db = src('db/database');
const { getGames } = src('games/_core/registry');
const { routeGameInteraction } = src('games/_core/router');
const { loadCommands } = src('utils/loadCommands');

const GUILD = 'guild-stats';
const EMPTY_GUILD = 'guild-empty';

const commands = new Map(loadCommands().map(command => [command.data.name, command]));

/** A /stats or /leaderboard interaction with the given options. */
function command(name, { from, guildId = GUILD, game = null, target = null } = {}) {
  const interaction = {
    commandName: name,
    guildId,
    user: from,
    calls: [],
    options: { getString: () => game, getUser: () => target },
    reply: async payload => { interaction.calls.push(payload); },
  };
  return interaction;
}

async function run(name, options) {
  const interaction = command(name, options);
  await commands.get(name).execute(interaction);
  assert.equal(interaction.calls.length, 1, 'one reply');
  const [payload] = interaction.calls;
  return { payload, embed: payload.embeds?.[0]?.data };
}

const isEphemeral = payload => payload.flags === MessageFlags.Ephemeral;

before(() => {
  getGames(); // creates each game's stats table, as at startup

  const werewords = db.prepare(`INSERT INTO werewords_player_stats (guild_id, user_id, username, games_played, wins, losses, correct_guesses)
    VALUES (?, ?, ?, ?, ?, ?, 0)`);
  // 12 players: p01 has the most wins, p12 the fewest.
  for (let i = 1; i <= 12; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    werewords.run(GUILD, id, `Player ${i}`, 20, 13 - i, 7 + i);
  }
  werewords.run('another-guild', 'stranger', 'Stranger', 50, 50, 0);

  db.prepare(`INSERT INTO wavelength_player_stats (guild_id, user_id, username, rounds_played, total_score, bullseyes)
    VALUES (?, 'p01', 'Player 1', 4, 10, 1)`).run(GUILD);
});

describe('the stats commands', () => {
  it('are loaded with the other commands, with a choice for every game that has stats', () => {
    const withStats = getGames().filter(game => game.stats).map(game => game.id);
    assert.deepEqual(withStats, ['werewords', 'wavelength', 'nmj', 'huesclues', 'articulate']);
    for (const name of ['stats', 'leaderboard']) {
      const option = commands.get(name).data.toJSON().options.find(o => o.name === 'game');
      assert.deepEqual(option.choices.map(c => c.value), withStats, name);
    }
    assert.equal(commands.get('leaderboard').data.toJSON().options[0].required, true);
  });

  it('every game says how its stats read', () => {
    for (const game of getGames().filter(g => g.stats)) {
      assert.equal(typeof game.stats.describePlayer, 'function', game.id);
      assert.deepEqual(game.stats.leaderboard(EMPTY_GUILD), [], game.id);
    }
  });
});

describe('/stats', () => {
  it('shows the caller a section for each game they have played, privately and without pings', async () => {
    const { payload, embed } = await run('stats', { from: user('p01') });
    assert.ok(isEphemeral(payload));
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    assert.match(embed.description, /<@p01>/);
    assert.deepEqual(embed.fields.map(f => f.name), ['Werewords', 'Wavelength']);
    assert.match(embed.fields[0].value, /Games: \*\*20\*\*/);
    assert.match(embed.fields[0].value, /Wins: \*\*12 \(60%\)\*\*/);
    assert.match(embed.fields[1].value, /Total score: \*\*10 pts\*\*/);
    assert.match(embed.fields[1].value, /Average: \*\*2\.5 pts a round\*\*/);
  });

  it('can be narrowed to one game and pointed at another player', async () => {
    const { embed } = await run('stats', { from: user('p05'), game: 'werewords', target: user('p01') });
    assert.match(embed.description, /<@p01>/);
    assert.deepEqual(embed.fields.map(f => f.name), ['Werewords']);
  });

  it('has a friendly empty state', async () => {
    const nobody = await run('stats', { from: user('newbie') });
    assert.ok(isEphemeral(nobody.payload));
    assert.equal(nobody.embed.description, 'No games played yet. Try `/wavelength start`.');
    assert.equal(nobody.embed.fields, undefined);

    const oneGame = await run('stats', { from: user('p02'), game: 'wavelength' });
    assert.equal(oneGame.embed.description, 'No Wavelength games played yet. Try `/wavelength start`.');

    const someoneElse = await run('stats', { from: user('p01'), target: user('newbie') });
    assert.equal(someoneElse.embed.description, '<@newbie> hasn\'t played any games yet.');
  });

  it('keeps servers apart, and asks for a server in DMs', async () => {
    const elsewhere = await run('stats', { from: user('p01'), guildId: EMPTY_GUILD });
    assert.match(elsewhere.embed.description, /^No games played yet/);

    const dm = await run('stats', { from: user('p01'), guildId: null });
    assert.match(dm.payload.content, /use this command in a server/);
  });
});

describe('/leaderboard', () => {
  it('lists the top 10 in order, publicly, with medals for the top three', async () => {
    const { payload, embed } = await run('leaderboard', { from: user('p03'), game: 'werewords' });
    assert.ok(!payload.flags, 'public');
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    assert.equal(embed.title, '🏆 Werewords Leaderboard');

    const lines = embed.description.split('\n');
    assert.equal(lines.length, 10);
    assert.deepEqual(lines.map(line => /<@(\w+)>/.exec(line)[1]),
      ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10']);
    assert.equal(lines[0], '🥇 <@p01> — **12 wins** · 60% of 20 games');
    assert.ok(lines[1].startsWith('🥈 <@p02>'));
    assert.ok(lines[2].startsWith('🥉 <@p03>'));
    assert.ok(lines[3].startsWith('**4.** <@p04>'));
    assert.ok(lines[9].startsWith('**10.** <@p10>'));
    assert.ok(!embed.description.includes('stranger'), 'other servers are not included');
    assert.equal(embed.footer.text, '12 players ranked');
  });

  it('shows the caller\'s own rank underneath when they are outside the top 10', async () => {
    const { embed } = await run('leaderboard', { from: user('p12'), game: 'werewords' });
    const lines = embed.description.split('\n');
    assert.equal(lines.length, 12);
    assert.equal(lines[10], '⋯');
    assert.equal(lines[11], '**12.** <@p12> — **1 win** · 5% of 20 games');

    const outsider = await run('leaderboard', { from: user('newbie'), game: 'werewords' });
    assert.equal(outsider.embed.description.split('\n').length, 10);
  });

  it('has a friendly empty state', async () => {
    const { payload, embed } = await run('leaderboard', { from: user('p01'), game: 'nmj' });
    assert.ok(!payload.flags);
    assert.equal(embed.title, '🏆 No More Jockeys Leaderboard');
    assert.equal(embed.description, 'No games played yet. Try `/nmj start`.');
  });
});

describe('the Leaderboard button', () => {
  it('is on the Werewords results screen', () => {
    const components = src('games/werewords/phases/sessionEnd').buildRematchComponents();
    const ids = allCustomIds({ components: components.map(row => row.toJSON()) });
    assert.ok(ids.includes('ww_leaderboard'));
    assert.ok(ids.length <= 5);
  });

  it('shows the game\'s leaderboard to the player who pressed it only', async () => {
    const { WerewordsManager } = src('games/werewords/manager');
    const interaction = componentInteraction({ customId: 'ww_leaderboard', user: user('p11'), channelId: 'thread-x' });
    interaction.guildId = GUILD;

    assert.equal(await routeGameInteraction(interaction, { werewordsManager: new WerewordsManager() }), true);

    assert.equal(interaction.calls.length, 1);
    const [type, payload] = interaction.calls[0];
    assert.equal(type, 'reply');
    assert.ok(isEphemeral(payload));
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    const embed = payload.embeds[0].data;
    assert.equal(embed.title, '🏆 Werewords Leaderboard');
    assert.ok(embed.description.startsWith('🥇 <@p01>'));
    assert.ok(embed.description.endsWith('**11.** <@p11> — **2 wins** · 10% of 20 games'));
  });

  it('routes for the other games that have it', async () => {
    const cases = [
      ['wl_leaderboard', 'wavelengthManager', '🏆 Wavelength Leaderboard'],
      ['hc_leaderboard', 'huesCluesManager', '🏆 Hues & Clues Leaderboard'],
      ['ar_leaderboard', 'articulateManager', '🏆 Articulate Leaderboard'],
    ];
    for (const [customId, clientKey, title] of cases) {
      const interaction = componentInteraction({ customId, user: user('p01'), channelId: 'thread-x' });
      interaction.guildId = GUILD;
      // The button sits on a results screen, so a game exists in the thread.
      await routeGameInteraction(interaction, { [clientKey]: { getGame: () => ({ guildId: GUILD, hostId: 'h' }) } });
      const payload = interaction.calls[0]?.[1];
      assert.equal(payload?.embeds?.[0]?.data.title, title, customId);
      assert.ok(isEphemeral(payload), customId);
    }
  });
});
