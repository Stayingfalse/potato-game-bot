'use strict';

/**
 * /birthday-admin — birthday announcement settings, for server managers.
 *
 * Discord only shows this command to members with Manage Server
 * (setDefaultMemberPermissions). Server admins can change that under
 * Server Settings → Integrations, so every handler checks the permission too.
 *
 * Subcommands:
 *   start [channel]          – Enable announcements (optionally set channel).
 *   stop                     – Disable announcements.
 *   setchannel <channel>     – Set/change the announcement channel.
 *   settime <hour> <tz>      – Set the hour (0–23) and time zone announcements go out.
 *   resend                   – Clear today's dedup and re-send today's announcements.
 *
 * Not gated by the dashboard's Birthdays setting (see featureGate.js), so
 * admins can always manage announcements.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  MessageFlags,
} = require('discord.js');

const repo = require('../db/BirthdayRepository');
const { guildToday } = require('../game/BirthdayManager');

/**
 * Time zones offered by `settime` (Discord allows at most 25 choices).
 * The dashboard offers every IANA zone; a zone set there that isn't listed
 * here still works and is shown by `settime`'s reply.
 */
const COMMON_TIME_ZONES = [
  ['UTC', 'UTC'],
  ['London, Dublin, Lisbon', 'Europe/London'],
  ['Paris, Berlin, Madrid, Rome', 'Europe/Paris'],
  ['Athens, Helsinki, Kyiv', 'Europe/Helsinki'],
  ['Moscow, Istanbul', 'Europe/Moscow'],
  ['Johannesburg, Cairo', 'Africa/Johannesburg'],
  ['Dubai', 'Asia/Dubai'],
  ['India (Kolkata)', 'Asia/Kolkata'],
  ['Bangkok, Jakarta', 'Asia/Bangkok'],
  ['Singapore, Manila', 'Asia/Singapore'],
  ['China (Shanghai)', 'Asia/Shanghai'],
  ['Tokyo, Seoul', 'Asia/Tokyo'],
  ['Perth', 'Australia/Perth'],
  ['Sydney, Melbourne', 'Australia/Sydney'],
  ['Auckland', 'Pacific/Auckland'],
  ['Honolulu', 'Pacific/Honolulu'],
  ['Alaska (Anchorage)', 'America/Anchorage'],
  ['US Pacific (Los Angeles)', 'America/Los_Angeles'],
  ['US Mountain (Denver)', 'America/Denver'],
  ['Arizona (Phoenix)', 'America/Phoenix'],
  ['US Central (Chicago)', 'America/Chicago'],
  ['Mexico City', 'America/Mexico_City'],
  ['US Eastern (New York)', 'America/New_York'],
  ['Atlantic (Halifax)', 'America/Halifax'],
  ['Brazil (São Paulo)', 'America/Sao_Paulo'],
].map(([name, value]) => ({ name: `${name} — ${value}`, value }));

const NO_PERMISSION = '❌ You need the **Manage Server** permission to use this command.';

/** True if the invoking member has Manage Server or Administrator. */
function isAdmin(interaction) {
  const permissions = interaction.memberPermissions ?? interaction.member?.permissions;
  return !!(
    permissions?.has(PermissionFlagsBits.ManageGuild) ||
    permissions?.has(PermissionFlagsBits.Administrator)
  );
}

/** "9:00 (America/New_York)" */
function formatTime(hour, timezone) {
  return `**${String(hour).padStart(2, '0')}:00** (${timezone})`;
}

