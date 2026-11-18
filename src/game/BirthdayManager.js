'use strict';

/**
 * BirthdayManager — handles scheduled daily birthday announcements.
 *
 * Each server picks the hour its announcements go out, in its own time zone
 * (/birthday-admin settime or the dashboard; default midnight UTC). "Today"
 * — which birthdays match and the dedup date — is the server's local date.
 *
 * Call `start(client)` once on bot ready.  The manager will:
 *   1. Fire immediately to catch any birthdays already due today.
 *   2. Schedule itself to run at the top of every hour (via a self-adjusting
 *      setTimeout), announcing for each server whose local time has reached
 *      its chosen hour and that hasn't announced today yet.  A server whose
 *      hour passed while the bot was down is caught up on the next run.
 */

const repo = require('../db/BirthdayRepository');
const { isFeatureEnabled, BIRTHDAY_FEATURE_ID } = require('../games/_core/featureGate');

/** Fun birthday messages.  `{mentions}` is replaced with user ping(s). */
const BIRTHDAY_MESSAGES = [
  '🎂 Attention everyone! {mentions} has survived another lap around the sun. Remarkable, really.',
  '🥳 Today in history: {mentions} was unleashed upon the world. We\'re still recovering. Happy birthday!',
  '🎉 Breaking news: {mentions} is officially one year closer to getting senior discounts. Congrats!',
  '🎈 {mentions} is celebrating a birthday today! Scientists are still unsure how they\'ve lasted this long.',
  '🎊 Happy birthday to {mentions}! Your cake has more candles than a medieval cathedral.',
  '🥂 Raise a glass for {mentions}! Another year older, and somehow still here bothering all of us. Love you really.',
  '🎂 {mentions} birthday detected. Deploying congratulations. Please stand by… 🎉',
  '🎁 Today is {mentions}\'s special day! And by special we mean the anniversary of the worst decision their parents ever made. (jk, happy birthday!)',
  '🎈 {mentions} has completed another successful orbit of the Sun. NASA is impressed.',
  '🥳 Fun fact: {mentions} is celebrating a birthday today. Less fun fact: they\'re not getting any younger.',
  '🎉 {mentions} is a year older today! Time flies when you\'re having fun. Or just existing. Either way.',
  '🎊 Happy birthday {mentions}! You\'re not old, you\'re a classic.',
  '🎂 The council has been notified. {mentions} is officially another year older. Prayers welcome.',
  '🥂 Alert! {mentions} has levelled up! +1 to age. No other stats changed.',
  '🎈 Today we celebrate {mentions} and the complete mystery of how they\'ve made it this far. Cheers!',
  '🎁 {mentions}! Your cake is ready. Your dignity? That left years ago. Happy birthday!',
  '🎉 {mentions} is aging like fine wine today. Or milk. Hard to tell. Happy birthday anyway!',
  '🎊 On this day, {mentions} was added to the world server. The admins have been unable to remove them since.',
  '🥳 {mentions} birthday unlocked! Achievement: Still Alive. Reward: Cake.',
  '🎂 Many years ago, {mentions} arrived. No one asked for it, but here we are. Happy birthday!',
  '🎈 Time to sing off-key at {mentions} until they feel sufficiently embarrassed! 🎵 Happy birthday to youuuu 🎵',
  '🥂 {mentions} has entered a new age bracket. Condolences and congratulations in equal measure.',
  '🎉 {mentions} is older today! The exact amount is classified. What we can confirm is: cake.',
  '🎁 The birthday fairy has visited {mentions}. She left cake, confetti, and mild existential dread.',
  '🎊 {mentions}, you\'ve been alive for a genuinely alarming number of days now. We\'re proud of you.',
  '🎂 Happy birthday {mentions}! You\'re not old. You\'re retro.',
  '🥳 {mentions} has downloaded another year of life experience. Please restart to apply updates.',
  '🎈 Scientists confirm that {mentions} is, in fact, older today than they were yesterday. More at 11.',
  '🎉 {mentions} birthday protocol initiated. All crew report to the mess hall for cake immediately.',
  '🎊 Today {mentions} turns another page in the book of life. We\'re not saying which page. That\'s rude.',
];

/** Return a random birthday message with `{mentions}` replaced. */
function randomMessage(mention) {
  const template = BIRTHDAY_MESSAGES[Math.floor(Math.random() * BIRTHDAY_MESSAGES.length)];
  return template.replace('{mentions}', mention);
}

/**
 * ISO date string for a given Date (UTC), e.g. "2025-04-22".
 */
