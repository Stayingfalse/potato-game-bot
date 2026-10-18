'use strict';

const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const { MIN_PLAYERS } = require('./manager');
const { renderGameMessage, renderSessionStarted, renderCuePanel, renderGuessPanel, occupantName } = require('./render');
const {
  CLUE_TURN_CHOICES, POINT_CHOICES, CLUE_WORD_LIMITS, validateClue, isModeComplete, evaluateSessionGoal, firstTokenOwnerAt,
} = require('./rules');
const { parseCell, formatCell } = require('./board');
const flow = require('./flow');
const { fetchChannel } = require('../_core/threads');

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

/*
 * Each handler gets the game for the thread the button was pressed in. Buttons
 * on the game message redraw it with interaction.update(); buttons on a private
 * panel (the cue giver's card, a guesser's token) redraw that panel. Errors
 * thrown here are caught by the router, which logs them and tells the player
 * something went wrong.
 */

// ── Lobby ──────────────────────────────────────────────────────────────────────

async function handleJoin(interaction, client, game) {
  const manager = client.huesCluesManager;
  if (game.phase !== 'lobby') return reply(interaction, 'This game has already started.');
  if (!manager.addPlayer(game.threadId, interaction.user)) {
    return reply(interaction, game.players.size >= manager.maxPlayers ? 'The game is full.' : 'You are already in the game.');
  }
  const thread = await fetchChannel(client, game.threadId);
  await thread?.members.add(interaction.user.id).catch(() => {});
  return interaction.update(await renderGameMessage(game));
}

async function handleLeave(interaction, client, game) {
  if (!client.huesCluesManager.removePlayer(game.threadId, interaction.user.id)) {
    return reply(interaction, 'You are not in the lobby.');
  }
  return interaction.update(await renderGameMessage(game));
}

async function handleStart(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can start the game.');
  if (game.phase !== 'lobby') return reply(interaction, 'This game has already started.');
  if (game.players.size < MIN_PLAYERS) {
    return reply(interaction, `Need at least **${MIN_PLAYERS} players** to start. Currently: **${game.players.size}**.`);
  }
  client.huesCluesManager.beginSetup(game);
  return interaction.update(await renderGameMessage(game));
}

async function handleCancel(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can cancel the game.');
  if (game.phase !== 'lobby') return reply(interaction, 'This game has already started.');
  await interaction.deferUpdate();
  return flow.closeSession(game, client, `✖️ Cancelled by <@${interaction.user.id}> before the game started.`);
}

// ── Setup ──────────────────────────────────────────────────────────────────────

/** Wraps a setup action: host only, during setup, then redraws the setup message. */
function setupAction(action) {
  return async (interaction, client, game, arg) => {
    if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can set up the game.');
    if (game.phase !== 'setup') return reply(interaction, 'The game has already started.');
    const error = action(client.huesCluesManager, game, arg);
    if (error) return reply(interaction, error);
    return interaction.update(await renderGameMessage(game));
  };
}

const handleModeTurns = setupAction((manager, game) => { manager.setSessionMode(game, { type: 'clue_turns', target: null }); });
const handleModePoints = setupAction((manager, game) => { manager.setSessionMode(game, { type: 'first_to_points', target: null }); });
const handleModeEndless = setupAction((manager, game) => { manager.setSessionMode(game, { type: 'endless' }); });
const handleModeBack = setupAction((manager, game) => { manager.setSessionMode(game, null); });
const handleReshuffle = setupAction((manager, game) => { manager.reshuffle(game); });

const handleTarget = setupAction((manager, game, value) => {
  const mode = game.sessionMode;
  const choices = mode?.type === 'clue_turns' ? CLUE_TURN_CHOICES : mode?.type === 'first_to_points' ? POINT_CHOICES : [];
  const target = Number(value);
  if (!choices.includes(target)) return 'Choose a mode first.';
  manager.setSessionMode(game, { ...mode, target });
});

async function handleBegin(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can start the game.');
  if (game.phase !== 'setup') return reply(interaction, 'The game has already started.');
  if (!isModeComplete(game.sessionMode)) return reply(interaction, 'Choose a session mode first.');
  await interaction.update(renderSessionStarted(game));
  return flow.startTurn(game, client);
}

async function handleToggleAuto(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can change auto-advance.');
  if (game.phase === 'lobby') return reply(interaction, 'Start the game first.');
  await flow.toggleAutoAdvance(game, client);
  return interaction.update(await renderGameMessage(game));
}

// ── The cue giver ──────────────────────────────────────────────────────────────

function cueGiverError(interaction, game, phases) {
  if (interaction.user.id !== game.cueGiverId) return 'Only the cue giver can do that.';
  if (!phases.includes(game.phase)) return 'That isn\'t available right now.';
  return null;
}

