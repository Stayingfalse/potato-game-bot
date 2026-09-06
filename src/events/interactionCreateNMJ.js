'use strict';

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const { renderGameMessage, renderSpectatorHistory } = require('../game/nmj/render');
const { findBestCategoryMatch } = require('../utils/fuzzyMatch');
const { MIN_PLAYERS } = require('../game/NoMoreJockeysManager');

// ── Helpers ──────────────────────────────────────────────────────────────────

function persistGame(client, game) {
  if (!game) return;
  client.nmjManager?.saveGame(game.threadId);
}

/**
 * Fetches display names for a game's players so they can be shown on buttons.
 * Failures (unknown members, missing perms) fall back to plain mentions.
 */
async function fetchDisplayNames(thread, game) {
  const names = new Map();
  await Promise.all(game.players.map(async (id) => {
    const member = await thread.members.fetch(id).catch(() => null);
    if (member) names.set(id, member.displayName);
  }));
  return names;
}

/** Re-render and edit the single persistent NMJ message for this game. */
async function updateGameMessage(game, client, resultText, preFetchedThread) {
  const thread = preFetchedThread ?? await client.channels.fetch(game.threadId).catch(() => null);
  if (!thread) return;
  const displayNames = await fetchDisplayNames(thread, game);
  const { components, flags } = renderGameMessage(game, resultText, { displayNames });
  if (game.messageId) {
    const msg = await thread.messages.fetch(game.messageId).catch(() => null);
    if (msg) {
      await msg.edit({ components, flags }).catch(() => {});
      return;
    }
  }
  const sent = await thread.send({ components, flags }).catch(() => null);
  if (sent) {
    game.messageId = sent.id;
    persistGame(client, game);
  }
}

/**
 * Deletes the challenged player's recent messages in the thread (except the persistent
 * game message). Used when a challenge starts so the accused can't quietly delete or
 * edit what they said. Other players' messages are left untouched.
 */
async function purgeThreadMessages(thread, keepMessageId, authorId) {
  try {
    let fetched;
    do {
      fetched = await thread.messages.fetch({ limit: 100 });
      const toDelete = fetched.filter(m => m.id !== keepMessageId && (!authorId || m.author.id === authorId));
      if (toDelete.size > 0) {
        await thread.bulkDelete(toDelete, true).catch(async () => {
          // bulkDelete fails for messages >14 days old — fall back to individual deletes.
          for (const m of toDelete.values()) {
            await m.delete().catch(() => {});
          }
        });
      }
    } while (fetched.size >= 100);
  } catch (err) {
    console.error('[NMJ] Failed to purge thread messages:', err);
  }
}

function nextAliveIndex(game, fromIndex) {
  const n = game.players.length;
  if (n === 0) return -1;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (!game.eliminatedPlayers.includes(game.players[idx])) return idx;
  }
  return -1;
}

function clearPendingMove(game) {
  game.pendingMove = null;
  game.nameAnotherRequired = false;
  game.acceptedPlayers = new Set();
  game.challengeState = null;
}

function advanceTurn(game) {
  clearPendingMove(game);
  const idx = nextAliveIndex(game, game.currentPlayerIndex);
  if (idx !== -1) game.currentPlayerIndex = idx;
}

/** Ends the game: posts final state to the starting channel, locks/archives the thread, cleans up state. */
async function endGame(game, client, resultText) {
  game.status = 'ended';
  persistGame(client, game);

  const thread = await client.channels.fetch(game.threadId).catch(() => null);
  if (thread) {
    await updateGameMessage(game, client, resultText, thread);
  }

  const { components, flags } = renderGameMessage(game, resultText);
  const originChannel = await client.channels.fetch(game.channelId).catch(() => null);
  if (originChannel) {
    await originChannel.send({ components, flags }).catch(() => {});
  }

  if (thread) {
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
  }

  client.nmjManager.deleteGame(game.threadId);
}

function checkForWinner(game) {
  return game.alivePlayers().length <= 1;
}

// ── Modal builders ───────────────────────────────────────────────────────────

