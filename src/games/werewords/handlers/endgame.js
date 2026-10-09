'use strict';

/** Werewords: Ending a game, the Werewolf reveal, voting, rematches and closing the session. */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { buildLobbyEmbed, buildLobbyComponents, buildActiveEmbed } = require('../phases/lobby');
const { endGame } = require('../phases/endGame');
const {
  SEER_PICK_WINDOW_MS,
  scheduleRevealTimeout,
  buildSeerPickComponents,
} = require('../phases/reveal');
const { tallyVotes } = require('../phases/voting');
const { buildSessionSummaryEmbed } = require('../phases/sessionEnd');
const { getGuildStats } = require('../stats');
const { isDemon, isLibrarian } = require('../roles');
const { sampleN } = require('../../_core/random');
const { fetchChannel, lockAndArchive } = require('../../_core/threads');
const WerewordsRepository = require('../repository');
const { renderGameMessage } = require('../render');
const { updateGameMessage } = require('../gameMessage');

const { wordPool, updateLobbyMessage } = require('./shared');

/** The host ends an in-progress game early. */
async function handleEndGameButton(interaction, client, game) {
  const { user } = interaction;
  if (!game || (game.phase !== 'playing' && game.phase !== 'voting' && game.phase !== 'reveal')) {
    return interaction.reply({ content: 'There is no active game to end.', flags: MessageFlags.Ephemeral });
  }

  if (user.id !== game.hostId) {
    return interaction.reply({ content: 'Only the host can end the game early.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();
  await endGame(game, client, 'host_cancelled');
  return;
}

/** The Werewolf reveals themselves after the word is guessed, and gets 20 s to name the Seer. */
async function handleReveal(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'reveal' || game.werewolfRevealed) {
    return interaction.reply({ content: 'The reveal phase is not active.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || !isDemon(player)) {
    return interaction.reply({ content: 'Only the Werewolf can reveal themselves.', flags: MessageFlags.Ephemeral });
  }

  game.werewolfRevealed = true;
  game.phaseEndsAt = Date.now() + SEER_PICK_WINDOW_MS;
  WerewordsRepository.upsert(game);
  scheduleRevealTimeout(game, client);

  // The Reveal button is on the game message: show the reveal and swap in "Pick the Seer".
  await interaction.update(renderGameMessage(game));
  await interaction.followUp(buildSeerPickerPayload(game, user.id));
}

/** The revealed Werewolf names who they think the Seer is. */
async function handleSeerPick(interaction, client, game) {
  const { customId, user } = interaction;
  if (!game || game.phase !== 'reveal' || !game.werewolfRevealed) {
    return interaction.reply({ content: 'The reveal phase is not active.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || !isDemon(player)) {
    return interaction.reply({ content: 'Only the Werewolf can pick the Seer.', flags: MessageFlags.Ephemeral });
  }

  client.werewordsManager.clearTimers(game);

  const targetId = customId.split('ww_seer_pick_')[1];
  const target = game.players.get(targetId);

  // Acknowledge the pick (remove ephemeral buttons).
  await interaction.update({
    content: `🔮 You picked **${target?.username ?? 'Unknown'}** as the Seer.`,
    components: [],
  });

  // Announce result publicly in the thread.
  const correct = isLibrarian(target);
  const thread = await fetchChannel(client, game.threadId);
  if (thread) {
    await thread.send({
      content: correct
        ? `😈 The Werewolf picked <@${targetId}> as the Seer — **correct!** Werewolves steal the win!`
        : `😈 The Werewolf picked <@${targetId}> as the Seer — **wrong!** Townsfolk hold their win!`,
    }).catch(() => {});
  }

  await endGame(game, client, correct ? 'werewolf_seer' : 'villagers_word', correct ? targetId : null);
}

/** Reopens the revealed Werewolf's Seer picker (e.g. after a restart or if they closed it). */
async function handleSeerPanel(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'reveal' || !game.werewolfRevealed) {
    return interaction.reply({ content: 'The reveal phase is not active.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || !isDemon(player)) {
    return interaction.reply({ content: 'Only the Werewolf can pick the Seer.', flags: MessageFlags.Ephemeral });
  }

  return interaction.reply(buildSeerPickerPayload(game, user.id));
}

/** The Werewolf's ephemeral Seer picker. */
function buildSeerPickerPayload(game, werewolfId) {
  return {
    content: `🔮 **Pick who you think is the Seer.** You have until <t:${Math.floor(game.phaseEndsAt / 1000)}:R>!`,
    components: buildSeerPickComponents(game.players, werewolfId),
    flags: MessageFlags.Ephemeral,
  };
}

/** A player votes for who they think the Werewolf is. */
async function handleVote(interaction, client, game) {
  const { customId, user } = interaction;
  if (!game || game.phase !== 'voting') {
    return interaction.reply({ content: 'Voting is not active.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player) {
    return interaction.reply({ content: 'You are not in this game.', flags: MessageFlags.Ephemeral });
  }

  const targetId = customId.split('ww_vote_')[1];
  const target = game.players.get(targetId);
  if (!target) {
    return interaction.reply({ content: 'That player is not in the game.', flags: MessageFlags.Ephemeral });
  }

  const changed = game.votes.has(user.id);
  game.votes.set(user.id, targetId);
  WerewordsRepository.upsert(game);

  await interaction.reply({
    content: changed
      ? `🗳️ Vote changed to **${target.username}**.`
      : `🗳️ Voted for **${target.username}**.`,
    flags: MessageFlags.Ephemeral,
  });

  // Tally early if every player has voted; otherwise show who has voted so far.
  if (game.votes.size >= game.players.size) {
    client.werewordsManager.clearTimers(game);
    await tallyVotes(game, client);
  } else {
    await updateGameMessage(game, client);
  }
}

/** The host starts the next game with the same players. */
async function handleRematchSame(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'ended') {
    return interaction.reply({ content: 'No ended game in this thread.', flags: MessageFlags.Ephemeral });
  }
  if (user.id !== game.hostId) {
    return interaction.reply({ content: 'Only the host can start a rematch.', flags: MessageFlags.Ephemeral });
  }

  await interaction.update({ components: [] });

  const resetGame = client.werewordsManager.resetForRematch(game.threadId, false);
  if (!resetGame) return;

  client.werewordsManager.assignRoles(game.threadId);
  resetGame.wordOptions = sampleN(wordPool, 3);
  WerewordsRepository.upsert(resetGame);

  await updateLobbyMessage(resetGame, client, { embeds: [buildActiveEmbed(resetGame)], components: [] });

  // A fresh game message (ready-up, then the board). The timer starts once
  // all players have confirmed their roles (ww_ready).
  await updateGameMessage(resetGame, client);
}

/** The host reopens sign-ups for the next game. */
async function handleRematchOpen(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'ended') {
    return interaction.reply({ content: 'No ended game in this thread.', flags: MessageFlags.Ephemeral });
  }
  if (user.id !== game.hostId) {
    return interaction.reply({ content: 'Only the host can open sign-ups.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  const resetGame = client.werewordsManager.resetForRematch(game.threadId, true);
  if (!resetGame) return;

  // The original lobby message is far up the thread by now, so post a fresh one
  // and make it the session's lobby message from here on.
  const thread = await fetchChannel(client, game.threadId);
  const lobbyMsg = await thread?.send({
    content: `📋 **Game ${resetGame.gameNumber} sign-ups open!** Click **Join** below to play.`,
    embeds: [buildLobbyEmbed(resetGame)],
    components: buildLobbyComponents(),
  }).catch(() => null);
  if (lobbyMsg) {
    resetGame.messageId = lobbyMsg.id;
    WerewordsRepository.upsert(resetGame);
  }
}

/** The host closes the session after a game. */
async function handleCloseSession(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'ended') {
    return interaction.reply({ content: 'No ended game in this thread.', flags: MessageFlags.Ephemeral });
  }
  if (user.id !== game.hostId) {
    return interaction.reply({ content: 'Only the host can close the session.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();
  await closeSession(game, client, '🔒 **Session closed.** Thanks for playing!');
}

/**
 * Ends the whole session, from any phase: stops timers, posts `reason` (with the
 * session summary if any games were played), marks the lobby message as ended,
 * archives the thread after a few seconds and deletes the game.
 */
async function closeSession(game, client, reason) {
  client.werewordsManager.clearTimers(game);

  const gamesPlayed = game.sessionHistory.length;
  const thread = await fetchChannel(client, game.threadId);
  if (thread) {
    await thread.send({
      content: reason,
      embeds: gamesPlayed > 0 ? [buildSessionSummaryEmbed(game, getGuildStats(game.guildId))] : [],
    }).catch(() => {});
    lockAndArchive(thread, { delayMs: 5_000 });
  }

  await updateLobbyMessage(game, client, {
    embeds: [
      new EmbedBuilder()
        .setTitle('🔮  Werewords — Session Ended')
        .setDescription(`${gamesPlayed} game${gamesPlayed !== 1 ? 's' : ''} played. Thanks for playing!`)
        .setColor(0x5865F2)
        .setTimestamp(),
    ],
    components: [],
  });

  client.werewordsManager.deleteGame(game.threadId);
}

/** Button routes: the first entry whose `match` accepts the customId handles it. */
const buttons = [
  { match: id => id === 'ww_end_game', handle: handleEndGameButton },
  { match: id => id === 'ww_reveal', handle: handleReveal },
  { match: id => id.startsWith('ww_seer_pick_'), handle: handleSeerPick },
  { match: id => id === 'ww_seer_panel', handle: handleSeerPanel },
  { match: id => id.startsWith('ww_vote_'), handle: handleVote },
  { match: id => id === 'ww_rematch_same', handle: handleRematchSame },
  { match: id => id === 'ww_rematch_open', handle: handleRematchOpen },
  { match: id => id === 'ww_close_session', handle: handleCloseSession },
];

module.exports = { buttons, closeSession };