async function handleCuePanel(interaction, client, game) {
  const error = cueGiverError(interaction, game, ['picking', 'guessing', 'followup']);
  if (error) return reply(interaction, error);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return interaction.editReply(await renderCuePanel(game));
}

async function handlePick(interaction, client, game, index) {
  const error = cueGiverError(interaction, game, ['picking']);
  if (error) return reply(interaction, error);
  client.huesCluesManager.pickColour(game, Number(index));
  await interaction.deferUpdate();
  return interaction.editReply(await renderCuePanel(game));
}

function clueModal(clueNumber) {
  const words = CLUE_WORD_LIMITS[clueNumber - 1];
  return new ModalBuilder()
    .setCustomId(`hc_clue${clueNumber}_modal`)
    .setTitle(clueNumber === 1 ? 'Your One-Word Clue' : 'Your Second Clue')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('hc_clue_input')
        .setLabel(`Up to ${words} word${words === 1 ? '' : 's'} — no colour names`)
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(40)
        .setRequired(true),
    ));
}

async function handleClue1(interaction, client, game) {
  const error = cueGiverError(interaction, game, ['picking']);
  if (error) return reply(interaction, error);
  if (game.targetIndex === null) return reply(interaction, 'Pick a colour from your card first.');
  return interaction.showModal(clueModal(1));
}

async function handleClue2(interaction, client, game) {
  const error = cueGiverError(interaction, game, ['followup']);
  if (error) return reply(interaction, error);
  return interaction.showModal(clueModal(2));
}

/** Clue modals: clue 1 is sent from the cue giver's panel, clue 2 from the game message. */
async function handleClueModal(interaction, client, game, clueNumber) {
  const error = cueGiverError(interaction, game, [clueNumber === 1 ? 'picking' : 'followup']);
  if (error) return reply(interaction, error);
  const result = validateClue(interaction.fields.getTextInputValue('hc_clue_input'), clueNumber);
  if (!result.ok) return reply(interaction, `❌ ${result.error} Try again.`);
  if (!client.huesCluesManager.giveClue(game, clueNumber, result.clue)) return reply(interaction, 'That clue has already been given.');

  await interaction.deferUpdate();
  if (clueNumber === 1) await interaction.editReply(await renderCuePanel(game));
  return flow.openGuessRound(game, client);
}

async function handleNoMore(interaction, client, game) {
  const error = cueGiverError(interaction, game, ['followup']);
  if (error) return reply(interaction, error);
  if (!client.huesCluesManager.giveClue(game, 2, null)) return reply(interaction, 'That clue has already been given.');
  await interaction.deferUpdate();
  return flow.openGuessRound(game, client);
}

// ── Guessers ───────────────────────────────────────────────────────────────────

function guesserError(interaction, game) {
  if (interaction.user.id === game.cueGiverId) return 'You\'re the cue giver this turn — sit tight!';
  if (!game.tokens.has(interaction.user.id)) return 'You are not playing in this game.';
  if (game.phase !== 'guessing') return 'Tokens can\'t be placed right now.';
  return null;
}

function lockedError(game, userId) {
  return game.tokens.get(userId).cells.length >= game.guessRound ? 'Your token is already locked in for this round.' : null;
}

/** Second tokens can't go on a square that already has a first token. */
function occupiedError(game, userId, cell) {
  const occupant = firstTokenOwnerAt(game, cell);
  if (!occupant) return null;
  return `❌ **${formatCell(cell)}** already has ${occupantName(game, occupant, userId)} first token. Second tokens must go on a free square — pick another.`;
}

async function handleGuessPanel(interaction, client, game) {
  const error = guesserError(interaction, game);
  if (error) return reply(interaction, error);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return interaction.editReply(await renderGuessPanel(game, interaction.user.id));
}

const MOVES = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };

async function handleMove(interaction, client, game, direction) {
  const userId = interaction.user.id;
  const error = guesserError(interaction, game) ?? lockedError(game, userId);
  if (error) return reply(interaction, error);
  const [dr, dc] = MOVES[direction] ?? [0, 0];
  const from = client.huesCluesManager.draftOf(game, userId);
  client.huesCluesManager.setDraft(game, userId, { row: from.row + dr, col: from.col + dc });
  await interaction.deferUpdate();
  return interaction.editReply(await renderGuessPanel(game, userId));
}

async function handleTypeRef(interaction, client, game) {
  const error = guesserError(interaction, game) ?? lockedError(game, interaction.user.id);
  if (error) return reply(interaction, error);
  return interaction.showModal(new ModalBuilder()
    .setCustomId('hc_ref_modal')
    .setTitle('Move Your Token')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('hc_ref_input')
        .setLabel('Grid ref: row A–P and column 1–30')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. F12')
        .setMinLength(2)
        .setMaxLength(5)
        .setRequired(true),
    )));
}

