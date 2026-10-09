'use strict';

/** Werewords: The Mayor's answers to guesses: text-guess buttons and voice panels. */

const { MessageFlags } = require('discord.js');
const {
  buildGuessComponents,
  buildVoicePlayerContent,
  buildVoicePlayerComponents,
} = require('../phases/playing');
const { startRevealPhase } = require('../phases/reveal');
const { startVotingPhase } = require('../phases/voting');
const { ROLES } = require('../roles');
const { editMessage } = require('../../_core/messages');

const { updateGameMessage } = require('../gameMessage');

const VOICE_PREFIXES = [
  'ww_voice_yes_',
  'ww_voice_no_',
  'ww_voice_maybe_',
  'ww_voice_soclose_',
  'ww_voice_wayoff_',
  'ww_voice_correct_',
];

/** The Mayor answers a text guess with Yes / No / Maybe. */
async function handleGuessAnswer(interaction, client, game) {
  const { customId, user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || player.role !== ROLES.MAYOR) {
    return interaction.reply({ content: 'Only the Mayor can respond to guesses.', flags: MessageFlags.Ephemeral });
  }

  const isMaybe = customId.startsWith('ww_guess_maybe_');
  const tokenKey = isMaybe ? 'maybe' : 'yes_no';
  if (game.tokens[tokenKey] <= 0) {
    return interaction.reply({
      content: isMaybe ? 'No **Maybe** tokens remaining!' : 'No **Yes / No** tokens remaining!',
      flags: MessageFlags.Ephemeral,
    });
  }

  game.tokens[tokenKey]--;

  // Track per-player response stats.
  const guesserId = customId.substring(customId.lastIndexOf('_') + 1);
  const guesser = game.players.get(guesserId);
  if (guesser?.responseStats) {
    if (customId.startsWith('ww_guess_yes_'))   guesser.responseStats.yes++;
    else if (customId.startsWith('ww_guess_no_')) guesser.responseStats.no++;
    else                                          guesser.responseStats.maybe++;
  }

  const responseLine = customId.startsWith('ww_guess_yes_')
    ? '\n✅ **Yes — keep narrowing it down!**'
    : customId.startsWith('ww_guess_no_')
      ? '\n❌ **No — try a different angle!**'
      : '\n❔ **Maybe — you are circling it!**';

  await interaction.update({
    content: interaction.message.content + responseLine,
    components: [],
  });

  await updateGameMessage(game, client);

  if (!isMaybe && game.tokens.yes_no <= 0) {
    await startVotingPhase(game, client);
  }

  return;
}

/** The Mayor marks a text guess as correct. */
async function handleGuessCorrect(interaction, client, game) {
  const { customId, user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || player.role !== ROLES.MAYOR) {
    return interaction.reply({ content: 'Only the Mayor can respond to guesses.', flags: MessageFlags.Ephemeral });
  }

  if (game.tokens.correct <= 0) {
    return interaction.reply({ content: 'No **Correct** tokens remaining!', flags: MessageFlags.Ephemeral });
  }

  game.tokens.correct--;

  // Edit the guess announcement to show it was accepted, remove buttons.
  await interaction.update({
    content: interaction.message.content + '\n✅ **Correct — the word has been guessed!**',
    components: [],
  });

  // Credit the stat to whichever player made the accepted guess.
  const guesserId = customId.split('ww_guess_correct_')[1];
  game.winnerGuesserUserId = guesserId ?? null;

  await startRevealPhase(game, client);
  return;
}

/** The Mayor marks a text guess as So Close or Way Off. */
async function handleGuessSignal(interaction, client, game) {
  const { customId, user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || player.role !== ROLES.MAYOR) {
    return interaction.reply({ content: 'Only the Mayor can respond to guesses.', flags: MessageFlags.Ephemeral });
  }

  if (game.tokens.so_close_way_off <= 0) {
    return interaction.reply({ content: 'No **So Close / Way Off** tokens remaining!', flags: MessageFlags.Ephemeral });
  }

  game.tokens.so_close_way_off--;

  const isSoClose = customId.startsWith('ww_guess_soclose_');

  // Track per-player response stats.
  const scGuesserId = isSoClose
    ? customId.slice('ww_guess_soclose_'.length)
    : customId.slice('ww_guess_wayoff_'.length);
  const scGuesser = game.players.get(scGuesserId);
  if (scGuesser?.responseStats) {
    if (isSoClose) scGuesser.responseStats.soClose++;
    else            scGuesser.responseStats.wayOff++;
  }

  // Edit the guess announcement to show the result, remove buttons.
  await interaction.update({
    content: interaction.message.content + (isSoClose ? '\n🔥 **So Close — keep guessing!**' : '\n❌ **Way Off — keep guessing!**'),
    components: [],
  });

  await updateGameMessage(game, client);

  return;
}

