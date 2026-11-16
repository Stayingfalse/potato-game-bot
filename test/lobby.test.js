'use strict';

/** The lobby every game shares (src/games/_core/lobby.js), each game's lobby, "How to play" and /help. */

const { src } = require('./helpers/env');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const {
  user, createThread, createChannel, createClient, componentInteraction, slashCommand, quietly, allCustomIds, findComponent,
} = require('./helpers/discord');

const lobby = src('games/_core/lobby');
const { getGames } = src('games/_core/registry');
const help = src('commands/help');

/** Each game's minimum, and where its lobby's player list is drawn. */
const MINIMUMS = { werewords: 3, wavelength: 2, nmj: 3, huesclues: 2, articulate: 4 };

const managers = [];
after(() => { for (const m of managers) for (const game of m.games.values()) m.clearTimers(game); });

/** Starts `game` with its real command in a fresh thread; returns what the tests need to press buttons. */
async function openLobby(game, host) {
  const thread = createThread(`${game.id}-lobby-thread`);
  const channel = createChannel(`${game.id}-lobby-channel`, thread);
  const manager = game.createManager();
  managers.push(manager);
  const client = createClient([thread, channel], { [game.clientKey]: manager });
  await quietly(() => game.command.execute(slashCommand({ sub: 'start', user: host, channel }), client));
  const state = manager.getGame(thread.id);
  const message = () => thread.store.get(state.messageId);
  const press = async (from, action, channelId = thread.id) => {
    const interaction = componentInteraction({ customId: `${game.prefix}${action}`, user: from, channelId, message: message() });
    const { logs } = await quietly(() => game.handleInteraction(interaction, client));
    assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'));
    return interaction;
  };
  return { thread, channel, manager, client, state, message, press };
}

describe('the shared lobby builders', () => {
  it('Start is disabled and says how many players are missing until the minimum is met', () => {
    const start = (playerCount, minPlayers) => lobby.buildStartButton({ customId: 'x_start', playerCount, minPlayers }).toJSON();
    assert.deepEqual([start(1, 3).label, start(1, 3).disabled], ['Need 2 more players', true]);
    assert.deepEqual([start(2, 3).label, start(2, 3).disabled], ['Need 1 more player', true]);
    assert.deepEqual([start(3, 3).label, start(3, 3).disabled], ['Start Game', false]);
    assert.deepEqual([start(9, 3).label, start(9, 3).disabled], ['Start Game', false]);
    assert.equal(lobby.playersNeeded(0, 2), 2);
    assert.equal(lobby.playersNeeded(5, 2), 0);
  });

  it('the row is Join, Leave, Start, Cancel, How to play, in one action row', () => {
    const row = lobby.buildLobbyRow({ prefix: 'x_', playerCount: 1, minPlayers: 2 }).toJSON();
    assert.deepEqual(row.components.map(c => c.custom_id), ['x_join', 'x_leave', 'x_start', 'x_cancel', 'x_howto']);
    assert.deepEqual(row.components.map(c => c.label), ['Join', 'Leave', 'Need 1 more player', 'Cancel', 'How to play']);
  });

  it('lists players as mentions, or invites the first one', () => {
    assert.equal(lobby.formatPlayerList(new Map([['1', {}], ['2', {}]]).keys()), '• <@1>\n• <@2>');
    assert.equal(lobby.formatPlayerList(['7']), '• <@7>');
    assert.match(lobby.formatPlayerList([]), /No players yet/);
  });

  it('the how-to-play reply is private and has the game\'s name, rules and player count', () => {
    const reply = lobby.howToPlayReply({ name: 'Test Game', howToPlay: { emoji: '🧪', summary: 'A test.', players: '2–4', rules: ['One.', 'Two.'] } });
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.equal(reply.content, '## 🧪 How to play Test Game\n*A test.*\n\n• One.\n• Two.\n\n👥 **Players:** 2–4');
  });
});

