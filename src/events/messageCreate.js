const { handleWelcomeAutomationMessage } = require('../features/welcomeAutomationFeature');
const { getGames } = require('../games/_core/registry');

module.exports = {
  name: 'messageCreate',

  async execute(message, client) {
    // Ignore bots, system messages and DMs.
    if (message.author.bot || message.system || !message.guild) return;

    try {
      for (const game of getGames()) {
        if (game.handleMessage) await game.handleMessage(message, client);
      }
      await handleWelcomeAutomationMessage(message);
    } catch (err) {
      console.error('[messageCreate error]', err);
    }
  },
};
