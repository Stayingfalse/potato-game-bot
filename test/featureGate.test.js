'use strict';

/** Dashboard feature settings (Enabled + "Restrict to channels") gate game starts and birthdays. */

const { src } = require('./helpers/env');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const settingsRepo = src('dashboard/SettingsRepository');
const birthdayRepo = src('db/BirthdayRepository');
const BirthdayManager = src('game/BirthdayManager');
const interactionCreate = src('events/interactionCreate');
const { getGames } = src('games/_core/registry');
const { checkFeature, isFeatureEnabled } = src('games/_core/featureGate');

const LOBBY = '200000000000000001';
const GAMES_CHANNEL = '200000000000000002';
const OTHER_CHANNEL = '200000000000000003';

const textChannel = id => ({ id, parentId: 'category-1', isThread: () => false });
const threadIn = (parentId, id = '300000000000000001') => ({ id, parentId, isThread: () => true });

/** A client whose commands only record that they ran. */
function createClient() {
  const ran = [];
  const names = [...getGames().map(game => game.command.data.name), 'birthday', 'birthday-admin', 'ping'];
  const commands = new Map(names.map(name => [name, {
    execute: async interaction => { ran.push(`${name} ${interaction.options.getSubcommand()}`); },
  }]));
  return { commands, ran };
}

/** Runs /<commandName> <sub> through the bot's interactionCreate listener. */
async function run(commandName, sub, { guildId, channel = textChannel(LOBBY) }) {
  const client = createClient();
  const replies = [];
  const interaction = {
    commandName,
    guildId,
    channel,
    channelId: channel.id,
    options: { getSubcommand: () => sub },
    isChatInputCommand: () => true,
    reply: async payload => { replies.push(payload); },
  };
  await interactionCreate.execute(interaction, client);
  return { ran: client.ran, replies };
}

describe('checkFeature', () => {
  it('allows everything when nothing is stored', () => {
    assert.deepEqual(checkFeature('fg-default', 'wavelength', textChannel(LOBBY)), {
      allowed: true, code: null, reason: null, channelIds: null,
    });
    assert.equal(isFeatureEnabled('fg-default', 'birthday'), true);
  });

  it('treats an empty channel list as all channels', () => {
    settingsRepo.setFeature('fg-empty', 'wavelength', true, []);
    assert.equal(checkFeature('fg-empty', 'wavelength', textChannel(LOBBY)).allowed, true);
  });

  it('reports a disabled feature', () => {
    settingsRepo.setFeature('fg-off', 'wavelength', false);
    const result = checkFeature('fg-off', 'wavelength', textChannel(LOBBY), { label: 'Wavelength' });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'disabled');
    assert.equal(result.reason, '🚫 **Wavelength** is turned off on this server.');
  });

  it('counts a thread as its parent channel, but not a channel as its category', () => {
    settingsRepo.setFeature('fg-thread', 'wavelength', true, [GAMES_CHANNEL]);
    assert.equal(checkFeature('fg-thread', 'wavelength', threadIn(GAMES_CHANNEL)).allowed, true);
    assert.equal(checkFeature('fg-thread', 'wavelength', threadIn(OTHER_CHANNEL)).allowed, false);
    assert.equal(checkFeature('fg-thread', 'wavelength', GAMES_CHANNEL).allowed, true);

    settingsRepo.setFeature('fg-category', 'wavelength', true, ['category-1']);
    assert.equal(checkFeature('fg-category', 'wavelength', textChannel(LOBBY)).allowed, false);
  });
});

describe('game commands', () => {
  it('start every game by default', async () => {
    for (const game of getGames()) {
      const name = game.command.data.name;
      const { ran, replies } = await run(name, 'start', { guildId: 'g-default' });
      assert.deepEqual(ran, [`${name} start`]);
      assert.deepEqual(replies, []);
    }
  });

  it('cannot be started when the game is turned off', async () => {
    settingsRepo.setFeature('g-off', 'werewords', false);
    const { ran, replies } = await run('werewords', 'start', { guildId: 'g-off' });
    assert.deepEqual(ran, []);
    assert.deepEqual(replies, [{
      content: '🚫 **Werewords** is turned off on this server.',
      flags: MessageFlags.Ephemeral,
    }]);
  });

  it('turning one game off leaves the others alone', async () => {
    settingsRepo.setFeature('g-one-off', 'werewords', false);
    const { ran } = await run('wavelength', 'start', { guildId: 'g-one-off' });
    assert.deepEqual(ran, ['wavelength start']);
  });

  it('can still be ended when turned off or channel-restricted', async () => {
    settingsRepo.setFeature('g-end-off', 'werewords', false);
    assert.deepEqual((await run('werewords', 'end', { guildId: 'g-end-off' })).ran, ['werewords end']);

    settingsRepo.setFeature('g-end-channel', 'werewords', true, [GAMES_CHANNEL]);
    const result = await run('werewords', 'end', { guildId: 'g-end-channel', channel: threadIn(OTHER_CHANNEL) });
    assert.deepEqual(result.ran, ['werewords end']);
    assert.deepEqual(result.replies, []);
  });

  it('can only be started in the allowed channels', async () => {
    settingsRepo.setFeature('g-channels', 'wavelength', true, [GAMES_CHANNEL, OTHER_CHANNEL]);

    const blocked = await run('wavelength', 'start', { guildId: 'g-channels', channel: textChannel(LOBBY) });
    assert.deepEqual(blocked.ran, []);
    assert.deepEqual(blocked.replies, [{
      content: `**Wavelength** can only be started in <#${GAMES_CHANNEL}>, <#${OTHER_CHANNEL}>.`,
      flags: MessageFlags.Ephemeral,
    }]);

    const allowed = await run('wavelength', 'start', { guildId: 'g-channels', channel: textChannel(GAMES_CHANNEL) });
    assert.deepEqual(allowed.ran, ['wavelength start']);
    assert.deepEqual(allowed.replies, []);
  });

  it('can be started from a thread inside an allowed channel, or from an allowed thread', async () => {
    settingsRepo.setFeature('g-threads', 'wavelength', true, [GAMES_CHANNEL]);
    const inParent = await run('wavelength', 'start', { guildId: 'g-threads', channel: threadIn(GAMES_CHANNEL) });
    assert.deepEqual(inParent.ran, ['wavelength start']);

    const elsewhere = await run('wavelength', 'start', { guildId: 'g-threads', channel: threadIn(LOBBY) });
    assert.deepEqual(elsewhere.ran, []);

    settingsRepo.setFeature('g-thread-id', 'wavelength', true, ['300000000000000009']);
    const listed = await run('wavelength', 'start', {
      guildId: 'g-thread-id', channel: threadIn(LOBBY, '300000000000000009'),
    });
    assert.deepEqual(listed.ran, ['wavelength start']);
  });

  it('other commands are not gated', async () => {
    settingsRepo.setFeature('g-ping', 'ping', false);
    assert.deepEqual((await run('ping', 'start', { guildId: 'g-ping' })).ran, ['ping start']);
  });
});