function buildMoveModal() {
  const modal = new ModalBuilder().setCustomId('nmj_move_modal').setTitle('Take Your Turn');
  const celebInput = new TextInputBuilder()
    .setCustomId('nmj_celeb')
    .setLabel('Celebrity Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. Tom Cruise')
    .setRequired(true)
    .setMaxLength(100);
  const categoryInput = new TextInputBuilder()
    .setCustomId('nmj_category')
    .setLabel('Category ("No More…")')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. No More people who have won an Oscar')
    .setRequired(true)
    .setMaxLength(150);
  modal.addComponents(
    new ActionRowBuilder().addComponents(celebInput),
    new ActionRowBuilder().addComponents(categoryInput),
  );
  return modal;
}

function buildChallengeModal() {
  const modal = new ModalBuilder().setCustomId('nmj_challenge_modal').setTitle('Challenge');
  const input = new TextInputBuilder()
    .setCustomId('nmj_challenge_category')
    .setLabel('Which category does this violate?')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe the earlier "No More…" category you believe this breaks')
    .setRequired(true)
    .setMaxLength(150);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildNameAnotherProvideModal() {
  const modal = new ModalBuilder().setCustomId('nmj_na_provide_modal').setTitle('Name Another Celebrity');
  const input = new TextInputBuilder()
    .setCustomId('nmj_na_celeb')
    .setLabel('Another celebrity fitting the category')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildNameAnotherCantModal() {
  const modal = new ModalBuilder().setCustomId('nmj_na_cant_modal').setTitle('Provide A New Category');
  const input = new TextInputBuilder()
    .setCustomId('nmj_na_new_category')
    .setLabel('New Category ("No More…")')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(150);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

// ── Button handlers ──────────────────────────────────────────────────────────

async function handleButton(interaction, client, game) {
  const { customId, user } = interaction;

  // ── Recruiting ───────────────────────────────────────────────────────────
  if (customId === 'nmj_join') {
    if (game.status !== 'recruiting') {
      return interaction.reply({ content: 'This game is no longer recruiting.', flags: MessageFlags.Ephemeral });
    }
    const added = client.nmjManager.addPlayer(game.threadId, user);
    if (!added) {
      return interaction.reply({ content: 'You are already in the game.', flags: MessageFlags.Ephemeral });
    }
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) await thread.members.add(user.id).catch(() => {});
    const { components, flags } = renderGameMessage(game);
    return interaction.update({ components, flags });
  }

  if (customId === 'nmj_leave') {
    if (game.status !== 'recruiting') {
      return interaction.reply({ content: 'The game has already started.', flags: MessageFlags.Ephemeral });
    }
    const removed = client.nmjManager.removePlayer(game.threadId, user.id);
    if (!removed) return interaction.reply({ content: 'You are not in this game.', flags: MessageFlags.Ephemeral });
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) await thread.members.remove(user.id).catch(() => {});
    const { components, flags } = renderGameMessage(game);
    return interaction.update({ components, flags });
  }

  if (customId === 'nmj_start') {
    if (game.status !== 'recruiting') {
      return interaction.reply({ content: 'This game has already started.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.creatorId) {
      return interaction.reply({ content: 'Only the game creator can start the game.', flags: MessageFlags.Ephemeral });
    }
    if (game.players.length < MIN_PLAYERS) {
      return interaction.reply({ content: `Need at least **${MIN_PLAYERS} players** to start. Currently: **${game.players.length}**.`, flags: MessageFlags.Ephemeral });
    }
    game.status = 'ordering';
    persistGame(client, game);
    const { components, flags } = renderGameMessage(game);
    return interaction.update({ components, flags });
  }

  // ── Ordering ─────────────────────────────────────────────────────────────
  if (customId === 'nmj_spin') {
    if (game.status !== 'ordering') {
      return interaction.reply({ content: 'Turn order has already been set.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.creatorId) {
      return interaction.reply({ content: 'Only the game creator can spin the wheel.', flags: MessageFlags.Ephemeral });
    }
    client.nmjManager.spinWheel(game.threadId);
    const { components, flags } = renderGameMessage(game);
    return interaction.update({ components, flags });
  }

  if (customId === 'nmj_begin') {
    if (game.status !== 'ordering') {
      return interaction.reply({ content: 'The game has already begun.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.creatorId) {
      return interaction.reply({ content: 'Only the game creator can begin the game.', flags: MessageFlags.Ephemeral });
    }
    client.nmjManager.beginGame(game.threadId);
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    const displayNames = thread ? await fetchDisplayNames(thread, game) : new Map();
    const { components, flags } = renderGameMessage(game, undefined, { displayNames });
    return interaction.update({ components, flags });
  }

  // ── Spectator peek (available to anyone watching, players included) ─────
  if (customId === 'nmj_spectate') {
    return interaction.reply({
      content: `👁️ **Spectator view — everything named so far:**\n${renderSpectatorHistory(game)}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Turn: declare ────────────────────────────────────────────────────────
  if (customId === 'nmj_take_turn') {
    if (game.status !== 'playing' || game.pendingMove) {
      return interaction.reply({ content: 'It is not time to take a turn right now.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.currentPlayerId()) {
      return interaction.reply({ content: 'It is not your turn.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildMoveModal());
  }

  // ── Turn: respond ────────────────────────────────────────────────────────
  if (customId === 'nmj_accept') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'respond') {
      return interaction.reply({ content: 'There is nothing to accept right now.', flags: MessageFlags.Ephemeral });
    }
    if (!game.alivePlayers().includes(user.id)) {
      return interaction.reply({ content: 'You are not an active player.', flags: MessageFlags.Ephemeral });
    }
    if (user.id === game.pendingMove.playerId) {
      return interaction.reply({ content: 'You cannot accept your own move.', flags: MessageFlags.Ephemeral });
    }
    game.acceptedPlayers.add(user.id);

    const stillWaiting = game.alivePlayers().filter(id => id !== game.pendingMove.playerId && !game.acceptedPlayers.has(id));
    if (stillWaiting.length === 0) {
      // All players accepted — commit the move. Category & celeb become hidden going forward.
      game.moves.push({ playerId: game.pendingMove.playerId, celebs: game.pendingMove.celebs, category: game.pendingMove.category });
      game.bannedCategories.push(game.pendingMove.category);
      advanceTurn(game);
    }
    persistGame(client, game);
    await interaction.deferUpdate();
    return updateGameMessage(game, client);
  }

  if (customId === 'nmj_challenge') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'respond') {
      return interaction.reply({ content: 'There is nothing to challenge right now.', flags: MessageFlags.Ephemeral });
    }
    if (!game.alivePlayers().includes(user.id)) {
      return interaction.reply({ content: 'You are not an active player.', flags: MessageFlags.Ephemeral });
    }
    if (user.id === game.pendingMove.playerId) {
      return interaction.reply({ content: 'You cannot challenge your own move.', flags: MessageFlags.Ephemeral });
    }
    const tokens = game.challengeCounts.get(user.id) ?? 0;
    if (tokens <= 0) {
      return interaction.reply({ content: 'You have no challenge tokens remaining.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildChallengeModal());
  }

  if (customId === 'nmj_name_another') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'respond') {
      return interaction.reply({ content: 'There is nothing to respond to right now.', flags: MessageFlags.Ephemeral });
    }
    if (!game.alivePlayers().includes(user.id)) {
      return interaction.reply({ content: 'You are not an active player.', flags: MessageFlags.Ephemeral });
    }
    if (user.id === game.pendingMove.playerId) {
      return interaction.reply({ content: 'You cannot ask yourself to name another.', flags: MessageFlags.Ephemeral });
    }
    game.pendingMove.stage = 'name_another';
    game.nameAnotherRequired = true;
    persistGame(client, game);
    await interaction.deferUpdate();
    return updateGameMessage(game, client);
  }

  // ── Turn: name another ───────────────────────────────────────────────────
  if (customId === 'nmj_na_provide') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'name_another') {
      return interaction.reply({ content: 'This is not currently required.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.pendingMove.playerId) {
      return interaction.reply({ content: 'Only the original player can respond.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildNameAnotherProvideModal());
  }

  if (customId === 'nmj_na_cant') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'name_another') {
      return interaction.reply({ content: 'This is not currently required.', flags: MessageFlags.Ephemeral });
    }
    if (user.id !== game.pendingMove.playerId) {
      return interaction.reply({ content: 'Only the original player can respond.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(buildNameAnotherCantModal());
  }

  // ── Challenge vote ───────────────────────────────────────────────────────
  if (customId === 'nmj_vote_success' || customId === 'nmj_vote_fail') {
    if (game.status !== 'playing' || !game.challengeState) {
      return interaction.reply({ content: 'There is no active challenge vote.', flags: MessageFlags.Ephemeral });
    }
    if (!game.alivePlayers().includes(user.id)) {
      return interaction.reply({ content: 'You are not an active player.', flags: MessageFlags.Ephemeral });
    }
    const vote = customId === 'nmj_vote_success' ? 'success' : 'fail';
    const ch = game.challengeState;
    ch.votes.set(user.id, vote);

    await interaction.deferUpdate();

    const alive = game.alivePlayers();
    const allVoted = alive.every(id => ch.votes.has(id));
    if (!allVoted) {
      persistGame(client, game);
      return updateGameMessage(game, client);
    }

    // All votes are in — the outcome is decided. Now that discussion is over,
    // clear the challenged player's messages so the next round starts fresh.
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    if (thread) await purgeThreadMessages(thread, game.messageId, game.pendingMove?.playerId);

    // Tally votes; tiebreak uses the original (challenged) player's vote.
    let successCount = 0;
    let failCount = 0;
    for (const v of ch.votes.values()) {
      if (v === 'success') successCount++; else failCount++;
    }
    const pending = game.pendingMove;
    let outcome;
    if (successCount > failCount) outcome = 'success';
    else if (failCount > successCount) outcome = 'fail';
    else outcome = ch.votes.get(pending.playerId) === 'success' ? 'success' : 'fail';

    if (outcome === 'success') {
      game.eliminatedPlayers.push(pending.playerId);
      game.challengeCounts.set(ch.challengerId, (game.challengeCounts.get(ch.challengerId) ?? 0) + 1);
      const eliminatedIdx = game.players.indexOf(pending.playerId);
      clearPendingMove(game);
      persistGame(client, game);

      if (checkForWinner(game)) {
        const winner = game.alivePlayers()[0];
        return endGame(game, client, winner ? `🏆 <@${winner}> wins No More Jockeys!` : '🏁 The game has ended — no players remain.');
      }

      const idx = nextAliveIndex(game, eliminatedIdx);
      if (idx !== -1) game.currentPlayerIndex = idx;
      persistGame(client, game);
      return updateGameMessage(game, client);
    }

    // Unsuccessful challenge — challenger's token stays spent, move returns to Accept stage.
    game.pendingMove.stage = 'respond';
    game.acceptedPlayers = new Set();
    game.challengeState = null;
    persistGame(client, game);
    return updateGameMessage(game, client);
  }

  return interaction.reply({ content: 'Unknown action.', flags: MessageFlags.Ephemeral });
}

// ── Modal handlers ───────────────────────────────────────────────────────────

async function handleModal(interaction, client, game) {
  const { customId, user } = interaction;

  if (customId === 'nmj_move_modal') {
    if (game.status !== 'playing' || game.pendingMove || user.id !== game.currentPlayerId()) {
      return interaction.reply({ content: 'It is no longer your turn to declare a move.', flags: MessageFlags.Ephemeral });
    }
    const celeb = interaction.fields.getTextInputValue('nmj_celeb').trim();
    const category = interaction.fields.getTextInputValue('nmj_category').trim();
    if (!celeb || !category) {
      return interaction.reply({ content: 'Both fields are required.', flags: MessageFlags.Ephemeral });
    }
    game.pendingMove = { playerId: user.id, celebs: [celeb], category, stage: 'respond' };
    game.acceptedPlayers = new Set();
    persistGame(client, game);
    await interaction.deferUpdate();
    return updateGameMessage(game, client);
  }

  if (customId === 'nmj_challenge_modal') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'respond') {
      return interaction.reply({ content: 'There is nothing to challenge right now.', flags: MessageFlags.Ephemeral });
    }
    if (!game.alivePlayers().includes(user.id)) {
      return interaction.reply({ content: 'You are not an active player.', flags: MessageFlags.Ephemeral });
    }
    if (user.id === game.pendingMove.playerId) {
      return interaction.reply({ content: 'You cannot challenge your own move.', flags: MessageFlags.Ephemeral });
    }
    const tokens = game.challengeCounts.get(user.id) ?? 0;
    if (tokens <= 0) {
      return interaction.reply({ content: 'You have no challenge tokens remaining.', flags: MessageFlags.Ephemeral });
    }
    const claimText = interaction.fields.getTextInputValue('nmj_challenge_category').trim();
    const { category: matched } = findBestCategoryMatch(claimText, game.bannedCategories);

    game.challengeCounts.set(user.id, tokens - 1);
    game.challengeState = {
      challengerId: user.id,
      claimedCategoryText: claimText,
      matchedCategory: matched,
      votes: new Map(),
      voteLocked: false,
    };
    persistGame(client, game);
    await interaction.deferUpdate();
    return updateGameMessage(game, client);
  }

  if (customId === 'nmj_na_provide_modal') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'name_another' || user.id !== game.pendingMove.playerId) {
      return interaction.reply({ content: 'This is not currently required.', flags: MessageFlags.Ephemeral });
    }
    const celeb = interaction.fields.getTextInputValue('nmj_na_celeb').trim();
    if (!celeb) return interaction.reply({ content: 'A celebrity name is required.', flags: MessageFlags.Ephemeral });
    game.pendingMove.celebs.push(celeb);
    game.pendingMove.stage = 'respond';
    game.nameAnotherRequired = false;
    game.acceptedPlayers = new Set();
    persistGame(client, game);
    await interaction.deferUpdate();
    return updateGameMessage(game, client);
  }

  if (customId === 'nmj_na_cant_modal') {
    if (game.status !== 'playing' || game.pendingMove?.stage !== 'name_another' || user.id !== game.pendingMove.playerId) {
      return interaction.reply({ content: 'This is not currently required.', flags: MessageFlags.Ephemeral });
    }
    const newCategory = interaction.fields.getTextInputValue('nmj_na_new_category').trim();
    if (!newCategory) return interaction.reply({ content: 'A category is required.', flags: MessageFlags.Ephemeral });
    game.pendingMove.category = newCategory;
    game.pendingMove.stage = 'respond';
    game.nameAnotherRequired = false;
    game.acceptedPlayers = new Set();
    persistGame(client, game);
    await interaction.deferUpdate();
    return updateGameMessage(game, client);
  }

  return interaction.reply({ content: 'Unknown submission.', flags: MessageFlags.Ephemeral });
}

module.exports = {
  name: 'interactionCreate',
  endGame,
  updateGameMessage,
  purgeThreadMessages,

  async execute(interaction, client) {
    const { channelId } = interaction;

    if (interaction.isButton()) {
      const { customId } = interaction;
      if (!customId.startsWith('nmj_')) return;
      const game = client.nmjManager.getGame(channelId);
      if (!game) {
        return interaction.reply({ content: 'There is no active No More Jockeys game in this thread.', flags: MessageFlags.Ephemeral });
      }
      try {
        return await handleButton(interaction, client, game);
      } catch (error) {
        console.error('[NMJ button error]', error);
        const payload = { content: '❌ Something went wrong — please try again.', flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const { customId } = interaction;
      if (!customId.startsWith('nmj_')) return;
      const game = client.nmjManager.getGame(channelId);
      if (!game) {
        return interaction.reply({ content: 'There is no active No More Jockeys game in this thread.', flags: MessageFlags.Ephemeral });
      }
      try {
        return await handleModal(interaction, client, game);
      } catch (error) {
        console.error('[NMJ modal error]', error);
        const payload = { content: '❌ Something went wrong — please try again.', flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
    }
  },
};
