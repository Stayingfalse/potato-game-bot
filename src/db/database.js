'use strict';

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../../data/bot.db');

// Ensure the data directory exists (needed for local dev without Docker volume).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode for better concurrent read performance.
db.pragma('journal_mode = WAL');

// ── Schema ─────────────────────────────────────────────────────────────────────

db.exec(`
  -- werewords_games is created by src/games/werewords/repository.js.
  -- wavelength_games is created by src/games/wavelength/repository.js.
  -- nmj_games is created by src/games/nmj/repository.js.
  -- cheese_thief_games and herd_mentality_games may still exist in older databases;
  -- those games were removed and nothing reads the tables any more.

  CREATE TABLE IF NOT EXISTS werewords_player_stats (
    guild_id                  TEXT NOT NULL,
    user_id                   TEXT NOT NULL,
    username                  TEXT NOT NULL,
    games_played              INTEGER NOT NULL DEFAULT 0,
    wins                      INTEGER NOT NULL DEFAULT 0,
    losses                    INTEGER NOT NULL DEFAULT 0,
    role_wordsmith            INTEGER NOT NULL DEFAULT 0,
    role_demon                INTEGER NOT NULL DEFAULT 0,
    role_librarian            INTEGER NOT NULL DEFAULT 0,
    role_townsfolk            INTEGER NOT NULL DEFAULT 0,
    correct_guesses           INTEGER NOT NULL DEFAULT 0,
    times_identified_as_seer  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS wavelength_player_stats (
    guild_id           TEXT NOT NULL,
    user_id            TEXT NOT NULL,
    username           TEXT NOT NULL,
    rounds_played      INTEGER NOT NULL DEFAULT 0,
    rounds_as_clue_giver INTEGER NOT NULL DEFAULT 0,
    total_score        INTEGER NOT NULL DEFAULT 0,
    bullseyes          INTEGER NOT NULL DEFAULT 0,
    synergy_bonuses    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS birthdays (
    guild_id     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    birth_day    INTEGER NOT NULL,
    birth_month  INTEGER NOT NULL,
    birth_year   INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS birthday_announcements (
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    announced_on  TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, announced_on)
  );

  CREATE TABLE IF NOT EXISTS birthday_settings (
    guild_id    TEXT PRIMARY KEY,
    channel_id  TEXT,
    enabled     INTEGER NOT NULL DEFAULT 0
  );

  -- ── SassyBot / MCP context tables ───────────────────────────────────────────

  -- Per-user profile: message count, last seen, AI-generated topic notes.
  CREATE TABLE IF NOT EXISTS sassy_user_profiles (
    guild_id       TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    username       TEXT NOT NULL,
    last_seen      INTEGER NOT NULL DEFAULT 0,
    message_count  INTEGER NOT NULL DEFAULT 0,
    topic_notes    TEXT,
    PRIMARY KEY (guild_id, user_id)
  );

  -- Rolling conversation log per channel (pruned periodically).
  CREATE TABLE IF NOT EXISTS sassy_conversation_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id   TEXT NOT NULL,
    guild_id     TEXT,
    user_id      TEXT NOT NULL,
    username     TEXT NOT NULL,
    content      TEXT NOT NULL,
    timestamp    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sassy_conv_ch_ts
    ON sassy_conversation_log(channel_id, timestamp DESC);

  -- Persisted Gemini/OpenAI chat history per channel so context survives restarts.
  CREATE TABLE IF NOT EXISTS sassy_chat_history (
    channel_id  TEXT PRIMARY KEY,
    history     TEXT NOT NULL DEFAULT '[]',
    updated_at  INTEGER NOT NULL DEFAULT 0
  );

  -- Per-channel profile: AI-generated topic notes summarising what the channel discusses.
  CREATE TABLE IF NOT EXISTS sassy_channel_profiles (
    channel_id   TEXT PRIMARY KEY,
    guild_id     TEXT,
    topic_notes  TEXT,
    updated_at   INTEGER NOT NULL DEFAULT 0
  );

  -- ── Admin dashboard: per-guild feature settings ──────────────────────────────

  -- One row per guild+feature combination.  channel_ids is a JSON array of
  -- allowed Discord channel IDs (NULL means "all channels").  extra is a JSON
  -- blob for any feature-specific configuration.
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id     TEXT NOT NULL,
    feature      TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    channel_ids  TEXT,
    extra        TEXT,
    updated_at   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, feature)
  );
`);

// ── One-time migration: stats.json → werewords_player_stats ───────────────────

const STATS_JSON = path.join(__dirname, '../../data/stats.json');
const STATS_JSON_MIGRATED = STATS_JSON + '.migrated';

