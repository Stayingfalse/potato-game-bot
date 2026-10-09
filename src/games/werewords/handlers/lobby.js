'use strict';

/** Werewords: the lobby message in the game thread — join, leave, start and cancel. */

const { MessageFlags } = require('discord.js');
const {
  buildLobbyEmbed,
  buildLobbyComponents,
  buildModeSelectEmbed,
  buildModeSelectComponents,
} = require('../phases/lobby');
const { MIN_PLAYERS } = require('../manager');
const WerewordsRepository = require('../repository');
const { fetchChannel } = require('../../_core/threads');
const { closeSession } = require('./endgame');

/** A player joins the lobby. */
async function handleJoin(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'lobby') {
    return interaction.reply({ content: 'There is no active lobby to join.', flags: MessageFlags.Ephemeral });
  }

  const added = client.werewordsManager.addPlayer(game.threadId, user);
  if (!added) {
    const reason = game.players.size >= client.werewordsManager.maxPlayers
      ? `The lobby is full (${client.werewordsManager.maxPlayers} players max).`
      : 'You are already in the game.';
    return interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
  }

  const thread = await fetchChannel(client, game.threadId);
  if (thread) await thread.members.add(user.id).catch(() => {});

  return interaction.update({ embeds: [buildLobbyEmbed(game)], components: buildLobbyComponents() });
}

/** A player leaves the lobby. */
async function handleLeave(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'lobby') {
    return interaction.reply({ content: 'There is no active lobby.', flags: MessageFlags.Ephemeral });
  }

  const removed = client.werewordsManager.removePlayer(game.threadId, user.id);
  if (!removed) {
    return interaction.reply({ content: 'You are not in the game.', flags: MessageFlags.Ephemeral });
  }

  // Removing a thread member needs Manage Threads — fails gracefully.
  const thread = await fetchChannel(client, game.threadId);
  if (thread) await thread.members.remove(user.id).catch(() => {});

  return interaction.update({ embeds: [buildLobbyEmbed(game)], components: buildLobbyComponents() });
}

/** The host starts the game: the lobby message turns into the text-or-voice mode choice. */
async function handleStart(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'lobby') {
    return interaction.reply({ content: 'There is no active lobby.', flags: MessageFlags.Ephemeral });
  }
  if (user.id !== game.hostId) {
    return interaction.reply({ content: 'Only the host can start the game.', flags: MessageFlags.Ephemeral });
  }
  if (game.players.size < MIN_PLAYERS) {
    return interaction.reply({
      content: `Need at least **${MIN_PLAYERS} players** to start. Currently: **${game.players.size}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  game.phase = 'mode_select';
  WerewordsRepository.upsert(game);
  await interaction.update({ embeds: [buildModeSelectEmbed(game)], components: buildModeSelectComponents() });
}

/** The host cancels the session before it starts. */
async function handleCancel(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'lobby') {
    return interaction.reply({ content: 'There is no active lobby to cancel.', flags: MessageFlags.Ephemeral });
  }
  if (user.id !== game.hostId) {
    return interaction.reply({ content: 'Only the host can cancel the session.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();
  await closeSession(game, client, '✖️ The host cancelled the session. This thread will be archived shortly.');
}

/** Matches a lobby button, including the `ww_join_<threadId>` form used before the lobby moved into the thread. */
function lobbyButton(action) {
  return id => id === `ww_${action}` || id.startsWith(`ww_${action}_`);
}

/** Button routes: the first entry whose `match` accepts the customId handles it. */
const buttons = [
  { match: lobbyButton('join'), handle: handleJoin },
  { match: lobbyButton('leave'), handle: handleLeave },
  { match: lobbyButton('start'), handle: handleStart },
  { match: lobbyButton('cancel'), handle: handleCancel },
];

module.exports = { buttons };
