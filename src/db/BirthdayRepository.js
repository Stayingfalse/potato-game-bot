'use strict';

/**
 * Birthday data access layer.
 * All birthday records are scoped per guild so multiple servers can coexist.
 */

const db = require('./database');

// ── Schema upgrades ────────────────────────────────────────────────────────────

/** The announcement time used when a server never chose one: midnight UTC. */
const DEFAULT_ANNOUNCE_HOUR = 0;
const DEFAULT_TIMEZONE      = 'UTC';

// Columns added after birthday_settings was first created (src/db/database.js).
// Existing rows get the defaults, so those servers keep announcing at midnight UTC.
{
  const existing = new Set(db.prepare('PRAGMA table_info(birthday_settings)').all().map(col => col.name));
  for (const [column, definition] of [
    ['announce_hour', `announce_hour INTEGER NOT NULL DEFAULT ${DEFAULT_ANNOUNCE_HOUR}`],
    ['timezone',      `timezone TEXT NOT NULL DEFAULT '${DEFAULT_TIMEZONE}'`],
  ]) {
    if (!existing.has(column)) db.exec(`ALTER TABLE birthday_settings ADD COLUMN ${definition}`);
  }
}

/** Every IANA time zone this Node knows, keyed by lower-case name. */
const KNOWN_TIME_ZONES = new Map(
  [DEFAULT_TIMEZONE, ...(Intl.supportedValuesOf?.('timeZone') ?? [])].map(tz => [tz.toLowerCase(), tz]),
);

/**
 * A valid IANA time zone name, properly cased (e.g. 'america/new_york' → 'America/New_York'),
 * or null if Intl.DateTimeFormat doesn't accept it.
 * @param {string} timeZone
 * @returns {string|null}
 */
function normalizeTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return null;
  const tz = timeZone.trim();
  let resolved;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  const known = KNOWN_TIME_ZONES.get(tz.toLowerCase());
  if (known) return known;
  // Valid but not in the list (an alias such as Asia/Kolkata on an older ICU): keep the
  // name as given, unless it only differs from the resolved one by case.
  return resolved.toLowerCase() === tz.toLowerCase() ? resolved : tz;
}

/** True for an integer hour 0–23. */
function isValidHour(hour) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

// ── Prepared statements ────────────────────────────────────────────────────────

const stmtSet = db.prepare(`
  INSERT INTO birthdays (guild_id, user_id, birth_day, birth_month, birth_year)
  VALUES (@guild_id, @user_id, @birth_day, @birth_month, @birth_year)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    birth_day   = excluded.birth_day,
    birth_month = excluded.birth_month,
    birth_year  = excluded.birth_year
`);

const stmtGet = db.prepare(`
  SELECT birth_day, birth_month, birth_year
  FROM birthdays
  WHERE guild_id = ? AND user_id = ?
`);

const stmtDelete = db.prepare(`
  DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?
`);

const stmtTodaysBirthdays = db.prepare(`
  SELECT user_id FROM birthdays
  WHERE guild_id = ? AND birth_day = ? AND birth_month = ?
`);

const stmtUpcoming = db.prepare(`
  SELECT user_id, birth_day, birth_month FROM birthdays
  WHERE guild_id = ?
`);

const stmtWasAnnounced = db.prepare(`
  SELECT 1 FROM birthday_announcements
  WHERE guild_id = ? AND user_id = ? AND announced_on = ?
`);

const stmtMarkAnnounced = db.prepare(`
  INSERT OR IGNORE INTO birthday_announcements (guild_id, user_id, announced_on)
  VALUES (?, ?, ?)
`);

const stmtPruneAnnouncements = db.prepare(`
  DELETE FROM birthday_announcements WHERE announced_on < ?
`);

const stmtClearTodayAnnouncements = db.prepare(`
  DELETE FROM birthday_announcements WHERE guild_id = ? AND announced_on = ?
`);

const stmtGetSettings = db.prepare(`
  SELECT channel_id, enabled, announce_hour, timezone FROM birthday_settings WHERE guild_id = ?
`);

const stmtUpsertSettings = db.prepare(`
  INSERT INTO birthday_settings (guild_id, channel_id, enabled)
  VALUES (@guild_id, @channel_id, @enabled)
  ON CONFLICT(guild_id) DO UPDATE SET
    channel_id = COALESCE(excluded.channel_id, channel_id),
    enabled    = excluded.enabled
`);

const stmtSetChannel = db.prepare(`
  INSERT INTO birthday_settings (guild_id, channel_id, enabled)
  VALUES (@guild_id, @channel_id, 0)
  ON CONFLICT(guild_id) DO UPDATE SET
    channel_id = excluded.channel_id
`);

const stmtSetAnnounceTime = db.prepare(`
  INSERT INTO birthday_settings (guild_id, channel_id, enabled, announce_hour, timezone)
  VALUES (@guild_id, NULL, 0, @announce_hour, @timezone)
  ON CONFLICT(guild_id) DO UPDATE SET
    announce_hour = excluded.announce_hour,
    timezone      = excluded.timezone
`);

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Store or update a user's birthday for a guild.
 * @param {string} guildId
 * @param {string} userId
 * @param {number} day        1–31
 * @param {number} month      1–12
 * @param {number|null} year  Full year, or null if omitted
 */
