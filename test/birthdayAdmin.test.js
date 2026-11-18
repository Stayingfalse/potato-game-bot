'use strict';

/** /birthday-admin (hidden from members, checked in the handler) and per-server announcement times. */

const { src } = require('./helpers/env');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { MessageFlags, PermissionFlagsBits, InteractionContextType } = require('discord.js');

// An existing database from before announcement times existed.
const old = new Database(path.join(process.env.DATA_DIR, 'bot.db'));
old.exec(`
  CREATE TABLE birthday_settings (guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER NOT NULL DEFAULT 0);
  INSERT INTO birthday_settings (guild_id, channel_id, enabled) VALUES ('old-guild', '500000000000000001', 1);
`);
old.close();

const repo = src('db/BirthdayRepository');
const settingsRepo = src('dashboard/SettingsRepository');
const BirthdayManager = src('game/BirthdayManager');
const birthdayAdmin = src('commands/birthday-admin');
const birthday = src('commands/birthday');
const DashboardServer = src('dashboard/DashboardServer');
const { getCommandBlockReason } = src('games/_core/featureGate');
const { loadCommands } = src('utils/loadCommands');

const ANNOUNCE_CHANNEL = '400000000000000001';

/** Permissions as discord.js exposes them: `has(flag)`. */
const perms = (...flags) => ({ has: flag => flags.includes(flag) });

/** A /birthday-admin interaction that records its replies. */
function adminInteraction(sub, { guildId = 'g-admin', options = {}, permissions = perms(PermissionFlagsBits.ManageGuild), client = {} } = {}) {
  const replies = [];
  return {
    commandName: 'birthday-admin',
    guildId,
    guild: { id: guildId },
    client,
    user: { id: 'u-1', username: 'u' },
    memberPermissions: permissions,
    member: { permissions },
    options: {
      getSubcommand: () => sub,
      getInteger: name => options[name] ?? null,
      getString: name => options[name] ?? null,
      getChannel: name => options[name] ?? null,
    },
    replies,
    reply: async payload => { replies.push(payload); },
    deferReply: async () => {},
    editReply: async payload => { replies.push(payload); },
  };
}

/** A manager whose client knows the given guilds and records what it sends. */
function managerFor(guilds) {
  const sent = [];
  const manager = new BirthdayManager();
  manager._client = {
    guilds: { cache: new Map(guilds.map(guild => [guild.id, guild])) },
    channels: { cache: new Map([[ANNOUNCE_CHANNEL, { send: async text => { sent.push(text); } }]]) },
  };
  return { manager, sent };
}

const guild = id => ({ id, members: { fetch: async userId => ({ id: userId }) } });

