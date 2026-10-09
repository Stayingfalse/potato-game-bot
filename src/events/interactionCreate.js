const { handleRoleMenuButton } = require('../features/roleMenuFeature');
const { replyWithError } = require('../games/_core/errors');
const { routeGameInteraction } = require('../games/_core/router');

/**
 * The bot's only interactionCreate listener: slash commands go to their command,
 * role-menu buttons to the role menu, and every game button/modal to the game
 * that owns its customId prefix (see src/games/_core/router.js).
 */
module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, client);
      } catch (error) {
        console.error('[Command error]', error);
        await replyWithError(interaction, '❌ An error occurred running that command.');
      }
      return;
    }

    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;

    if (interaction.isButton() && interaction.customId.startsWith('rmr:')) {
      await handleRoleMenuButton(interaction);
      return;
    }

    await routeGameInteraction(interaction, client);
  },
};
