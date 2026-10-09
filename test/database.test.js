'use strict';

/** Database startup: the one-time removal of the old SassyBot AI data. */

const { src } = require('./helpers/env');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// An existing database from before the AI was removed.
const dbPath = path.join(process.env.DATA_DIR, 'bot.db');
const old = new Database(dbPath);
old.exec(`
  CREATE TABLE sassy_user_profiles (guild_id TEXT, user_id TEXT, username TEXT, topic_notes TEXT);
  CREATE TABLE sassy_conversation_log (id INTEGER PRIMARY KEY, channel_id TEXT, content TEXT, timestamp INTEGER);
  CREATE INDEX idx_sassy_conv_ch_ts ON sassy_conversation_log(channel_id, timestamp DESC);
  CREATE TABLE sassy_chat_history (channel_id TEXT PRIMARY KEY, history TEXT);
  CREATE TABLE sassy_channel_profiles (channel_id TEXT PRIMARY KEY, topic_notes TEXT);
  INSERT INTO sassy_conversation_log (channel_id, content, timestamp) VALUES ('c', 'hello', 1);
  CREATE TABLE guild_settings (guild_id TEXT NOT NULL, feature TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    channel_ids TEXT, extra TEXT, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, feature));
  INSERT INTO guild_settings (guild_id, feature, enabled) VALUES ('g', 'sassy', 1), ('g', 'birthday', 1);
`);
old.close();

const db = src('db/database');

describe('SassyBot data removal', () => {
  it('drops every sassy table and index', () => {
    const left = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%sassy%'").all();
    assert.deepEqual(left, []);
  });

  it('deletes the SassyBot settings and keeps the others', () => {
    const features = db.prepare("SELECT feature FROM guild_settings WHERE guild_id = 'g'").all().map(r => r.feature);
    assert.deepEqual(features, ['birthday']);
  });
});
