'use strict';

/** Werewords: Mode choice, secret info, ready-up and the Mayor's word choice. */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const { buildActiveEmbed, buildMayorWordComponents } = require('../phases/lobby');
const { ROLES, ROLE_DESCRIPTIONS } = require('../roles');
const { sampleN } = require('../../_core/random');
const WerewordsRepository = require('../repository');
const { updateGameMessage } = require('../gameMessage');

const {
  wordPool,
  getWordsmithSecretRoleText,
  buildSecretContent,
  buildReadyComponents,
  maybeStartTimer,
  createVoicePlayerPanels,
} = require('./shared');

/** The host picks text or voice mode; roles are dealt and the game starts. */
async function handleModeSelect(interaction, client, game) {
  const { customId, user } = interaction;
  if (!game || game.phase !== 'mode_select') {
    return interaction.reply({ content: 'No mode selection is in progress.', flags: MessageFlags.Ephemeral });
  }
  if (user.id !== game.hostId) {
    return interaction.reply({ content: 'Only the host can choose the game mode.', flags: MessageFlags.Ephemeral });
  }

  game.sessionMode = customId === 'ww_mode_text' ? 'text' : 'voice';
  client.werewordsManager.assignRoles(game.threadId);
  game.wordOptions = sampleN(wordPool, 3);
  game.phase = 'playing';
  WerewordsRepository.upsert(game);

  // The mode buttons sit on the lobby message: it now shows the game as in progress.
  await interaction.update({ embeds: [buildActiveEmbed(game)], components: [] });

  // Post the game message. It shows who's ready until everyone is, then the board;
  // the timer starts once all players have confirmed their roles (ww_ready).
  await updateGameMessage(game, client);
}

/** Shows a player their role, and the word if their role knows it. The Mayor picks the word from here. */
async function handleSecret(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player) {
    return interaction.reply({ content: 'You are not in this game.', flags: MessageFlags.Ephemeral });
  }

  // Wordsmith gets the word-picker UI until they have chosen a word;
  // afterwards they just see their word (no action buttons — responses go via
  // guess messages in text mode, or per-player panels in voice mode).
  if (player.role === ROLES.MAYOR) {
    if (game.word) {
      return interaction.reply({
        content: `${ROLE_DESCRIPTIONS[ROLES.MAYOR]}${getWordsmithSecretRoleText(player)}\n\n✅ You chose the secret word: **${game.word}**`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: `${ROLE_DESCRIPTIONS[ROLES.MAYOR]}${getWordsmithSecretRoleText(player)}\n\n🔤 **Choose the secret word:**`,
      components: buildMayorWordComponents(game.wordOptions),
      flags: MessageFlags.Ephemeral,
    });
  }

  // Werewolf / Seer / Townsfolk
  const { content, wordPending } = buildSecretContent(player, game.word);
  const alreadyReady = game.readyPlayers.has(user.id);
  const readyComponents = alreadyReady ? [] : buildReadyComponents();

  if (!wordPending) {
    return interaction.reply({ content, components: readyComponents, flags: MessageFlags.Ephemeral });
  }

  // Word not yet chosen — defer and queue for auto-update.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ content, components: readyComponents });
  game.pendingSecretInteractions.push(interaction);
  return;
}

/** A player confirms they've seen their secret info; the timer starts once everyone has. */
async function handleReady(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player) {
    return interaction.reply({ content: 'You are not in this game.', flags: MessageFlags.Ephemeral });
  }

  if (game.readyPlayers.has(user.id)) {
    return interaction.update({
      content: '✅ You have already confirmed you are ready!',
      components: [],
    });
  }

  game.readyPlayers.add(user.id);
  WerewordsRepository.upsert(game);

  // Update the ephemeral to confirm readiness and remove the button.
  await interaction.update({
    content: `✅ You're ready! (${game.readyPlayers.size} / ${game.players.size} players ready)`,
    components: [],
  });

  await updateGameMessage(game, client);
  await maybeStartTimer(game, client);
  return;
}

