'use strict';

/** Welcome automation: welcomes come from the templates. */

const { src } = require('./helpers/env');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const settingsRepo = src('dashboard/SettingsRepository');
const { handleWelcomeAutomationMemberJoin } = src('features/welcomeAutomationFeature');

const INTRO_CHANNEL = '100000000000000001';

function memberJoining(guildId) {
  const sent = [];
  const channel = { isTextBased: () => true, send: async text => { sent.push(text); } };
  const member = {
    user: { bot: false },
    toString: () => '<@42>',
    guild: { id: guildId, channels: { fetch: async id => (id === INTRO_CHANNEL ? channel : null) } },
  };
  return { member, sent };
}

describe('welcome on join', () => {
  it('posts a template welcome that mentions the member and the introduce channel', async () => {
    settingsRepo.setFeature('g1', 'welcomeautomation', true, null, {
      triggerChannelId: INTRO_CHANNEL,
      templates: ['Pull up a chair, %s!'],
    });
    const { member, sent } = memberJoining('g1');
    await handleWelcomeAutomationMemberJoin(member);
    assert.deepEqual(sent, [`Pull up a chair, <@42>! Please introduce yourself in <#${INTRO_CHANNEL}>.`]);
  });

  it('posts nothing when welcome automation is off', async () => {
    const { member, sent } = memberJoining('g2');
    await handleWelcomeAutomationMemberJoin(member);
    assert.deepEqual(sent, []);
  });
});
