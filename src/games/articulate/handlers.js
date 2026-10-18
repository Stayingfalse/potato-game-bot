'use strict';

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MIN_PLAYERS } = require('./manager');
const { renderGameMessage, renderSessionStarted, renderDescriberPanel } = require('./render');
const { TIMER_GRACE_MS, teamOf } = require('./rules');
const flow = require('./flow');
const { fetchChannel } = require('../_core/threads');

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

/*
 * Each handler gets the game for the thread the interaction came from. Buttons
 * on the session or turn message redraw it; buttons on a describer's private
 * panel go through flow.syncPanels so every describer sees the same card.
 * Errors thrown here are caught by the router, which logs them and tells the
 * player something went wrong.
 */

// ── Lobby ──────────────────────────────────────────────────────────────────────

async function handleJoin(interaction, client, game) {
  const manager = client.articulateManager;
  if (game.phase !== 'lobby') return reply(interaction, 'This game has already started.');
  if (!manager.addPlayer(game.threadId, interaction.user)) {
    return reply(interaction, game.players.size >= manager.maxPlayers ? 'The game is full.' : 'You are already in the game.');
  }
  const thread = await fetchChannel(client, game.threadId);
  await thread?.members.add(interaction.user.id).catch(() => {});
  return interaction.update(await renderGameMessage(game));
}

async function handleLeave(interaction, client, game) {
  if (!client.articulateManager.removePlayer(game.threadId, interaction.user.id)) {
    return reply(interaction, 'You are not in the lobby.');
  }
  return interaction.update(await renderGameMessage(game));
}

async function handleStart(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can start the game.');
  if (game.phase !== 'lobby') return reply(interaction, 'This game has already started.');
  if (game.players.size < MIN_PLAYERS) {
    return reply(interaction, `Need at least **${MIN_PLAYERS} players** to start (two teams of two). Currently: **${game.players.size}**.`);
  }
  client.articulateManager.beginSetup(game);
  return interaction.update(await renderGameMessage(game));
}

async function handleCancel(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can cancel the game.');
  if (game.phase !== 'lobby' && game.phase !== 'setup') return reply(interaction, 'The game has already started — use **Close Session** or `/articulate end`.');
  await interaction.deferUpdate();
  return flow.closeSession(game, client, `✖️ Cancelled by <@${interaction.user.id}> before the game started.`);
}

// ── Setup ──────────────────────────────────────────────────────────────────────

/** Wraps a host-only setup action, then redraws the setup message. */
function hostSetup(action) {
  return async (interaction, client, game, value) => {
    if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can set up the game.');
    if (game.phase !== 'setup') return reply(interaction, 'The game has already started.');
    const error = action(client.articulateManager, game, value, interaction);
    if (error) return reply(interaction, error);
    return interaction.update(await renderGameMessage(game));
  };
}

const handleTeamCount = hostSetup((manager, game, value) => {
  if (!manager.setTeamCount(game, Number(value))) return 'There aren\'t enough players for that many teams (each team needs two).';
});
const handleMethod = hostSetup((manager, game, value) => {
  if (!manager.setTeamMethod(game, value)) return 'There are no teams from a previous game to keep.';
});
const handleReshuffle = hostSetup((manager, game) => { manager.setTeamMethod(game, 'random'); });
const handleNewCaptains = hostSetup((manager, game) => { manager.setTeamMethod(game, 'captains'); });
const handlePlaceRest = hostSetup((manager, game) => { manager.placeRemaining(game); });
const handleTimer = hostSetup((manager, game, value) => { manager.setTurnSeconds(game, Number(value)); });
const handleDescribers = hostSetup((manager, game) => { manager.toggleSingleDescriber(game); });
const handleVoice = hostSetup((manager, game, value, interaction) => { manager.setVoiceChannel(game, interaction.values[0]); });

/** "Pick your team": anyone in the game can join a team. */
async function handleJoinTeam(interaction, client, game, index) {
  if (game.phase !== 'setup' || game.options.teamMethod !== 'choose') return reply(interaction, 'Teams aren\'t being picked that way right now.');
  if (!game.players.has(interaction.user.id)) return reply(interaction, 'You are not in this game.');
  client.articulateManager.joinTeam(game, interaction.user.id, Number(index));
  return interaction.update(await renderGameMessage(game));
}

