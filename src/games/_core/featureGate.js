'use strict';

const { MessageFlags } = require('discord.js');
const settingsRepo = require('../../dashboard/SettingsRepository');
const { getGames } = require('./registry');

/**
 * Enforces the dashboard's per-server feature settings (the Enabled toggle and
 * the "Restrict to channels" list) for games and birthdays.
 *
 * A feature with no stored setting is enabled in every channel, matching the
 * defaults the dashboard shows (DashboardServer._mergeDefaults).
 */

const BIRTHDAY_FEATURE_ID = 'birthday';

/** /birthday subcommands that stay available to admins whatever the dashboard says. */
const BIRTHDAY_ADMIN_SUBCOMMANDS = new Set(['start', 'stop', 'setchannel', 'resend']);

/**
 * The stored dashboard setting for one feature, with defaults applied.
 * @returns {{ enabled: boolean, channelIds: string[]|null }} channelIds null = all channels
 */
function getFeatureSetting(guildId, featureId) {
  let row = null;
  try {
    row = settingsRepo.getGuildSettings(guildId)?.[featureId] ?? null;
  } catch (err) {
    // Never lock people out of the bot because a settings read failed.
    console.error('[FeatureGate] Failed to load guild settings:', err.message);
  }
  const channelIds = Array.isArray(row?.channelIds) && row.channelIds.length > 0
    ? row.channelIds.map(id => String(id))
    : null;
  return { enabled: row ? row.enabled === true : true, channelIds };
}

/** True unless the feature has been switched off in the dashboard for this guild. */
function isFeatureEnabled(guildId, featureId) {
  if (!guildId) return true;
  return getFeatureSetting(guildId, featureId).enabled;
}

/** The ids a channel counts as: its own, plus its parent channel's when it is a thread. */
function channelIdsOf(channel) {
  if (!channel) return [];
  const ids = [channel.id];
  if (channel.isThread?.() && channel.parentId) ids.push(channel.parentId);
  return ids.filter(Boolean).map(id => String(id));
}

/**
 * Whether a feature may be used in a channel of a guild.
 *
 * @param {string|null} guildId
 * @param {string} featureId   a game's id, or 'birthday'
 * @param {object|string|null} channel  the channel (or just its id) the command was run in
 * @param {object} [wording]
 * @param {string} [wording.label]  display name used in the reason, e.g. 'Wavelength'
 * @param {string} [wording.off]    replaces "is turned off", e.g. 'are turned off'
 * @param {string} [wording.action] replaces "started", e.g. 'used'
 * @returns {{ allowed: boolean, code: 'disabled'|'channel'|null, reason: string|null, channelIds: string[]|null }}
 *   `reason` is a message that can be shown to the user as is.
 */
function checkFeature(guildId, featureId, channel, { label = featureId, off = 'is turned off', action = 'started' } = {}) {
  const allowed = { allowed: true, code: null, reason: null, channelIds: null };
  if (!guildId) return allowed;

  const { enabled, channelIds } = getFeatureSetting(guildId, featureId);
  if (!enabled) {
    return { allowed: false, code: 'disabled', reason: `🚫 **${label}** ${off} on this server.`, channelIds };
  }
  if (!channelIds) return allowed;

  const here = typeof channel === 'string' ? [channel] : channelIdsOf(channel);
  if (here.some(id => channelIds.includes(id))) return { ...allowed, channelIds };

  const mentions = channelIds.map(id => `<#${id}>`).join(', ');
  return { allowed: false, code: 'channel', reason: `**${label}** can only be ${action} in ${mentions}.`, channelIds };
}

/**
 * The gate for a slash command interaction: null when the command may run,
 * otherwise the message to show the user instead.
 *
 * - Game commands: only `start` is gated, so games in progress can always be
 *   played out and ended.
 * - /birthday: the member-facing subcommands are gated; the admin ones are not.
 */
function getCommandBlockReason(interaction) {
  const { guildId, commandName } = interaction;
  if (!guildId) return null;

  const channel = interaction.channel ?? interaction.channelId ?? null;
  const sub = interaction.options?.getSubcommand?.(false) ?? null;

  if (commandName === 'birthday') {
    if (BIRTHDAY_ADMIN_SUBCOMMANDS.has(sub)) return null;
    return checkFeature(guildId, BIRTHDAY_FEATURE_ID, channel, {
      label: 'Birthdays', off: 'are turned off', action: 'used',
    }).reason;
  }

  if (sub !== 'start') return null;
  const game = getGames().find(g => g.command?.data?.name === commandName);
  if (!game) return null;
  return checkFeature(guildId, game.id, channel, { label: game.name }).reason;
}

/**
 * Replies (ephemerally) with the block reason if the slash command is gated.
 * @returns {Promise<boolean>} true when the command was blocked and must not run
 */
async function blockIfGated(interaction) {
  const reason = getCommandBlockReason(interaction);
  if (!reason) return false;
  await interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
  return true;
}

module.exports = {
  BIRTHDAY_FEATURE_ID,
  BIRTHDAY_ADMIN_SUBCOMMANDS,
  getFeatureSetting,
  isFeatureEnabled,
  checkFeature,
  getCommandBlockReason,
  blockIfGated,
};