/** The Mayor picks one of the three preset words. */
async function handlePresetWord(interaction, client, game) {
  const { customId, user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || player.role !== ROLES.MAYOR) {
    return interaction.reply({ content: 'Only the Mayor can pick the secret word.', flags: MessageFlags.Ephemeral });
  }

  if (game.word) {
    return interaction.update({ content: `✅ The secret word is already set to: **${game.word}**`, components: [] });
  }

  const index = parseInt(customId.split('_')[2], 10);
  const chosen = game.wordOptions[index];
  if (!chosen) {
    return interaction.reply({ content: 'Invalid word selection.', flags: MessageFlags.Ephemeral });
  }

  game.word = chosen;
  game.readyPlayers.add(user.id);
  WerewordsRepository.upsert(game);

  await interaction.update({
    content: `${ROLE_DESCRIPTIONS[ROLES.MAYOR]}${getWordsmithSecretRoleText(player)}\n\n✅ You chose the secret word: **${game.word}**`,
    components: [],
  });

  // Resolve all pending Werewolf/Seer interactions.
  for (const pending of game.pendingSecretInteractions) {
    const pendingPlayer = game.players.get(pending.user.id);
    if (!pendingPlayer) continue;
    const { content } = buildSecretContent(pendingPlayer, game.word);
    const pendingReadyComponents = game.readyPlayers.has(pendingPlayer.id) ? [] : buildReadyComponents();
    await pending.editReply({ content, components: pendingReadyComponents }).catch(() => {});
  }
  game.pendingSecretInteractions = [];

  // In voice mode, create per-player response panels now that the word is set.
  if (game.sessionMode === 'voice') {
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) await createVoicePlayerPanels(game, thread);
  }

  await updateGameMessage(game, client);
  await maybeStartTimer(game, client);
  return;
}

/** Opens the Mayor's custom-word modal. */
async function handleCustomWordButton(interaction, client, game) {
  const { user } = interaction;
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || player.role !== ROLES.MAYOR) {
    return interaction.reply({ content: 'Only the Mayor can pick the secret word.', flags: MessageFlags.Ephemeral });
  }

  if (game.word) {
    return interaction.reply({
      content: `✅ The secret word is already set to: **${game.word}**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('ww_word_modal')
    .setTitle('Enter the Secret Word');

  const input = new TextInputBuilder()
    .setCustomId('ww_word_input')
    .setLabel('Secret word (max 50 characters)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(50)
    .setPlaceholder('Type any word or short phrase…')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

/** The Mayor submits a custom secret word (ww_word_modal). */
async function handleWordModal(interaction, client) {
  const { channelId, user } = interaction;

  const game = client.werewordsManager.getGame(channelId);

  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: 'There is no active game.', flags: MessageFlags.Ephemeral });
  }

  const player = game.players.get(user.id);
  if (!player || player.role !== ROLES.MAYOR) {
    return interaction.reply({ content: 'Only the Mayor can pick the secret word.', flags: MessageFlags.Ephemeral });
  }

  if (game.word) {
    return interaction.reply({
      content: `✅ The secret word is already set to: **${game.word}**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const raw = interaction.fields.getTextInputValue('ww_word_input');
  const chosen = raw.trim();
  if (!chosen) {
    return interaction.reply({ content: 'The secret word cannot be blank.', flags: MessageFlags.Ephemeral });
  }

  game.word = chosen;
  game.readyPlayers.add(user.id);
  WerewordsRepository.upsert(game);

  await interaction.reply({
    content: `${ROLE_DESCRIPTIONS[ROLES.MAYOR]}${getWordsmithSecretRoleText(player)}\n\n✅ You chose the secret word: **${game.word}**`,
    components: [],
    flags: MessageFlags.Ephemeral,
  });

  // Resolve all pending Werewolf/Seer interactions.
  for (const pending of game.pendingSecretInteractions) {
    const pendingPlayer = game.players.get(pending.user.id);
    if (!pendingPlayer) continue;
    const { content } = buildSecretContent(pendingPlayer, game.word);
    const pendingReadyComponents = game.readyPlayers.has(pendingPlayer.id) ? [] : buildReadyComponents();
    await pending.editReply({ content, components: pendingReadyComponents }).catch(() => {});
  }
  game.pendingSecretInteractions = [];

  // In voice mode, create per-player response panels now that the word is set.
  if (game.sessionMode === 'voice') {
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) await createVoicePlayerPanels(game, thread);
  }

  await updateGameMessage(game, client);
  await maybeStartTimer(game, client);
}

/** Button routes: the first entry whose `match` accepts the customId handles it. */
const buttons = [
  { match: id => id === 'ww_mode_text' || id === 'ww_mode_voice', handle: handleModeSelect },
  { match: id => id === 'ww_secret', handle: handleSecret },
  { match: id => id === 'ww_ready', handle: handleReady },
  { match: id => /^ww_word_\d+$/.test(id), handle: handlePresetWord },
  { match: id => id === 'ww_word_custom', handle: handleCustomWordButton },
];

module.exports = { buttons, handleWordModal };