async function handleRefModal(interaction, client, game) {
  const userId = interaction.user.id;
  const error = guesserError(interaction, game) ?? lockedError(game, userId);
  if (error) return reply(interaction, error);
  const cell = parseCell(interaction.fields.getTextInputValue('hc_ref_input'));
  if (!cell) return reply(interaction, '❌ That isn\'t a square on the board. Use a row **A–P** and a column **1–30**, like `F12`.');
  const occupied = occupiedError(game, userId, cell);
  if (occupied) return reply(interaction, occupied);
  client.huesCluesManager.setDraft(game, userId, cell);
  await interaction.deferUpdate();
  return interaction.editReply(await renderGuessPanel(game, userId));
}

async function handleLock(interaction, client, game) {
  const userId = interaction.user.id;
  const error = guesserError(interaction, game) ?? lockedError(game, userId)
    ?? occupiedError(game, userId, client.huesCluesManager.draftOf(game, userId));
  if (error) return reply(interaction, error);
  client.huesCluesManager.lockIn(game, userId);
  await interaction.deferUpdate();
  await interaction.editReply(await renderGuessPanel(game, userId));
  return flow.afterLockIn(game, client);
}

async function handleForceLock(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can lock the remaining tokens.');
  if (game.phase !== 'guessing') return reply(interaction, 'Tokens can\'t be placed right now.');
  await interaction.deferUpdate();
  client.huesCluesManager.lockRemaining(game);
  return flow.afterLockIn(game, client);
}

// ── After a turn ───────────────────────────────────────────────────────────────

async function handleNext(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can start the next turn.');
  if (game.phase !== 'ended') return reply(interaction, 'This turn is still going.');
  if (evaluateSessionGoal(game).complete) {
    return reply(interaction, '🏁 The session is over. Choose **New Game (Open Signups)** or **End Game & Close Session**.');
  }
  await interaction.deferUpdate();
  return flow.nextTurn(game, client);
}

async function handleNewGame(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can open sign-ups for a new game.');
  if (game.phase !== 'ended') return reply(interaction, 'This turn is still going.');
  await interaction.deferUpdate();
  return flow.newSession(game, client);
}

async function handleClose(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can close the session.');
  await interaction.deferUpdate();
  return flow.closeSession(game, client, `🔒 Session closed by <@${interaction.user.id}>. Thanks for playing Hues & Clues!`);
}

/** customId → handler. Add a line here for every new button. */
const BUTTONS = {
  hc_join: handleJoin,
  hc_leave: handleLeave,
  hc_start: handleStart,
  hc_cancel: handleCancel,
  hc_mode_turns: handleModeTurns,
  hc_mode_points: handleModePoints,
  hc_mode_endless: handleModeEndless,
  hc_mode_back: handleModeBack,
  hc_reshuffle: handleReshuffle,
  hc_begin: handleBegin,
  hc_toggle_auto: handleToggleAuto,
  hc_cue_panel: handleCuePanel,
  hc_clue1: handleClue1,
  hc_clue2: handleClue2,
  hc_no_more: handleNoMore,
  hc_guess_panel: handleGuessPanel,
  hc_type_ref: handleTypeRef,
  hc_lock: handleLock,
  hc_force_lock: handleForceLock,
  hc_next: handleNext,
  hc_new_game: handleNewGame,
  hc_close: handleClose,
};

/** Buttons that carry a value in their customId: prefix → handler(…, value). */
const BUTTONS_WITH_VALUE = {
  hc_target_: handleTarget,
  hc_pick_: handlePick,
  hc_move_: handleMove,
};

const MODALS = {
  hc_clue1_modal: (interaction, client, game) => handleClueModal(interaction, client, game, 1),
  hc_clue2_modal: (interaction, client, game) => handleClueModal(interaction, client, game, 2),
  hc_ref_modal: handleRefModal,
};

function findHandler(interaction) {
  const { customId } = interaction;
  if (interaction.isModalSubmit()) return MODALS[customId] ? [MODALS[customId]] : null;
  if (!interaction.isButton()) return null;
  if (BUTTONS[customId]) return [BUTTONS[customId]];
  const prefix = Object.keys(BUTTONS_WITH_VALUE).find(p => customId.startsWith(p));
  return prefix ? [BUTTONS_WITH_VALUE[prefix], customId.slice(prefix.length)] : null;
}

/** Entry point for every interaction whose customId starts with the manifest's prefix. */
async function handleInteraction(interaction, client) {
  const found = findHandler(interaction);
  if (!found) return;

  const game = client.huesCluesManager.getGame(interaction.channelId);
  if (!game) return reply(interaction, 'There is no active Hues & Clues game in this thread.');
  const [handler, value] = found;
  return handler(interaction, client, game, value);
}

module.exports = { handleInteraction };