function setBirthday(guildId, userId, day, month, year) {
  stmtSet.run({
    guild_id:    guildId,
    user_id:     userId,
    birth_day:   day,
    birth_month: month,
    birth_year:  year ?? null,
  });
}

/**
 * Retrieve a user's birthday.
 * @returns {{ birth_day: number, birth_month: number, birth_year: number|null }|null}
 */
function getBirthday(guildId, userId) {
  return stmtGet.get(guildId, userId) ?? null;
}

/**
 * Remove a user's birthday record.
 * @returns {boolean} true if a record was deleted
 */
function deleteBirthday(guildId, userId) {
  const info = stmtDelete.run(guildId, userId);
  return info.changes > 0;
}

/**
 * Return all user IDs with today's birthday in the given guild.
 * @param {string} guildId
 * @param {number} day
 * @param {number} month
 * @returns {string[]}
 */
function getTodaysBirthdays(guildId, day, month) {
  return stmtTodaysBirthdays.all(guildId, day, month).map(r => r.user_id);
}

/**
 * Return all birthdays in a guild (for upcoming calculation).
 * @param {string} guildId
 * @returns {{ user_id: string, birth_day: number, birth_month: number }[]}
 */
function getAllBirthdays(guildId) {
  return stmtUpcoming.all(guildId);
}

/**
 * Check whether a user has already been announced today.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} dateKey  ISO date string "YYYY-MM-DD"
 */
function wasAnnounced(guildId, userId, dateKey) {
  return !!stmtWasAnnounced.get(guildId, userId, dateKey);
}

/**
 * Record that a user was announced today (idempotent).
 */
function markAnnounced(guildId, userId, dateKey) {
  stmtMarkAnnounced.run(guildId, userId, dateKey);
}

/**
 * Delete old announcement records older than the given ISO date string.
 */
function pruneAnnouncements(beforeDateKey) {
  stmtPruneAnnouncements.run(beforeDateKey);
}

/**
 * Remove all announcement dedup records for a guild on a specific date.
 * This allows those users to be re-announced on the next run.
 * @param {string} guildId
 * @param {string} dateKey  ISO date string "YYYY-MM-DD"
 */
function clearTodayAnnouncements(guildId, dateKey) {
  stmtClearTodayAnnouncements.run(guildId, dateKey);
}

/**
 * Get birthday settings for a guild.
 * @returns {{ channel_id: string|null, enabled: boolean, announce_hour: number, timezone: string }|null}
 */
function getSettings(guildId) {
  const row = stmtGetSettings.get(guildId);
  if (!row) return null;
  return {
    channel_id:    row.channel_id,
    enabled:       !!row.enabled,
    announce_hour: isValidHour(row.announce_hour) ? row.announce_hour : DEFAULT_ANNOUNCE_HOUR,
    timezone:      normalizeTimeZone(row.timezone) ?? DEFAULT_TIMEZONE,
  };
}

/**
 * When a guild's announcements go out: the hour (0–23) in its time zone.
 * Servers that never chose get midnight UTC.
 * @returns {{ hour: number, timezone: string }}
 */
function getAnnounceTime(guildId) {
  const settings = getSettings(guildId);
  return {
    hour:     settings?.announce_hour ?? DEFAULT_ANNOUNCE_HOUR,
    timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
  };
}

/**
 * Set when a guild's announcements go out (does not change enabled state or channel).
 * This is the one place the time is stored; /birthday-admin settime and the
 * dashboard both write it here.
 * @param {string} guildId
 * @param {number} hour      0–23, in `timeZone`
 * @param {string} timeZone  IANA time zone, e.g. 'America/New_York'
 * @returns {{ hour: number, timezone: string }} what was stored (time zone canonicalised)
 */
function setAnnounceTime(guildId, hour, timeZone) {
  if (!isValidHour(hour)) throw new RangeError(`Invalid hour: ${hour}`);
  const timezone = normalizeTimeZone(timeZone);
  if (!timezone) throw new RangeError(`Unknown time zone: ${timeZone}`);
  stmtSetAnnounceTime.run({ guild_id: guildId, announce_hour: hour, timezone });
  return { hour, timezone };
}

/**
 * Enable or disable birthday announcements, optionally setting the channel.
 */
function setEnabled(guildId, enabled, channelId) {
  stmtUpsertSettings.run({
    guild_id:   guildId,
    channel_id: channelId ?? null,
    enabled:    enabled ? 1 : 0,
  });
}

/**
 * Set the announcement channel for a guild (does not change enabled state).
 */
function setChannel(guildId, channelId) {
  stmtSetChannel.run({ guild_id: guildId, channel_id: channelId });
}

module.exports = {
  setBirthday,
  getBirthday,
  deleteBirthday,
  getTodaysBirthdays,
  getAllBirthdays,
  wasAnnounced,
  markAnnounced,
  pruneAnnouncements,
  clearTodayAnnouncements,
  getSettings,
  setEnabled,
  setChannel,
  getAnnounceTime,
  setAnnounceTime,
  normalizeTimeZone,
  isValidHour,
  DEFAULT_ANNOUNCE_HOUR,
  DEFAULT_TIMEZONE,
};