/** The Mayor logs a response on a player's voice-mode panel. */
async function handleVoicePanel(interaction, client, game) {
  const { customId, channelId, user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || player.role !== ROLES.MAYOR) {
    return interaction.reply({ content: 'Only the Mayor can use these buttons.', flags: MessageFlags.Ephemeral });
  }

  const targetPlayerId = customId.substring(customId.lastIndexOf('_') + 1);
  const targetPlayer = game.players.get(targetPlayerId);
  if (!targetPlayer) {
    return interaction.reply({ content: 'Player not found.', flags: MessageFlags.Ephemeral });
  }

  const isCorrect  = customId.startsWith('ww_voice_correct_');
  const isYes      = customId.startsWith('ww_voice_yes_');
  const isNo       = customId.startsWith('ww_voice_no_');
  const isMaybe    = customId.startsWith('ww_voice_maybe_');
  const isSoClose  = customId.startsWith('ww_voice_soclose_');

  if (isCorrect) {
    if (game.tokens.correct <= 0) {
      return interaction.reply({ content: 'No **Correct** tokens remaining!', flags: MessageFlags.Ephemeral });
    }
    game.tokens.correct--;
    game.winnerGuesserUserId = targetPlayerId;

    await interaction.deferUpdate();

    // Update the panel to show correct, remove buttons.
    await interaction.editReply({
      content: buildVoicePlayerContent(targetPlayer) + '\n✅ **CORRECT — the word has been guessed!**',
      components: [],
    }).catch(() => {});

    await startRevealPhase(game, client);
    return;
  }

  // Determine which token pool and stat to update.
  let tokenKey, statKey;
  if (isYes || isNo) {
    tokenKey = 'yes_no';
    statKey  = isYes ? 'yes' : 'no';
  } else if (isMaybe) {
    tokenKey = 'maybe';
    statKey  = 'maybe';
  } else if (isSoClose) {
    tokenKey = 'so_close_way_off';
    statKey  = 'soClose';
  } else { // wayOff
    tokenKey = 'so_close_way_off';
    statKey  = 'wayOff';
  }

  if (game.tokens[tokenKey] <= 0) {
    const tokenLabel = tokenKey === 'yes_no' ? 'Yes / No' : tokenKey === 'maybe' ? 'Maybe' : 'So Close / Way Off';
    return interaction.reply({
      content: `No **${tokenLabel}** tokens remaining!`,
      flags: MessageFlags.Ephemeral,
    });
  }

  game.tokens[tokenKey]--;
  if (targetPlayer.responseStats) targetPlayer.responseStats[statKey]++;

  await interaction.deferUpdate();

  // Update the player's voice panel with new tally and refreshed buttons.
  await interaction.editReply({
    content: buildVoicePlayerContent(targetPlayer),
    components: buildVoicePlayerComponents(targetPlayerId, game.tokens),
  }).catch(() => {});

  // Also refresh other player panels so their buttons reflect current token counts.
  const panelThread = await client.channels.fetch(channelId).catch(() => null);
  if (panelThread) {
    for (const [pid, msgId] of game.voicePlayerMessageIds) {
      if (pid === targetPlayerId) continue; // already updated via deferUpdate
      const panelPlayer = game.players.get(pid);
      if (!panelPlayer) continue;
      await editMessage(panelThread, msgId, {
        content: buildVoicePlayerContent(panelPlayer),
        components: buildVoicePlayerComponents(pid, game.tokens),
      });
    }
  }

  await updateGameMessage(game, client);

  if ((isYes || isNo) && game.tokens.yes_no <= 0) {
    await startVotingPhase(game, client);
  }

  return;
}

/**
 * In text mode, a player's message in the game thread is a guess: it's reposted
 * with the Mayor's answer buttons and the original is deleted.
 */
async function handleGuessMessage(message, client) {
  const game = client.werewordsManager.getGame(message.channel.id);
  if (!game || game.phase !== 'playing' || !game.word) return;

  // In voice mode guesses are called out verbally — don't process text messages as guesses.
  if (game.sessionMode === 'voice') return;

  const player = game.players.get(message.author.id);
  if (!player || player.role === ROLES.MAYOR) return;

  await message.channel.send({
    content: `🎯 <@${message.author.id}> guesses: **"${message.content}"**`,
    components: buildGuessComponents(message.author.id, game.tokens),
  });

  if (message.deletable) {
    await message.delete().catch(() => {});
  }
}

/** Button routes: the first entry whose `match` accepts the customId handles it. */
const buttons = [
  { match: id => ['ww_guess_yes_', 'ww_guess_no_', 'ww_guess_maybe_'].some(prefix => id.startsWith(prefix)), handle: handleGuessAnswer },
  { match: id => id.startsWith('ww_guess_correct_'), handle: handleGuessCorrect },
  { match: id => id.startsWith('ww_guess_soclose_') || id.startsWith('ww_guess_wayoff_'), handle: handleGuessSignal },
  { match: id => VOICE_PREFIXES.some(prefix => id.startsWith(prefix)), handle: handleVoicePanel },
];

module.exports = { buttons, handleGuessMessage };