describe('every game\'s lobby', () => {
  it('there is a minimum on record here for every registered game', () => {
    assert.deepEqual(getGames().map(g => g.id).sort(), Object.keys(MINIMUMS).sort());
  });

  for (const game of getGames()) {
    describe(game.name, () => {
      const min = MINIMUMS[game.id];
      const HOST = user('host', 'Host');
      const joiners = Array.from({ length: min - 1 }, (_, i) => user(`p${i + 1}`, `Player${i + 1}`));
      let session;
      const startButton = () => findComponent(session.message().payload, `${game.prefix}start`);

      it('has the standard buttons, with Start disabled below the minimum and enabled at it', async () => {
        session = await openLobby(game, HOST);
        assert.equal(session.state.phase, 'lobby');
        assert.deepEqual(
          allCustomIds(session.message().payload),
          ['join', 'leave', 'start', 'cancel', 'howto'].map(action => `${game.prefix}${action}`),
        );
        assert.equal(startButton().disabled, true);
        assert.equal(startButton().label, `Need ${min - 1} more player${min - 1 === 1 ? '' : 's'}`);

        for (const [i, joiner] of joiners.entries()) {
          assert.equal(startButton().disabled, true, `disabled with ${i + 1} player(s)`);
          await session.press(joiner, 'join');
        }
        assert.equal(session.state.players.size, min);
        assert.ok(!startButton().disabled, 'enabled at the minimum');
        assert.equal(startButton().label, 'Start Game');
      });

      it('lists the players as mentions', () => {
        const text = JSON.stringify(session.message().payload);
        for (const id of ['host', ...joiners.map(j => j.id)]) assert.ok(text.includes(`• <@${id}>`), id);
        assert.ok(!text.includes('Player1'), 'no plain usernames');
      });

      it('Start goes back to disabled when a player leaves, and the handler still refuses a short lobby', async () => {
        await session.press(joiners.at(-1), 'leave');
        assert.equal(startButton().disabled, true);
        assert.equal(startButton().label, 'Need 1 more player');
        const refused = await session.press(HOST, 'start');
        assert.match(refused.replies()[0], new RegExp(`^Need at least \\*\\*${min} players\\*\\* to start`));
        assert.equal(session.state.phase, 'lobby');
        await session.press(joiners.at(-1), 'join');
        assert.ok(!startButton().disabled);
      });

      it('How to play replies privately with the rules, to anyone, even outside a game thread', async () => {
        const how = game.howToPlay;
        assert.ok(how.summary && how.players && how.emoji);
        assert.ok(how.rules.length >= 8 && how.rules.length <= 12, `${how.rules.length} lines`);

        for (const channelId of [session.thread.id, 'not-a-game-thread']) {
          const shown = await session.press(user('stranger'), 'howto', channelId);
          const [type, payload] = shown.calls[0];
          assert.equal(type, 'reply');
          assert.equal(payload.flags, MessageFlags.Ephemeral);
          assert.equal(payload.content, lobby.howToPlayText(game));
          assert.ok(payload.content.startsWith(`## ${how.emoji} How to play ${game.name}\n`));
          assert.ok(payload.content.length <= 2000, 'fits in one message');
        }
        assert.equal(session.state.phase, 'lobby', 'the lobby is untouched');
      });
    });
  }
});

