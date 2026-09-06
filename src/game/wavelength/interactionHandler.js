'use strict';

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const {
  buildSpectrumPickComponents,
  buildClueSubmitComponents,
} = require('./phases/cluing');
const { buildNudgeComponents } = require('./phases/guessing');
const { startRevealPhase } = require('./phases/reveal');
const {
  DEFAULT_SESSION_MODE,
  formatClueOrder,
  buildSnakePointsComponents,
  buildEndlessClueOrderComponents,
} = require('./phases/sessionConfig');
const { evaluateSessionGoal } = require('./phases/sessionEnd');
const { generateClueGiverImage, generateGuesserImage } = require('./imageGen');
const { renderGameMessage } = require('./render');
const WavelengthRepository = require('../../db/WavelengthRepository');

const spectra = require('./spectra.json');
const MIN_PLAYERS = 2;

async function updateGameMessage(game, client, options = {}, preFetchedThread) {
  const thread = preFetchedThread ?? await client.channels.fetch(game.threadId).catch(() => null);
  if (!thread) return false;

  const payload = await renderGameMessage(game, options);
  if (game.messageId) {
    const msg = await thread.messages.fetch(game.messageId).catch(() => null);
    if (msg) {
      const edited = await msg.edit(payload).catch(() => null);
      if (edited) return true;
      if (options.createIfMissing === false) return false;
    } else if (options.createIfMissing === false) {
      return false;
    }
  } else if (options.createIfMissing === false) {
    return false;
  }

  const sent = await thread.send(payload).catch(() => null);
  if (sent) {
    game.messageId = sent.id;
    WavelengthRepository.upsert(game);
    return true;
  }

  return false;
}

async function replaceCurrentInteractionMessage(interaction, game, options = {}) {
  const payload = await renderGameMessage(game, options);
  await interaction.update(payload);
}

function clearGuessTimeout(game) {
  if (game.guessTimeout) {
    clearTimeout(game.guessTimeout);
    game.guessTimeout = null;
  }
}

async function scheduleGuessTimeout(game, client) {
  clearGuessTimeout(game);
  if (game.phase !== 'guessing' || game.gamePace === 'turnbased') return;

  game.guessTimeout = setTimeout(async () => {
    if (game.phase !== 'guessing') return;
    for (const [, guess] of game.guesses) {
      guess.submitted = true;
    }
    WavelengthRepository.upsert(game);
    await startRevealPhase(game, client);
  }, 3 * 60 * 1_000);

  WavelengthRepository.upsert(game);
}

async function checkAllSubmitted(game, client) {
  const allDone = [...game.guesses.values()].every(g => g.submitted);
  if (allDone) {
    await startRevealPhase(game, client);
  }
}

async function startConfiguredRound(game, client) {
  if (!game.sessionMode) {
    client.wavelengthManager.setSessionMode(game.threadId, { ...DEFAULT_SESSION_MODE });
  }

  client.wavelengthManager.startGame(game.threadId, spectra.spectra);
  await updateGameMessage(game, client);
  return true;
}