describe('/birthday-admin', () => {
  it('is loaded and deployed, hidden from members without Manage Server, and server-only', () => {
    assert.ok(loadCommands().includes(birthdayAdmin));
    const json = birthdayAdmin.data.toJSON();
    assert.equal(json.name, 'birthday-admin');
    assert.equal(json.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
    assert.deepEqual(json.contexts, [InteractionContextType.Guild]);
    assert.deepEqual(json.options.map(o => o.name), ['start', 'stop', 'setchannel', 'settime', 'resend']);
  });

  it('took the admin subcommands out of /birthday', () => {
    assert.deepEqual(birthday.data.toJSON().options.map(o => o.name), ['set', 'list', 'delete']);
    assert.equal(birthday.data.toJSON().default_member_permissions, undefined);
  });

  it('offers valid time zones for settime', () => {
    const settime = birthdayAdmin.data.toJSON().options.find(o => o.name === 'settime');
    const [hour, timezone] = settime.options;
    assert.deepEqual([hour.min_value, hour.max_value], [0, 23]);
    assert.ok(timezone.choices.length <= 25);
    for (const { value } of timezone.choices) assert.equal(repo.normalizeTimeZone(value), value);
  });

  it('refuses members without Manage Server in the handler, whatever Discord shows them', async () => {
    for (const sub of ['start', 'stop', 'setchannel', 'settime', 'resend']) {
      const interaction = adminInteraction(sub, {
        guildId: 'g-member',
        permissions: perms(),
        options: { channel: { id: ANNOUNCE_CHANNEL }, hour: 9, timezone: 'UTC' },
      });
      await birthdayAdmin.execute(interaction);
      assert.deepEqual(interaction.replies, [{
        content: '❌ You need the **Manage Server** permission to use this command.',
        flags: MessageFlags.Ephemeral,
      }], sub);
    }
    assert.equal(repo.getSettings('g-member'), null);
  });

  it('lets Administrators in too', async () => {
    const interaction = adminInteraction('setchannel', {
      guildId: 'g-administrator',
      permissions: perms(PermissionFlagsBits.Administrator),
      options: { channel: { id: ANNOUNCE_CHANNEL } },
    });
    await birthdayAdmin.execute(interaction);
    assert.equal(repo.getSettings('g-administrator').channel_id, ANNOUNCE_CHANNEL);
  });

  it('settime stores the hour and time zone', async () => {
    const interaction = adminInteraction('settime', { guildId: 'g-settime', options: { hour: 9, timezone: 'America/New_York' } });
    await birthdayAdmin.execute(interaction);
    assert.deepEqual(repo.getAnnounceTime('g-settime'), { hour: 9, timezone: 'America/New_York' });
    assert.match(interaction.replies[0].content, /\*\*09:00\*\* \(America\/New_York\)/);
    assert.match(interaction.replies[0].content, /currently off/);
  });

  it('settime rejects a bad hour or time zone and keeps the old setting', async () => {
    repo.setAnnounceTime('g-bad', 6, 'Europe/London');
    for (const options of [{ hour: 24, timezone: 'UTC' }, { hour: -1, timezone: 'UTC' }, { hour: 9, timezone: 'Mars/Olympus_Mons' }]) {
      const interaction = adminInteraction('settime', { guildId: 'g-bad', options });
      await birthdayAdmin.execute(interaction);
      assert.match(interaction.replies[0].content, /^❌/, JSON.stringify(options));
      assert.equal(interaction.replies[0].flags, MessageFlags.Ephemeral);
    }
    assert.deepEqual(repo.getAnnounceTime('g-bad'), { hour: 6, timezone: 'Europe/London' });
    assert.throws(() => repo.setAnnounceTime('g-bad', 9, 'Nowhere/Land'), RangeError);
    assert.throws(() => repo.setAnnounceTime('g-bad', 1.5, 'UTC'), RangeError);
  });

  it('settime keeps the channel and on/off state', async () => {
    repo.setEnabled('g-keep', true, ANNOUNCE_CHANNEL);
    await birthdayAdmin.execute(adminInteraction('settime', { guildId: 'g-keep', options: { hour: 18, timezone: 'asia/tokyo' } }));
    assert.deepEqual(repo.getSettings('g-keep'), {
      channel_id: ANNOUNCE_CHANNEL, enabled: true, announce_hour: 18, timezone: 'Asia/Tokyo',
    });
  });

  it('is never blocked by the dashboard Birthdays setting', () => {
    settingsRepo.setFeature('g-gate-off', 'birthday', false);
    settingsRepo.setFeature('g-gate-channels', 'birthday', true, ['200000000000000002']);
    for (const guildId of ['g-gate-off', 'g-gate-channels']) {
      for (const sub of ['start', 'stop', 'setchannel', 'settime', 'resend']) {
        const reason = getCommandBlockReason({
          guildId, commandName: 'birthday-admin', channelId: '200000000000000009',
          options: { getSubcommand: () => sub },
        });
        assert.equal(reason, null, `${guildId} ${sub}`);
      }
    }
    // /birthday itself is still gated.
    assert.ok(getCommandBlockReason({ guildId: 'g-gate-off', commandName: 'birthday', options: { getSubcommand: () => 'set' } }));
  });
});

describe('announcement time', () => {
  it('existing servers are upgraded to midnight UTC', () => {
    assert.deepEqual(repo.getSettings('old-guild'), {
      channel_id: '500000000000000001', enabled: true, announce_hour: 0, timezone: 'UTC',
    });
    assert.deepEqual(repo.getAnnounceTime('never-configured'), { hour: 0, timezone: 'UTC' });
  });

  it('existing servers still announce at midnight UTC on the UTC date', async () => {
    repo.setEnabled('utc-guild', true, ANNOUNCE_CHANNEL);
    repo.setBirthday('utc-guild', 'u-utc', 15, 3, null);
    const { manager, sent } = managerFor([guild('utc-guild')]);

    await manager._runAnnouncements(new Date('2026-03-14T23:00:00Z'));
    assert.equal(sent.length, 0);
    await manager._runAnnouncements(new Date('2026-03-15T00:00:00Z'));
    assert.equal(sent.length, 1);
    assert.ok(repo.wasAnnounced('utc-guild', 'u-utc', '2026-03-15'));
  });

  it('announces at the guild\'s local hour, once per local day', async () => {
    // 09:00 in Berlin (UTC+1 in January) is 08:00 UTC.
    repo.setEnabled('berlin', true, ANNOUNCE_CHANNEL);
    repo.setAnnounceTime('berlin', 9, 'Europe/Berlin');
    repo.setBirthday('berlin', 'u-berlin', 20, 1, 1990);
    const { manager, sent } = managerFor([guild('berlin')]);

    await manager._runAnnouncements(new Date('2026-01-20T00:00:00Z')); // 01:00 local
    await manager._runAnnouncements(new Date('2026-01-20T07:00:00Z')); // 08:00 local
    assert.equal(sent.length, 0);

    await manager._runAnnouncements(new Date('2026-01-20T08:00:00Z')); // 09:00 local
    assert.equal(sent.length, 1);
    assert.match(sent[0], /<@u-berlin>/);

    // Later runs the same local day (and a restart's immediate run) don't repeat it.
    await manager._runAnnouncements(new Date('2026-01-20T09:00:00Z'));
    await manager._runAnnouncements(new Date('2026-01-20T22:00:00Z'));
    assert.equal(sent.length, 1);

    // Next day: no birthday, nothing sent.
    await manager._runAnnouncements(new Date('2026-01-21T08:00:00Z'));
    assert.equal(sent.length, 1);
  });

  it('uses the local date where it differs from UTC (west of UTC)', async () => {
    // New York, 21:00 on 1 July local = 01:00 UTC on 2 July.
    repo.setEnabled('nyc', true, ANNOUNCE_CHANNEL);
    repo.setAnnounceTime('nyc', 21, 'America/New_York');
    repo.setBirthday('nyc', 'u-july-1', 1, 7, null);
    repo.setBirthday('nyc', 'u-july-2', 2, 7, null);
    const { manager, sent } = managerFor([guild('nyc')]);

    await manager._runAnnouncements(new Date('2026-07-02T01:00:00Z'));
    assert.equal(sent.length, 1);
    assert.match(sent[0], /<@u-july-1>/);
    assert.ok(repo.wasAnnounced('nyc', 'u-july-1', '2026-07-01'));
    assert.ok(!repo.wasAnnounced('nyc', 'u-july-1', '2026-07-02'));

    await manager._runAnnouncements(new Date('2026-07-02T03:00:00Z')); // 23:00 local, same day
    assert.equal(sent.length, 1);
  });

  it('uses the local date where it differs from UTC (east of UTC)', async () => {
    // Auckland (UTC+13 in December): 08:00 on 25 Dec local = 19:00 UTC on 24 Dec.
    repo.setEnabled('akl', true, ANNOUNCE_CHANNEL);
    repo.setAnnounceTime('akl', 8, 'Pacific/Auckland');
    repo.setBirthday('akl', 'u-xmas', 25, 12, null);
    const { manager, sent } = managerFor([guild('akl')]);

    await manager._runAnnouncements(new Date('2026-12-24T18:00:00Z')); // 07:00 local
    assert.equal(sent.length, 0);
    await manager._runAnnouncements(new Date('2026-12-24T19:00:00Z')); // 08:00 local
    assert.equal(sent.length, 1);
    assert.ok(repo.wasAnnounced('akl', 'u-xmas', '2026-12-25'));
  });

  it('catches up a missed hour later the same local day', async () => {
    repo.setEnabled('late', true, ANNOUNCE_CHANNEL);
    repo.setAnnounceTime('late', 9, 'UTC');
    repo.setBirthday('late', 'u-late', 3, 3, null);
    const { manager, sent } = managerFor([guild('late')]);
    await manager._runAnnouncements(new Date('2026-03-03T14:00:00Z'));
    assert.equal(sent.length, 1);
  });

  it('resend clears and re-sends the guild-local day', async () => {
    const now = new Date();
    const local = BirthdayManager.localDateTime(now, 'Pacific/Kiritimati'); // UTC+14
    repo.setEnabled('resend', true, ANNOUNCE_CHANNEL);
    repo.setAnnounceTime('resend', 0, 'Pacific/Kiritimati');
    repo.setBirthday('resend', 'u-resend', local.day, local.month, null);
    repo.markAnnounced('resend', 'u-resend', local.dateKey);

    const { manager, sent } = managerFor([guild('resend')]);
    const interaction = adminInteraction('resend', { guildId: 'resend', client: { birthdayManager: manager } });
    interaction.guild = guild('resend');
    await birthdayAdmin.execute(interaction);
    assert.equal(sent.length, 1);
    assert.match(interaction.replies.at(-1).content, /Sent \*\*1\*\* birthday announcement/);
  });

  it('localDateTime reads the wall clock in a time zone', () => {
    const at = new Date('2026-07-02T01:30:00Z');
    assert.deepEqual(BirthdayManager.localDateTime(at, 'America/Los_Angeles'),
      { year: 2026, month: 7, day: 1, hour: 18, dateKey: '2026-07-01' });
    assert.deepEqual(BirthdayManager.localDateTime(at, 'Not/AZone'), BirthdayManager.localDateTime(at, 'UTC'));
    assert.equal(BirthdayManager.msUntilNextHour(new Date('2026-07-02T01:30:00Z')), 30 * 60 * 1000);
  });
});

describe('dashboard Birthdays card', () => {
  // Skip the constructor (it starts a session-pruning interval).
  const server = Object.create(DashboardServer.prototype);

  it('shows the time stored by /birthday-admin settime', () => {
    repo.setAnnounceTime('dash', 7, 'Asia/Tokyo');
    const features = server._withBirthdayTime('dash', server._mergeDefaults(settingsRepo.getGuildSettings('dash')));
    assert.deepEqual(features.birthday.extra, { announceHour: 7, timezone: 'Asia/Tokyo' });
  });

  it('saves the time to the same setting and keeps it out of the feature extra', () => {
    const rest = server._saveBirthdayTime('dash', { announceHour: 20, timezone: 'Europe/Paris' });
    assert.equal(rest, null);
    assert.deepEqual(repo.getAnnounceTime('dash'), { hour: 20, timezone: 'Europe/Paris' });
  });

  it('rejects an invalid hour or time zone with a 400', () => {
    for (const extra of [{ announceHour: 24, timezone: 'UTC' }, { announceHour: 3, timezone: 'Bad/Zone' }]) {
      assert.throws(() => server._saveBirthdayTime('dash', extra), err => err.status === 400);
    }
    assert.deepEqual(repo.getAnnounceTime('dash'), { hour: 20, timezone: 'Europe/Paris' });
  });

  it('offers every hour and UTC first in the time zone list', async () => {
    const res = { writeHead() {}, end(body) { this.body = body; } };
    await server._route('GET', '/dashboard/api/features', null, null, res);
    const card = JSON.parse(res.body).find(f => f.id === 'birthday');
    const [hour, timezone] = card.extraFields;
    assert.deepEqual(hour.options.map(o => o.value), [...Array(24).keys()]);
    assert.equal(timezone.options[0].value, 'UTC');
    assert.ok(timezone.options.some(o => o.value === 'America/New_York'));
  });
});