/** Captains' draft: the captain whose turn it is picks from the menu. */
async function handleDraft(interaction, client, game) {
  const manager = client.articulateManager;
  if (game.phase !== 'setup' || game.options.teamMethod !== 'captains') return reply(interaction, 'There is no draft going on.');
  const captainId = manager.draftCaptain(game);
  if (interaction.user.id !== captainId) return reply(interaction, `It's <@${captainId}>'s pick.`);
  if (!manager.draftPick(game, captainId, interaction.values[0])) return reply(interaction, 'That player has already been picked.');
  return interaction.update(await renderGameMessage(game));
}

async function handleBegin(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can start the game.');
  if (!client.articulateManager.canStart(game)) return reply(interaction, 'Every player needs a team, and every team needs at least two players.');
  client.articulateManager.startGame(game);
  await interaction.update(renderSessionStarted(game));
  return flow.announceTurn(game, client);
}

// ── Describers ─────────────────────────────────────────────────────────────────

function describerError(interaction, game, phases) {
  if (!game.describerIds.includes(interaction.user.id)) return 'Only this turn\'s describers can do that.';
  if (!phases.includes(game.phase)) return 'That isn\'t available right now.';
  return null;
}

/**
 * Acknowledges a press on a describer's panel and redraws every describer's
 * panel. The press becomes that describer's panel handle, so it stays fresh.
 */
async function refreshPanels(interaction, game) {
  await interaction.deferUpdate();
  game.panels.set(interaction.user.id, interaction);
  await flow.syncPanels(game);
}

async function handlePanel(interaction, client, game) {
  const error = describerError(interaction, game, ['ready', 'describing', 'control']);
  if (error) return reply(interaction, error);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  game.panels.set(interaction.user.id, interaction);
  return interaction.editReply(renderDescriberPanel(game));
}

async function handleGo(interaction, client, game) {
  const error = describerError(interaction, game, ['ready']);
  if (error) return reply(interaction, error);
  // Start the clock first so the card shows straight away; the turn message (with its board image) follows.
  client.articulateManager.beginDescribing(game);
  await refreshPanels(interaction, game);
  flow.scheduleTurnTimer(game, client);
  return flow.updateGameMessage(game, client);
}

function timeUp(game) {
  return game.phase !== 'describing' || Date.now() > game.turn.endsAt + TIMER_GRACE_MS;
}

async function handleGotIt(interaction, client, game, cardNumber) {
  const error = describerError(interaction, game, ['describing']);
  if (error) return reply(interaction, error);
  if (timeUp(game)) return reply(interaction, '⏱️ Time\'s up — that one doesn\'t count.');
  if (!client.articulateManager.gotIt(game, Number(cardNumber))) return reply(interaction, 'That card has already been counted.');
  await refreshPanels(interaction, game);
  return flow.updateGameMessage(game, client);
}

async function handlePass(interaction, client, game, cardNumber) {
  const error = describerError(interaction, game, ['describing']);
  if (error) return reply(interaction, error);
  if (timeUp(game)) return reply(interaction, '⏱️ Time\'s up.');
  if (!client.articulateManager.pass(game, Number(cardNumber))) return reply(interaction, 'You can only pass once per turn.');
  await refreshPanels(interaction, game);
  return flow.updateGameMessage(game, client);
}

async function handleControlWin(interaction, client, game, value) {
  const error = describerError(interaction, game, ['control']);
  if (error) return reply(interaction, error);
  const [cardNumber, teamIndex] = value.split('_').map(Number);
  if (game.control.cardNumber !== cardNumber) return reply(interaction, 'That card has already been settled.');
  await interaction.deferUpdate();
  game.panels.set(interaction.user.id, interaction);
  return flow.controlWon(game, client, cardNumber, teamIndex);
}

async function handleControlTie(interaction, client, game, cardNumber) {
  const error = describerError(interaction, game, ['control']);
  if (error) return reply(interaction, error);
  if (!(await flow.controlTie(game, client, Number(cardNumber)))) return reply(interaction, 'That card has already been settled.');
  return refreshPanels(interaction, game);
}

// ── Opponents: calling a foul ──────────────────────────────────────────────────

function foulError(interaction, game) {
  if (game.phase !== 'describing') return 'You can only call a foul while the timer is running.';
  const team = teamOf(game.teams, interaction.user.id);
  if (team === null || team === game.currentTeam) return 'Only the other teams can call a foul.';
  return null;
}