describe('/birthday', () => {
  const MEMBER_SUBCOMMANDS = ['set', 'list', 'delete'];
  const ADMIN_SUBCOMMANDS = ['start', 'stop', 'setchannel', 'settime', 'resend'];

  it('works everywhere by default', async () => {
    for (const sub of MEMBER_SUBCOMMANDS) {
      assert.deepEqual((await run('birthday', sub, { guildId: 'b-default' })).ran, [`birthday ${sub}`]);
    }
    for (const sub of ADMIN_SUBCOMMANDS) {
      assert.deepEqual((await run('birthday-admin', sub, { guildId: 'b-default' })).ran, [`birthday-admin ${sub}`]);
    }
  });

  it('blocks the member subcommands when birthdays are turned off', async () => {
    settingsRepo.setFeature('b-off', 'birthday', false);
    for (const sub of MEMBER_SUBCOMMANDS) {
      const { ran, replies } = await run('birthday', sub, { guildId: 'b-off' });
      assert.deepEqual(ran, []);
      assert.deepEqual(replies, [{
        content: '🚫 **Birthdays** are turned off on this server.',
        flags: MessageFlags.Ephemeral,
      }]);
    }
  });

  it('restricts the member subcommands to the allowed channels', async () => {
    settingsRepo.setFeature('b-channels', 'birthday', true, [GAMES_CHANNEL]);
    for (const sub of MEMBER_SUBCOMMANDS) {
      const blocked = await run('birthday', sub, { guildId: 'b-channels', channel: textChannel(LOBBY) });
      assert.deepEqual(blocked.ran, []);
      assert.deepEqual(blocked.replies, [{
        content: `**Birthdays** can only be used in <#${GAMES_CHANNEL}>.`,
        flags: MessageFlags.Ephemeral,
      }]);

      const allowed = await run('birthday', sub, { guildId: 'b-channels', channel: threadIn(GAMES_CHANNEL) });
      assert.deepEqual(allowed.ran, [`birthday ${sub}`]);
    }
  });

  it('keeps /birthday-admin working when turned off or restricted', async () => {
    settingsRepo.setFeature('b-admin-off', 'birthday', false);
    settingsRepo.setFeature('b-admin-channels', 'birthday', true, [GAMES_CHANNEL]);
    for (const guildId of ['b-admin-off', 'b-admin-channels']) {
      for (const sub of ADMIN_SUBCOMMANDS) {
        const { ran, replies } = await run('birthday-admin', sub, { guildId });
        assert.deepEqual(ran, [`birthday-admin ${sub}`]);
        assert.deepEqual(replies, []);
      }
    }
  });
});

describe('daily birthday announcements', () => {
  const ANNOUNCE_CHANNEL = '400000000000000001';

  /** A guild with announcements on and one member whose birthday is today. */
  function guildWithBirthdayToday(guildId) {
    const now = new Date();
    birthdayRepo.setEnabled(guildId, true, ANNOUNCE_CHANNEL);
    birthdayRepo.setBirthday(guildId, 'user-1', now.getUTCDate(), now.getUTCMonth() + 1, null);
    return { id: guildId, members: { fetch: async id => ({ id }) } };
  }

  async function announce(guilds) {
    const sent = [];
    const manager = new BirthdayManager();
    manager._client = {
      guilds: { cache: new Map(guilds.map(guild => [guild.id, guild])) },
      channels: { cache: new Map([[ANNOUNCE_CHANNEL, { send: async text => { sent.push(text); } }]]) },
    };
    await manager._runAnnouncements();
    return { sent, manager };
  }

  it('are sent when the dashboard has no birthday setting', async () => {
    const { sent } = await announce([guildWithBirthdayToday('a-default')]);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /<@user-1>/);
  });

  it('skip guilds where birthdays are turned off, but an admin resend still works', async () => {
    settingsRepo.setFeature('a-off', 'birthday', false);
    const guild = guildWithBirthdayToday('a-off');
    const { sent, manager } = await announce([guild]);
    assert.deepEqual(sent, []);

    const result = await manager.runForGuild(guild);
    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
  });

  it('ignore the channel restriction, which is for commands', async () => {
    settingsRepo.setFeature('a-channels', 'birthday', true, [GAMES_CHANNEL]);
    const { sent } = await announce([guildWithBirthdayToday('a-channels')]);
    assert.equal(sent.length, 1);
  });
});
