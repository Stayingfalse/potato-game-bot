'use strict';

const { handleWelcomeAutomationMemberJoin } = require('../features/welcomeAutomationFeature');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member, client) {
    try {
      await handleWelcomeAutomationMemberJoin(member, client);
    } catch (err) {
      console.error('[guildMemberAdd error]', err);
    }
  },
};
