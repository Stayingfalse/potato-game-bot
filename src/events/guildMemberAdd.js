'use strict';

const { handleWelcomeAutomationMemberJoin } = require('../features/welcomeAutomationFeature');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    try {
      await handleWelcomeAutomationMemberJoin(member);
    } catch (err) {
      console.error('[guildMemberAdd error]', err);
    }
  },
};