module.exports = {
  COMMON_TIME_ZONES,

  data: new SlashCommandBuilder()
    .setName('birthday-admin')
    .setDescription('Birthday announcement settings (Manage Server)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)

    // /birthday-admin start [channel]
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Enable birthday announcements in this server.')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to send birthday messages (uses existing setting if omitted)'),
        ),
    )

    // /birthday-admin stop
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Disable birthday announcements in this server.'),
    )

    // /birthday-admin setchannel <channel>
    .addSubcommand(sub =>
      sub
        .setName('setchannel')
        .setDescription('Set or change the birthday announcement channel.')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('The channel to use for birthday announcements')
            .setRequired(true),
        ),
    )

    // /birthday-admin settime <hour> <timezone>
    .addSubcommand(sub =>
      sub
        .setName('settime')
        .setDescription('Set what time birthday announcements go out (default midnight UTC).')
        .addIntegerOption(opt =>
          opt
            .setName('hour')
            .setDescription('Hour of the day, 0–23 (e.g. 9 for 9 am)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(23),
        )
        .addStringOption(opt =>
          opt
            .setName('timezone')
            .setDescription('Your server\'s time zone')
            .setRequired(true)
            .addChoices(...COMMON_TIME_ZONES),
        ),
    )

    // /birthday-admin resend
    .addSubcommand(sub =>
      sub
        .setName('resend')
        .setDescription('Re-send today\'s birthday announcements (clears today\'s dedup first).'),
    ),

  // ── Handler ──────────────────────────────────────────────────────────────────

  async execute(interaction) {
    const { guildId } = interaction;
    const sub = interaction.options.getSubcommand();

    if (!guildId) {
      return interaction.reply({ content: '❌ This command only works in a server.', flags: MessageFlags.Ephemeral });
    }
    // Discord hides the command from members without Manage Server, but server
    // admins can override that, so check here too.
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: NO_PERMISSION, flags: MessageFlags.Ephemeral });
    }

    // ── /birthday-admin start ──────────────────────────────────────────────────
    if (sub === 'start') {
      const channelOption = interaction.options.getChannel('channel');
      const settings = repo.getSettings(guildId);
      const channelId = channelOption?.id ?? settings?.channel_id ?? null;

      if (!channelId) {
        return interaction.reply({
          content:
            '❌ No announcement channel is set. Please provide a channel:\n' +
            '`/birthday-admin start channel:#your-channel`\nor set one first with `/birthday-admin setchannel`.',
          flags: MessageFlags.Ephemeral,
        });
      }

      repo.setEnabled(guildId, true, channelId);
      const { hour, timezone } = repo.getAnnounceTime(guildId);

      return interaction.reply({
        content:
          `✅ Birthday announcements **enabled**! Messages will be sent in <#${channelId}> ` +
          `at ${formatTime(hour, timezone)}. Change the time with \`/birthday-admin settime\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /birthday-admin stop ───────────────────────────────────────────────────
    if (sub === 'stop') {
      repo.setEnabled(guildId, false, null);
      return interaction.reply({
        content: '🛑 Birthday announcements **disabled**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /birthday-admin setchannel ─────────────────────────────────────────────
    if (sub === 'setchannel') {
      const channel = interaction.options.getChannel('channel', true);
      repo.setChannel(guildId, channel.id);

      return interaction.reply({
        content: `✅ Birthday announcement channel set to <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /birthday-admin settime ────────────────────────────────────────────────
    if (sub === 'settime') {
      const hour = interaction.options.getInteger('hour', true);
      const zoneInput = interaction.options.getString('timezone', true);

      if (!repo.isValidHour(hour)) {
        return interaction.reply({
          content: '❌ The hour must be a whole number from **0** to **23** (e.g. `9` for 9 am, `18` for 6 pm).',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!repo.normalizeTimeZone(zoneInput)) {
        return interaction.reply({
          content:
            `❌ \`${zoneInput}\` isn't a time zone I know. Pick one from the list, or use an IANA name ` +
            'like `America/New_York` (the dashboard lists them all).',
          flags: MessageFlags.Ephemeral,
        });
      }

      const { timezone } = repo.setAnnounceTime(guildId, hour, zoneInput);
      const settings = repo.getSettings(guildId);
      const note = settings?.enabled
        ? ''
        : '\nℹ️ Announcements are currently off — turn them on with `/birthday-admin start`.';

      return interaction.reply({
        content: `🕘 Birthday announcements will go out at ${formatTime(hour, timezone)} each day.${note}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /birthday-admin resend ─────────────────────────────────────────────────
    if (sub === 'resend') {
      const settings = repo.getSettings(guildId);
      if (!settings || !settings.enabled || !settings.channel_id) {
        return interaction.reply({
          content:
            '❌ Birthday announcements are not enabled in this server. ' +
            'Use `/birthday-admin start` to enable them first.',
          flags: MessageFlags.Ephemeral,
        });
      }

      // Defer because we'll be making Discord API calls (member fetches + sends).
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Wipe today's (server-local date) dedup records so everyone gets re-announced.
      const now = new Date();
      repo.clearTodayAnnouncements(guildId, guildToday(guildId, now).dateKey);

      const result = await interaction.client.birthdayManager.runForGuild(interaction.guild, now);

      if (result.total === 0) {
        return interaction.editReply({ content: 'ℹ️ No birthdays today in this server.' });
      }

      return interaction.editReply({
        content:
          `✅ Sent **${result.sent}** birthday announcement${result.sent === 1 ? '' : 's'}` +
          ` in <#${result.channelId}>.` +
          (result.total > result.sent
            ? ` (${result.total - result.sent} member${result.total - result.sent === 1 ? '' : 's'} not found in server)`
            : ''),
      });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', flags: MessageFlags.Ephemeral });
  },
};
