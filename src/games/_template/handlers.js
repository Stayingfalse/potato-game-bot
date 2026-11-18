'use strict';

const { MessageFlags } = require('discord.js');
const { MIN_PLAYERS } = require('./manager');
const HighRollRepository = require('./repository');
const { renderGameMessage } = require('./render');
const { updateGameMessage, startRound, finishRound, closeSession } = require('./flow');
const { fetchChannel } = require('../_core/threads');
const { howToPlayReply } = require('../_core/lobby');
const howToPlay = require('./howToPlay');
const { isHost, trackHostActivity, replyNotHost, handleTakeHost } = require('../_core/host');
const card = require('./card');

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

/*
 * Each handler gets the game for the thread the button was pressed in. Buttons
 * sit on the game message, so interaction.update(renderGameMessage(game))
 * redraws it in place. Errors thrown here are caught by the router, which logs
 * them and tells the player something went wrong.
 */

async function handleJoin(interaction, client, game) {
  if (game.phase !== 'lobby') return reply(interaction, 'This game has already started.');
  if (!client.highRollManager.addPlayer(game.threadId, interaction.user)) {
    return reply(interaction, game.players.size >= client.highRollManager.maxPlayers ? 'The game is full.' : 'You are already in the game.');
  }
  const thread = await fetchChannel(client, game.threadId);
  await thread?.members.add(interaction.user.id).catch(() => {});
  await interaction.update(renderGameMessage(game));
  return card.update(client, game); // the channel card lists the players too
}

async function handleLeave(interaction, client, game) {
  if (!client.highRollManager.removePlayer(game.threadId, interaction.user.id)) {
    return reply(interaction, 'You are not in the lobby.');
  }
  await interaction.update(renderGameMessage(game));
  return card.update(client, game);
}

async function handleStart(interaction, client, game) {
  if (!isHost(interaction, game)) return replyNotHost(interaction, game, 'Only the host can start the game.');
  if (game.phase !== 'lobby') return reply(interaction, 'This game has already started.');
  if (game.players.size < MIN_PLAYERS) {
    return reply(interaction, `Need at least **${MIN_PLAYERS} players** to start. Currently: **${game.players.size}**.`);
  }
  await startRound(game, client);
  await interaction.update(renderGameMessage(game));
  return card.update(client, game); // now "Game in progress"
}

async function handleCancel(interaction, client, game) {
  if (!isHost(interaction, game)) return replyNotHost(interaction, game, 'Only the host can cancel the game.');
  await interaction.deferUpdate();
  return closeSession(game, client, `✖️ Cancelled by <@${interaction.user.id}>.`);
}

async function handleRoll(interaction, client, game) {
  const { user } = interaction;
  if (game.phase !== 'rolling') return reply(interaction, 'Rolling is closed.');
  if (!game.players.has(user.id)) return reply(interaction, 'You are not in this game.');
  if (game.rolls.has(user.id)) return reply(interaction, `You already rolled **${game.rolls.get(user.id)}**.`);

  game.rolls.set(user.id, 1 + Math.floor(Math.random() * 100));
  HighRollRepository.upsert(game);

  // Everyone has rolled: finishRound redraws the message with the results.
  if (game.rolls.size === game.players.size) {
    await interaction.deferUpdate();
    return finishRound(game, client);
  }
  return interaction.update(renderGameMessage(game));
}

async function handleAgain(interaction, client, game) {
  if (!isHost(interaction, game)) return replyNotHost(interaction, game, 'Only the host can start the next game.');
  if (game.phase !== 'ended') return reply(interaction, 'This game is still going.');
  await startRound(game, client);
  return interaction.update(renderGameMessage(game));
}

async function handleClose(interaction, client, game) {
  if (!isHost(interaction, game)) return replyNotHost(interaction, game, 'Only the host can close the session.');
  await interaction.deferUpdate();
  return closeSession(game, client, '🔒 Session closed. Thanks for playing!');
}

/** A player takes over from a host who has gone quiet (see _core/host.js). */
function handleTakeHostButton(interaction, client, game) {
  return handleTakeHost(interaction, client, game, { manager: client.highRollManager });
}

/** customId → handler. Add a line here for every new button. */
const BUTTONS = {
  hr_join: handleJoin,
  hr_leave: handleLeave,
  hr_start: handleStart,
  hr_cancel: handleCancel,
  hr_roll: handleRoll,
  hr_again: handleAgain,
  hr_close: handleClose,
  hr_take_host: handleTakeHostButton,
};

/** Entry point for every interaction whose customId starts with the manifest's prefix. */
async function handleInteraction(interaction, client) {
  // The lobby's "How to play" button: anyone can read the rules, with or without a game in the thread.
  if (interaction.customId === 'hr_howto') return interaction.reply(howToPlayReply({ name: 'High Roll', howToPlay }));

  // The Join button on the channel card. It's pressed in the starting channel, not the
  // thread, so the card finds the game by its message; refreshLobby redraws the lobby.
  if (interaction.customId === card.joinId) {
    return card.handleJoin(interaction, client, { refreshLobby: (game, c) => updateGameMessage(game, c) });
  }

  const handler = interaction.isButton() ? BUTTONS[interaction.customId] : null;
  if (!handler) return;

  const game = client.highRollManager.getGame(interaction.channelId);
  if (!game) return reply(interaction, 'There is no active High Roll game in this thread.');
  trackHostActivity(interaction, game);
  return handler(interaction, client, game);
}

module.exports = { handleInteraction };