async function handleWavelengthInteraction(interaction, client) {
  const { wavelengthManager } = client;

  if (interaction.isModalSubmit() && interaction.customId === 'wl_rr_times_modal') {
    const game = wavelengthManager.getGame(interaction.channelId);
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No session setup is active.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can configure session mode.', flags: MessageFlags.Ephemeral });
    }

    const raw = interaction.fields.getTextInputValue('wl_rr_times_input').trim();
    const times = parseInt(raw, 10);
    if (!Number.isInteger(times) || times < 1 || times > 20) {
      return interaction.reply({ content: 'Enter a whole number from 1 to 20.', flags: MessageFlags.Ephemeral });
    }

    client.wavelengthManager.setSessionMode(game.threadId, {
      type: 'round_robin_times',
      clueOrder: 'round_robin',
      targetClueTurns: times,
    });
    await interaction.reply({
      content: `✅ Session mode set: **Round Robin**, everyone clues **${times}** time(s). Now choose game options…`,
      flags: MessageFlags.Ephemeral,
    });
    await updateGameMessage(game, client);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'wl_clue_modal') {
    const game = wavelengthManager.getGame(interaction.channelId);
    if (!game || game.phase !== 'cluing') {
      return interaction.reply({ content: 'No active cluing phase.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.user.id !== game.clueGiverId) {
      return interaction.reply({ content: 'Only the Clue Giver can submit a clue.', flags: MessageFlags.Ephemeral });
    }

    const raw = interaction.fields.getTextInputValue('wl_clue_input').trim();
    if (!raw) {
      return interaction.reply({ content: 'Clue cannot be blank.', flags: MessageFlags.Ephemeral });
    }

    game.clue = raw;
    game.phase = 'guessing';
    WavelengthRepository.upsert(game);

    await interaction.reply({
      content: `✅ Clue **"${game.clue}"** submitted! Wait for everyone to guess.`,
      flags: MessageFlags.Ephemeral,
    });
    await updateGameMessage(game, client);
    await scheduleGuessTimeout(game, client);
    return;
  }

  if (!interaction.isButton()) return;

  const { customId, user } = interaction;
  const game = wavelengthManager.getGame(interaction.channelId);

  if (customId === 'wl_join') {
    if (!game || game.phase !== 'lobby') {
      return interaction.reply({ content: 'No active lobby to join.', flags: MessageFlags.Ephemeral });
    }
    const added = wavelengthManager.addPlayer(game.threadId, user);
    if (!added) {
      const reason = game.players.size >= 20 ? 'Lobby is full (20 players max).' : 'You are already in the game.';
      return interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
    }
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) await thread.members.add(user.id).catch(() => {});
    return replaceCurrentInteractionMessage(interaction, game);
  }

  if (customId === 'wl_leave') {
    if (!game || game.phase !== 'lobby') {
      return interaction.reply({ content: 'No active lobby.', flags: MessageFlags.Ephemeral });
    }
    const removed = wavelengthManager.removePlayer(game.threadId, user.id);
    if (!removed) {
      return interaction.reply({ content: 'You are not in the game.', flags: MessageFlags.Ephemeral });
    }
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) await thread.members.remove(user.id).catch(() => {});
    return replaceCurrentInteractionMessage(interaction, game);
  }

  if (customId === 'wl_start') {
    if (!game || game.phase !== 'lobby') {
      return interaction.reply({ content: 'No active lobby.', flags: MessageFlags.Ephemeral });
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

    game.phase = 'setup';
    WavelengthRepository.upsert(game);
    return replaceCurrentInteractionMessage(interaction, game);
  }

  if (customId === 'wl_cancel') {
    if (!game || game.phase !== 'lobby') {
      return interaction.reply({ content: 'No active lobby to cancel.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can cancel.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    const { closeSession } = require('./phases/endGame');
    await closeSession(game, client, `✖️ Session cancelled by <@${user.id}> before the game started.`);
    return;
  }

  if (customId === 'wl_mode_rr_times') {
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No active session setup.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can configure session mode.', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId('wl_rr_times_modal')
      .setTitle('Round Robin Target');

    const input = new TextInputBuilder()
      .setCustomId('wl_rr_times_input')
      .setLabel('How many clue turns per player?')
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(2)
      .setPlaceholder('e.g. 2')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (customId === 'wl_mode_snake_points') {
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No active session setup.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can configure session mode.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: '🎯 Select the point target for **Snake Draft**:',
      components: buildSnakePointsComponents(),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (customId.startsWith('wl_snake_points_')) {
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No active session setup.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can configure session mode.', flags: MessageFlags.Ephemeral });
    }

    const targetPoints = parseInt(customId.split('wl_snake_points_')[1], 10);
    client.wavelengthManager.setSessionMode(game.threadId, {
      type: 'snake_points',
      clueOrder: 'snake',
      targetPoints,
    });
    await interaction.update({ content: `✅ Session mode set: **Snake Draft**, first to **${targetPoints}** points. Now choose game options…`, components: [] });
    await updateGameMessage(game, client);
    return;
  }

  if (customId === 'wl_mode_endless') {
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No active session setup.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can configure session mode.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: '♾️ Choose clue-giver order for **Endless Mode**:',
      components: buildEndlessClueOrderComponents(),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (customId.startsWith('wl_endless_order_')) {
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No active session setup.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can configure session mode.', flags: MessageFlags.Ephemeral });
    }

    const clueOrder = customId.split('wl_endless_order_')[1];
    if (!['round_robin', 'snake', 'random'].includes(clueOrder)) {
      return interaction.reply({ content: 'Invalid endless clue order.', flags: MessageFlags.Ephemeral });
    }

    client.wavelengthManager.setSessionMode(game.threadId, {
      type: 'endless',
      clueOrder,
    });
    await interaction.update({
      content: `✅ Session mode set: **Endless** with **${formatClueOrder(clueOrder)}**. Now choose game options…`,
      components: [],
    });
    await updateGameMessage(game, client);
    return;
  }

  if (customId === 'wl_pace_realtime' || customId === 'wl_pace_turnbased') {
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No active session setup.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can configure game options.', flags: MessageFlags.Ephemeral });
    }
    client.wavelengthManager.setGameOptions(game.threadId, customId === 'wl_pace_turnbased' ? 'turnbased' : 'realtime', game.autoAdvanceRounds ?? false);
    return replaceCurrentInteractionMessage(interaction, game);
  }

  if (customId === 'wl_toggle_autoadvance') {
    if (!game) {
      return interaction.reply({ content: 'No active game found.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can toggle auto-advance.', flags: MessageFlags.Ephemeral });
    }

    const newVal = client.wavelengthManager.toggleAutoAdvance(game.threadId);

    if (game.phase === 'ended') {
      const { scheduleAutoAdvance } = require('./phases/endGame');
      const goal = evaluateSessionGoal(game);
      if (!newVal && game.autoAdvanceTimeout) {
        clearTimeout(game.autoAdvanceTimeout);
        game.autoAdvanceTimeout = null;
        WavelengthRepository.upsert(game);
      } else if (newVal && !goal.complete) {
        scheduleAutoAdvance(game, client);
      }
    }

    if (game.phase === 'setup' || game.phase === 'ended') {
      return replaceCurrentInteractionMessage(interaction, game);
    }

    return interaction.reply({
      content: `🔄 **Auto-advance rounds** is now **${newVal ? 'ON ✅' : 'OFF ❌'}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (customId === 'wl_confirm_options') {
    if (!game || game.phase !== 'setup') {
      return interaction.reply({ content: 'No active session setup.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can start the round.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    await startConfiguredRound(game, client);
    return;
  }

  if (customId === 'wl_open_cg_panel') {
    if (!game || game.phase !== 'cluing') {
      return interaction.reply({ content: 'No active cluing phase.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.clueGiverId) {
      return interaction.reply({ content: 'Only the Clue Giver can open this panel.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: '🎯 **Pick your spectrum!** Only you can see this.',
      components: buildSpectrumPickComponents(game.spectrumOptions),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (customId === 'wl_spectrum_0' || customId === 'wl_spectrum_1') {
    if (!game || game.phase !== 'cluing') {
      return interaction.reply({ content: 'No active cluing phase.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.clueGiverId) {
      return interaction.reply({ content: 'Only the Clue Giver can pick the spectrum.', flags: MessageFlags.Ephemeral });
    }
    if (game.chosenSpectrum) {
      return interaction.update({ content: `✅ Spectrum already chosen: \`${game.chosenSpectrum.left}\` ↔ \`${game.chosenSpectrum.right}\``, components: [] });
    }

    const idx = customId === 'wl_spectrum_0' ? 0 : 1;
    game.chosenSpectrum = game.spectrumOptions[idx];
    WavelengthRepository.upsert(game);

    let cgImageBuffer = null;
    try {
      cgImageBuffer = await generateClueGiverImage(game.chosenSpectrum, game.targetPosition);
    } catch (err) {
      console.error('[Wavelength] generateClueGiverImage failed:', err);
    }

    const files = cgImageBuffer ? [new AttachmentBuilder(cgImageBuffer, { name: 'target.png' })] : [];

    return interaction.update({
      content:
        `✅ **Spectrum chosen:** \`${game.chosenSpectrum.left}\` ↔ \`${game.chosenSpectrum.right}\`\n\n` +
        '🎯 The **target position** is shown on the image below. Give the guessers a **clue** that hints at where it sits!',
      components: buildClueSubmitComponents(),
      files,
    });
  }

  if (customId === 'wl_enter_clue') {
    if (!game || game.phase !== 'cluing') {
      return interaction.reply({ content: 'No active cluing phase.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.clueGiverId) {
      return interaction.reply({ content: 'Only the Clue Giver can submit a clue.', flags: MessageFlags.Ephemeral });
    }
    if (game.clue) {
      return interaction.reply({ content: `✅ Clue already set: **"${game.clue}"**`, flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId('wl_clue_modal')
      .setTitle('Enter Your Clue');

    const input = new TextInputBuilder()
      .setCustomId('wl_clue_input')
      .setLabel('Your clue')
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(50)
      .setPlaceholder('e.g. Volcano')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (customId === 'wl_guess_panel') {
    if (!game || game.phase !== 'guessing') {
      return interaction.reply({ content: 'Guessing is not active right now.', flags: MessageFlags.Ephemeral });
    }
    if (user.id === game.clueGiverId) {
      return interaction.reply({ content: 'The Clue Giver cannot guess.', flags: MessageFlags.Ephemeral });
    }
    if (!game.guesses.has(user.id)) {
      return interaction.reply({ content: 'You are not registered as a guesser in this game.', flags: MessageFlags.Ephemeral });
    }

    const guess = game.guesses.get(user.id);
    const player = game.players.get(user.id);

    let imageBuffer = null;
    try {
      imageBuffer = await generateGuesserImage(player.avatarURL, player.username, game.chosenSpectrum, guess.position);
    } catch (err) {
      console.error('[Wavelength] generateGuesserImage failed:', err);
    }

    const files = imageBuffer ? [new AttachmentBuilder(imageBuffer, { name: 'guess.png' })] : [];
    const components = buildNudgeComponents(user.id, guess.submitted, guess.position);

    return interaction.reply({
      content: guess.submitted
        ? `✅ You locked in at position **${guess.position}**. Waiting for others…`
        : `📍 Your current position: **${guess.position}** — use the buttons to nudge your marker, then **SUBMIT**.`,
      components,
      files,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (customId.startsWith('wl_nudge_')) {
    const parts = customId.split('_');
    const targetUserId = parts[2];
    const delta = parseInt(parts[3], 10);

    if (user.id !== targetUserId) {
      return interaction.reply({ content: 'This is not your guess panel.', flags: MessageFlags.Ephemeral });
    }
    if (!game || game.phase !== 'guessing') {
      return interaction.reply({ content: 'Guessing is not active.', flags: MessageFlags.Ephemeral });
    }

    const guess = game.guesses.get(user.id);
    if (!guess) {
      return interaction.reply({ content: 'You are not registered as a guesser.', flags: MessageFlags.Ephemeral });
    }
    if (guess.submitted) {
      return interaction.reply({ content: '✅ You have already submitted your guess.', flags: MessageFlags.Ephemeral });
    }

    guess.position = Math.max(0, Math.min(100, guess.position + delta));
    WavelengthRepository.upsert(game);

    const player = game.players.get(user.id);
    let imageBuffer = null;
    try {
      imageBuffer = await generateGuesserImage(player.avatarURL, player.username, game.chosenSpectrum, guess.position);
    } catch (err) {
      console.error('[Wavelength] generateGuesserImage failed:', err);
    }

    const files = imageBuffer ? [new AttachmentBuilder(imageBuffer, { name: 'guess.png' })] : [];
    const components = buildNudgeComponents(user.id, false, guess.position);

    return interaction.update({
      content: `📍 Your current position: **${guess.position}** — use the buttons to nudge your marker, then **SUBMIT**.`,
      components,
      files,
    });
  }

  if (customId.startsWith('wl_submit_')) {
    const targetUserId = customId.split('wl_submit_')[1];

    if (user.id !== targetUserId) {
      return interaction.reply({ content: 'This is not your guess panel.', flags: MessageFlags.Ephemeral });
    }
    if (!game || game.phase !== 'guessing') {
      return interaction.reply({ content: 'Guessing is not active.', flags: MessageFlags.Ephemeral });
    }

    const guess = game.guesses.get(user.id);
    if (!guess) {
      return interaction.reply({ content: 'You are not registered as a guesser.', flags: MessageFlags.Ephemeral });
    }
    if (guess.submitted) {
      return interaction.reply({ content: '✅ Already submitted.', flags: MessageFlags.Ephemeral });
    }

    guess.submitted = true;
    WavelengthRepository.upsert(game);

    const player = game.players.get(user.id);
    let imageBuffer = null;
    try {
      imageBuffer = await generateGuesserImage(player.avatarURL, player.username, game.chosenSpectrum, guess.position);
    } catch (err) {
      console.error('[Wavelength] generateGuesserImage failed:', err);
    }

    const files = imageBuffer ? [new AttachmentBuilder(imageBuffer, { name: 'guess.png' })] : [];

    await interaction.update({
      content: `✅ Locked in at position **${guess.position}**! Waiting for the others…`,
      components: buildNudgeComponents(user.id, true, guess.position),
      files,
    });

    await updateGameMessage(game, client);
    await checkAllSubmitted(game, client);
    return;
  }

  if (customId === 'wl_rematch_same') {
    if (!game || game.phase !== 'ended') {
      return interaction.reply({ content: 'No ended round in this thread.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can start the next round.', flags: MessageFlags.Ephemeral });
    }
    const goal = evaluateSessionGoal(game);
    if (goal.complete) {
      return interaction.reply({
        content: '🏁 The configured session goal is already complete. Choose **End Game & Close Session** or **New Game (Open Signups)**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await replaceCurrentInteractionMessage(interaction, game, {
      resultText: '🔄 Starting the next round…',
      includeControls: false,
    });

    const resetGame = client.wavelengthManager.resetForRematch(game.threadId, false);
    if (!resetGame) return;
    await startConfiguredRound(resetGame, client);
    return;
  }

  if (customId === 'wl_rematch_open') {
    if (!game || game.phase !== 'ended') {
      return interaction.reply({ content: 'No ended round in this thread.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can open sign-ups for a new game.', flags: MessageFlags.Ephemeral });
    }

    await replaceCurrentInteractionMessage(interaction, game, {
      resultText: '📋 Opening sign-ups for a new game…',
      includeControls: false,
    });

    const resetGame = client.wavelengthManager.resetForNewSession(game.threadId, true);
    if (!resetGame) return;
    await updateGameMessage(resetGame, client);
    return;
  }

  if (customId === 'wl_close_session') {
    if (!game) {
      return interaction.reply({ content: 'No active game in this thread.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.hostId) {
      return interaction.reply({ content: 'Only the host can close the session.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    const { closeSession } = require('./phases/endGame');
    await closeSession(game, client, `🔒 Session closed by <@${user.id}>. Thanks for playing Wavelength!`);
    return;
  }

  return interaction.reply({ content: 'Unknown action.', flags: MessageFlags.Ephemeral });
}

module.exports = {
  handleWavelengthInteraction,
  updateGameMessage,
  startConfiguredRound,
  scheduleGuessTimeout,
};