if (fs.existsSync(STATS_JSON) && !fs.existsSync(STATS_JSON_MIGRATED)) {
  try {
    const raw = JSON.parse(fs.readFileSync(STATS_JSON, 'utf8'));

    const upsert = db.prepare(`
      INSERT INTO werewords_player_stats
        (guild_id, user_id, username, games_played, wins, losses,
         role_wordsmith, role_demon, role_librarian, role_townsfolk,
         correct_guesses, times_identified_as_seer)
      VALUES
        (@guild_id, @user_id, @username, @games_played, @wins, @losses,
         @role_wordsmith, @role_demon, @role_librarian, @role_townsfolk,
         @correct_guesses, @times_identified_as_seer)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        username                 = excluded.username,
        games_played             = excluded.games_played,
        wins                     = excluded.wins,
        losses                   = excluded.losses,
        role_wordsmith           = excluded.role_wordsmith,
        role_demon               = excluded.role_demon,
        role_librarian           = excluded.role_librarian,
        role_townsfolk           = excluded.role_townsfolk,
        correct_guesses          = excluded.correct_guesses,
        times_identified_as_seer = excluded.times_identified_as_seer
    `);

    const migrate = db.transaction(() => {
      for (const [guildId, players] of Object.entries(raw)) {
        for (const [userId, s] of Object.entries(players)) {
          upsert.run({
            guild_id:                  guildId,
            user_id:                   userId,
            username:                  s.username ?? userId,
            games_played:              s.gamesPlayed        ?? 0,
            wins:                      s.wins               ?? 0,
            losses:                    s.losses             ?? 0,
            role_wordsmith:            s.rolesPlayed?.Wordsmith ?? 0,
            role_demon:                s.rolesPlayed?.Demon     ?? 0,
            role_librarian:            s.rolesPlayed?.Librarian ?? 0,
            role_townsfolk:            s.rolesPlayed?.Townsfolk ?? 0,
            correct_guesses:           s.correctGuesses         ?? 0,
            times_identified_as_seer:  s.timesIdentifiedAsSeer  ?? 0,
          });
        }
      }
    });

    migrate();
    fs.renameSync(STATS_JSON, STATS_JSON_MIGRATED);
    console.log('[DB] Migrated stats.json → werewords_player_stats');
  } catch (err) {
    console.error('[DB] stats.json migration failed — skipping:', err.message);
  }
}

// ── One-time migration: yagpdb-birthdays.json → birthdays ─────────────────────
//
// Imports birthday data exported from a YAGPDB custom-command database.
// The JSON file contains { "userId": "ISO-8601-date-string", ... }.
// YAGPDB stores dates as UTC midnight, so we parse each value as a UTC Date
// and extract the UTC day/month/year.
//
// Requires GUILD_ID to be set in the environment (.env).
// Once the migration runs successfully the source file is renamed to
// yagpdb-birthdays.json.migrated so it is never re-applied.

const YAGPDB_JSON         = path.join(__dirname, '../../data/yagpdb-birthdays.json');
const YAGPDB_JSON_MIGRATED = YAGPDB_JSON + '.migrated';

if (fs.existsSync(YAGPDB_JSON) && !fs.existsSync(YAGPDB_JSON_MIGRATED)) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    console.warn(
      '[DB] yagpdb-birthdays.json found but GUILD_ID is not set in the environment — ' +
      'skipping birthday migration. Add GUILD_ID to your .env file and restart.',
    );
  } else {
    try {
      const raw = JSON.parse(fs.readFileSync(YAGPDB_JSON, 'utf8'));

      const upsertBirthday = db.prepare(`
        INSERT INTO birthdays (guild_id, user_id, birth_day, birth_month, birth_year)
        VALUES (@guild_id, @user_id, @birth_day, @birth_month, @birth_year)
        ON CONFLICT(guild_id, user_id) DO NOTHING
      `);

      const migrateYagpdb = db.transaction(() => {
        let count = 0;
        for (const [userId, isoDate] of Object.entries(raw)) {
          // Extract the calendar date (YYYY-MM-DD) directly from the ISO string so
          // we are never affected by timezone offsets embedded in the value.
          // YAGPDB persists the user's chosen calendar date; we want that date as-is,
          // not its UTC equivalent which can be one day off when a timezone offset is present.
          const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
          if (!match) {
            console.warn(`[DB] YAGPDB migration: skipping user ${userId} — invalid date "${isoDate}"`);
            continue;
          }
          const [_fullMatch, yearStr, monthStr, dayStr] = match;
          upsertBirthday.run({
            guild_id:    guildId,
            user_id:     userId,
            birth_day:   parseInt(dayStr, 10),
            birth_month: parseInt(monthStr, 10),
            birth_year:  parseInt(yearStr, 10),
          });
          count++;
        }
        return count;
      });

      const imported = migrateYagpdb();
      fs.renameSync(YAGPDB_JSON, YAGPDB_JSON_MIGRATED);
      console.log(`[DB] Migrated yagpdb-birthdays.json → birthdays (${imported} record(s) for guild ${guildId})`);
    } catch (err) {
      console.error('[DB] yagpdb-birthdays.json migration failed — skipping:', err.message);
    }
  }
}

module.exports = db;