/** A foul forfeits the turn, so it asks to confirm first. */
async function handleFoul(interaction, client, game) {
  const error = foulError(interaction, game);
  if (error) return reply(interaction, error);
  return interaction.reply({
    content: `🚩 Call a foul on Team ${game.team.name}? Their describer broke a rule (said the word or part of it, "sounds like" or "rhymes with", or a letter clue). **The turn is forfeited** and they don't move.`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ar_foul_confirm').setLabel('Call Foul').setEmoji('🚩').setStyle(ButtonStyle.Danger),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleFoulConfirm(interaction, client, game) {
  const error = foulError(interaction, game);
  if (error) return interaction.update({ content: error, components: [] });
  if (!client.articulateManager.foul(game, interaction.user.id)) return interaction.update({ content: 'A foul has already been called.', components: [] });
  await interaction.update({ content: '🚩 Foul called.', components: [] });
  return flow.finishDescribing(game, client);
}

// ── Spin squares ───────────────────────────────────────────────────────────────

function currentTeamError(interaction, game) {
  if (game.phase !== 'spin') return 'There\'s nothing to spin right now.';
  if (!game.team.playerIds.includes(interaction.user.id)) return `Only Team ${game.team.name} can do that.`;
  return null;
}

async function handleSpin(interaction, client, game) {
  const error = currentTeamError(interaction, game);
  if (error) return reply(interaction, error);
  if (game.spinResult) return reply(interaction, 'You\'ve already spun.');
  await interaction.deferUpdate();
  return flow.spin(game, client);
}

async function handleBonus(interaction, client, game, teamIndex) {
  const error = currentTeamError(interaction, game);
  if (error) return reply(interaction, error);
  await interaction.deferUpdate();
  return flow.applyBonus(game, client, Number(teamIndex));
}

// ── After a game ───────────────────────────────────────────────────────────────

function hostEnded(action) {
  return async (interaction, client, game) => {
    if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can do that.');
    if (game.phase !== 'ended') return reply(interaction, 'The game is still going.');
    await interaction.update(await renderGameMessage(game, { includeControls: false }));
    return action(game, client);
  };
}

async function handleClose(interaction, client, game) {
  if (interaction.user.id !== game.hostId) return reply(interaction, 'Only the host can close the session.');
  await interaction.deferUpdate();
  return flow.closeSession(game, client, `🔒 Session closed by <@${interaction.user.id}>. Thanks for playing Articulate!`);
}

/** customId → handler. Add a line here for every new button. */
const BUTTONS = {
  ar_join: handleJoin,
  ar_leave: handleLeave,
  ar_start: handleStart,
  ar_cancel: handleCancel,
  ar_reshuffle: handleReshuffle,
  ar_new_captains: handleNewCaptains,
  ar_place_rest: handlePlaceRest,
  ar_describers: handleDescribers,
  ar_begin: handleBegin,
  ar_panel: handlePanel,
  ar_go: handleGo,
  ar_foul: handleFoul,
  ar_foul_confirm: handleFoulConfirm,
  ar_spin: handleSpin,
  ar_rematch: hostEnded(flow.rematch),
  ar_new_game: hostEnded(flow.newGame),
  ar_close: handleClose,
};

/** Buttons that carry a value in their customId: prefix → handler(…, value). Longer prefixes first. */
const BUTTONS_WITH_VALUE = {
  ar_join_team_: handleJoinTeam,
  ar_teams_: handleTeamCount,
  ar_method_: handleMethod,
  ar_timer_: handleTimer,
  ar_got_: handleGotIt,
  ar_pass_: handlePass,
  ar_win_: handleControlWin,
  ar_tie_: handleControlTie,
  ar_bonus_: handleBonus,
};

const SELECTS = {
  ar_draft: handleDraft,
  ar_voice: handleVoice,
};

function findHandler(interaction) {
  const { customId } = interaction;
  if (interaction.isStringSelectMenu?.() || interaction.isChannelSelectMenu?.()) return SELECTS[customId] ? [SELECTS[customId]] : null;
  if (!interaction.isButton()) return null;
  if (BUTTONS[customId]) return [BUTTONS[customId]];
  const prefix = Object.keys(BUTTONS_WITH_VALUE).find(p => customId.startsWith(p));
  return prefix ? [BUTTONS_WITH_VALUE[prefix], customId.slice(prefix.length)] : null;
}

/** Entry point for every interaction whose customId starts with the manifest's prefix. */
async function handleInteraction(interaction, client) {
  const found = findHandler(interaction);
  if (!found) return;

  const game = client.articulateManager.getGame(interaction.channelId);
  if (!game) return reply(interaction, 'There is no active Articulate game in this thread.');
  const [handler, value] = found;
  return handler(interaction, client, game, value);
}

module.exports = { handleInteraction };
