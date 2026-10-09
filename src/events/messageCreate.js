const { handleWelcomeAutomationMessage } = require('../features/welcomeAutomationFeature');
const { getGames } = require('../games/_core/registry');

module.exports = {
  name: 'messageCreate',

  async execute(message, client) {
    // Ignore bots and system messages.
    if (message.author.bot || message.system) return;

    try {
      // Game message handling only applies to guild channels.
      if (message.guild) {
        for (const game of getGames()) {
          if (game.handleMessage) await game.handleMessage(message, client);
        }
        await handleWelcomeAutomationMessage(message, client);
      }

      // ── SassyBot AI features (opt-in via SASSY_ENABLED=true) ─────────────────
      if (client.sassyManager) {
        // Suppress unprompted interjections while any game is running in this
        // thread so Sassy doesn't disrupt gameplay.  Direct mentions/replies
        // and DMs still work normally.
        const inActiveThread = !!message.guild
          && getGames().some(game => client[game.clientKey]?.getGame(message.channel.id));
        await client.sassyManager.handleMessage(message, { suppressInterjections: inActiveThread });
      }
    } catch (err) {
      console.error('[messageCreate error]', err);
    }
  },
};