function todayKey(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The wall-clock date and hour of `date` in `timeZone`.
 * An unknown time zone falls back to UTC.
 * @returns {{ year: number, month: number, day: number, hour: number, dateKey: string }}
 *   month is 1-based; dateKey is "YYYY-MM-DD" (the deduplication key).
 */
function localDateTime(date, timeZone = 'UTC') {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return localDateTime(date, 'UTC');
  }
  const get = type => Number(parts.find(p => p.type === type).value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour') % 24;
  const dateKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, dateKey };
}

/**
 * The local date and hour right now for a guild, in its chosen time zone.
 * @param {string} guildId
 * @param {Date} [now]
 */
function guildToday(guildId, now = new Date()) {
  const { hour, timezone } = repo.getAnnounceTime(guildId);
  return { ...localDateTime(now, timezone), announceHour: hour, timezone };
}

/**
 * Compute milliseconds until the next top of the hour (UTC) from `now`.
 * Every IANA zone in use is offset by whole or half/quarter hours; the
 * scheduler compares local hours, so running on each UTC hour is enough.
 */
function msUntilNextHour(now) {
  const next = new Date(now);
  next.setUTCMinutes(60, 0, 0);
  return next.getTime() - now.getTime();
}

class BirthdayManager {
  constructor() {
    this._client = null;
    this._timer  = null;
  }

  /**
   * Start the birthday announcement loop.
   * Safe to call multiple times — restarts the timer cleanly.
   * @param {import('discord.js').Client} client
   */
  start(client) {
    this._client = client;
    this._scheduleNext();
    // Also run immediately so birthdays aren't missed if the bot restarts mid-day.
    this._runAnnouncements().catch(err =>
      console.error('[BirthdayManager] Error in initial announcement run:', err),
    );
  }

  /** Stop the scheduled loop. */
  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** Schedule the next run at the top of the next hour. */
  _scheduleNext() {
    const delay = msUntilNextHour(new Date());
    this._timer = setTimeout(() => {
      this._runAnnouncements().catch(err =>
        console.error('[BirthdayManager] Error during announcement run:', err),
      );
      this._scheduleNext();
    }, delay);
  }

  /**
   * Hourly run: post announcements for every guild whose chosen local hour
   * has been reached today (its local date) and not yet announced.
   * @param {Date} [now]
   */
  async _runAnnouncements(now = new Date()) {
    if (!this._client) return;

    // Prune old dedup records. Keys are guild-local dates, which can be a day
    // either side of UTC, so keep the last 3 UTC days to be safe.
    const pruneBeforeDate = new Date(now);
    pruneBeforeDate.setUTCDate(pruneBeforeDate.getUTCDate() - 3);
    repo.pruneAnnouncements(todayKey(pruneBeforeDate));

    for (const [, guild] of this._client.guilds.cache) {
      // Birthdays switched off in the dashboard: no automatic announcements.
      if (!isFeatureEnabled(guild.id, BIRTHDAY_FEATURE_ID)) continue;
      // Not yet this guild's announcement hour (local time).
      const local = guildToday(guild.id, now);
      if (local.hour < local.announceHour) continue;
      await this.runForGuild(guild, now).catch(err =>
        console.error(`[BirthdayManager] Error processing guild ${guild.id}:`, err),
      );
    }
  }

  /**
   * Send any unannounced birthday messages for a single guild.
   * Respects the existing dedup records — already-announced users are skipped.
   *
   * "Today" is the guild's local date in its chosen time zone.
   *
   * @param {import('discord.js').Guild} guild
   * @param {Date} [now]
   * @returns {Promise<{ sent: number, total: number, channelId: string|null }>}
   */
  async runForGuild(guild, now = new Date()) {
    if (!this._client) return { sent: 0, total: 0, channelId: null };

    const guildId  = guild.id;
    const settings = repo.getSettings(guildId);
    if (!settings || !settings.enabled || !settings.channel_id) {
      return { sent: 0, total: 0, channelId: null };
    }

    const channel = this._client.channels.cache.get(settings.channel_id);
    if (!channel) return { sent: 0, total: 0, channelId: settings.channel_id };

    const { dateKey, day, month } = guildToday(guildId, now); // month is 1-based

    const userIds = repo.getTodaysBirthdays(guildId, day, month);
    let sent = 0;

    for (const userId of userIds) {
      if (repo.wasAnnounced(guildId, userId, dateKey)) continue;

      // Verify the member is still in the guild.
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;

      const message = randomMessage(`<@${userId}>`);
      await channel.send(message).catch(err =>
        console.error(`[BirthdayManager] Failed to send message in guild ${guildId}:`, err),
      );

      repo.markAnnounced(guildId, userId, dateKey);
      sent++;
    }

    return { sent, total: userIds.length, channelId: settings.channel_id };
  }
}

module.exports = BirthdayManager;
module.exports.localDateTime = localDateTime;
module.exports.guildToday = guildToday;
module.exports.msUntilNextHour = msUntilNextHour;
