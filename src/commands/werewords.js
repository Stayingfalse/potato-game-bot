const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildLobbyEmbed, buildLobbyComponents } = require('../game/phases/lobby');
const { upsert: upsertGame } = require('../db/GameRepository');
const {
  createGameThread,
  deleteThread,
  fetchChannel,
  missingThreadPermissionsMessage,
} = require('../games/_core/threads');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('werewords')
    .setDescription('Start a new Werewords game lobby in this channel'),

  async execute(interaction, client) {
    const { guildId, user, channel } = interaction;
    const { gameManager } = client;

    // If this user already hosts a game in this guild, tear it down first.
    const existing = gameManager.getGameByHost(guildId, user.id);
    if (existing) {
      gameManager.deleteGame(existing.threadId);
      await deleteThread(await fetchChannel(client, existing.threadId), 'Host started a new Werewords game');
    }

    // Create a private thread for the game players.
    const thread = await createGameThread(channel, {
      name: `Werewords — ${user.username}`,
      isPrivate: true,
      autoArchiveDuration: 60,
      reason: `Werewords game started by ${user.username}`,
      hostId: user.id,
    });
    if (!thread) {
      return interaction.reply({
        content: missingThreadPermissionsMessage({ isPrivate: true }),
        flags: MessageFlags.Ephemeral,
      });
    }

    const game = gameManager.createGame(guildId, channel.id, thread.id, user.id, user.username);
    gameManager.addPlayer(thread.id, user);

    // Post the lobby embed publicly in the channel as the slash command reply.
    const { resource } = await interaction.reply({
      embeds: [buildLobbyEmbed(game)],
      components: buildLobbyComponents(thread.id),
      withResponse: true,
    });

    game.messageId = resource.message.id;
    upsertGame(game);
  },
};