describe('No More Jockeys: cancelling the lobby', () => {
  const nmj = getGames().find(g => g.id === 'nmj');
  const HOST = user('host', 'Host'), A = user('a', 'Ann');

  it('only the host can cancel; it closes the game, archives the thread and frees the host', async () => {
    const session = await openLobby(nmj, HOST);
    await session.press(A, 'join');
    assert.deepEqual((await session.press(A, 'cancel')).replies(), ['Only the game creator can cancel the game.']);
    assert.ok(session.manager.getGame(session.thread.id));

    const cancel = await session.press(HOST, 'cancel');
    assert.ok(cancel.deferred);
    assert.equal(session.manager.getGame(session.thread.id), null);
    assert.equal(session.manager.getGameByHost('guild-1', 'host'), null);
    assert.ok(session.thread.locked && session.thread.archived);
    const closed = JSON.stringify(session.message().payload.components);
    assert.ok(closed.includes('Game cancelled by <@host> before it started.'));
    assert.ok(!closed.includes('nmj_join'), 'the lobby buttons are gone');
    assert.ok(JSON.stringify(session.channel.sent.at(-1).components).includes('Game cancelled by <@host>'));
    assert.equal(src('db/database').prepare('SELECT COUNT(*) AS n FROM nmj_games WHERE thread_id = ?').get(session.thread.id).n, 0);
    assert.deepEqual((await session.press(HOST, 'join')).replies(), ['There is no active No More Jockeys game in this thread.']);
  });

  it('is refused once the game has started', async () => {
    const session = await openLobby(nmj, HOST);
    await session.press(A, 'join');
    await session.press(user('b', 'Bob'), 'join');
    await session.press(HOST, 'start');
    assert.equal(session.state.phase, 'ordering');
    assert.deepEqual((await session.press(HOST, 'cancel')).replies(), ['This game has already started — use `/nmj end` to end it.']);
    assert.ok(session.manager.getGame(session.thread.id));
    session.manager.deleteGame(session.thread.id);
  });
});

describe('/help', () => {
  const run = async gameId => {
    const interaction = { ...slashCommand({ user: user('u') }), options: { getString: name => (name === 'game' ? gameId : null) } };
    await help.execute(interaction);
    return interaction.calls[0];
  };

  it('is a slash command with an optional game choice for every game', () => {
    const data = help.data.toJSON();
    assert.equal(data.name, 'help');
    const [option] = data.options;
    assert.equal(option.name, 'game');
    assert.equal(option.required, false);
    assert.deepEqual(option.choices.map(({ name, value }) => ({ name, value })), getGames().map(g => ({ name: g.name, value: g.id })));
    assert.ok(src('utils/loadCommands').loadCommands().includes(help));
  });

  it('lists every game with its description, player count and start command, plus birthdays', async () => {
    const reply = await run(null);
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    const embed = reply.embeds[0].toJSON();
    assert.deepEqual(embed.fields.map(f => f.name), [...getGames().map(g => `${g.howToPlay.emoji} ${g.name}`), '🎂 Birthdays']);
    for (const [i, game] of getGames().entries()) {
      const { value } = embed.fields[i];
      assert.ok(value.startsWith(game.howToPlay.summary), game.id);
      assert.ok(value.includes(`👥 ${game.howToPlay.players} players`), game.id);
      assert.ok(value.includes(`\`/${game.id} start\``), game.id);
    }
    assert.match(embed.fields.at(-1).value, /\/birthday set <date>/);
    assert.match(embed.description, /\/help game:<name>/);
  });

  it('with a game, shows that game\'s how-to-play text', async () => {
    for (const game of getGames()) {
      const reply = await run(game.id);
      assert.equal(reply.flags, MessageFlags.Ephemeral);
      const embed = reply.embeds[0].toJSON();
      assert.equal(embed.description, lobby.howToPlayText(game));
      assert.equal(embed.footer.text, `Start a game with /${game.id} start`);
    }
  });

  it('copes with a game that has no how-to-play, and with an unknown game', async () => {
    const bare = help.buildGameEmbed({ id: 'x', name: 'Mystery', command: { data: { name: 'x' } } }).toJSON();
    assert.equal(bare.title, 'Mystery');
    assert.match(bare.description, /No how-to-play/);
    const overview = help.buildOverviewEmbed([{ id: 'x', name: 'Mystery', command: { data: { name: 'x' } } }]).toJSON();
    assert.deepEqual(overview.fields[0], { name: 'Mystery', value: '▶️ `/x start`' });

    const reply = await run('nope');
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.match(reply.content, /don't know that game/);
  });
});
