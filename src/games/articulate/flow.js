'use strict';

/**
 * Phase changes and the game messages. Shared by the button handlers, the
 * slash command and restore, so each step happens the same way from anywhere.
 *
 * Lobby and setup use the session message (game.messageId). Each turn then
 * gets its own message (game.turnMessageId), edited as the turn goes on and
 * left as a one-block summary when the next team's turn is posted.
 */

const { recordTurn, recordGame } = require('./stats');
const { renderGameMessage, renderTurnSummary, renderClosed, renderDescriberPanel } = require('./render');
const { spin: spinTheSpinner } = require('./board');
const { TIMER_GRACE_MS } = require('./rules');
const { fetchChannel, lockAndArchive } = require('../_core/threads');
const { editMessage, editOrSend } = require('../_core/messages');

const TURN_PHASES = ['ready', 'describing', 'spin', 'control', 'turnover', 'ended'];
const managerOf = client => client.articulateManager;

/** The current team's players who aren't in the game's voice channel (empty if that can't be told). */
async function voiceMissing(game, client) {
  if (!game.options.voiceChannelId || !game.team || game.phase !== 'ready') return [];
  const channel = await fetchChannel(client, game.options.voiceChannelId);
  const members = channel?.members;
  if (!members?.has) return [];
  return game.team.playerIds.filter(id => !members.has(id));
}

/** Re-renders the current message in place, or posts it if it doesn't exist yet. */
async function updateGameMessage(game, client) {
  const thread = await fetchChannel(client, game.threadId);
  if (!thread) return false;
  const useTurnMessage = TURN_PHASES.includes(game.phase);
  const payload = await renderGameMessage(game, { voiceMissing: await voiceMissing(game, client) });
  const result = await editOrSend(thread, useTurnMessage ? game.turnMessageId : game.messageId, payload);
  if (!result) return false;
  if (result.created) {
    if (useTurnMessage) game.turnMessageId = result.message.id;
    else game.messageId = result.message.id;
    managerOf(client).save(game);
  }
  return true;
}

/** Posts a ping in the thread for `userIds`, linking to the current turn message. */
async function ping(game, client, userIds, text) {
  if (userIds.length === 0) return;
  const thread = await fetchChannel(client, game.threadId);
  const url = `https://discord.com/channels/${game.guildId}/${game.threadId}/${game.turnMessageId}`;
  await thread?.send({
    content: `${userIds.map(id => `<@${id}>`).join(' ')} — ${text} ${url}`,
    allowedMentions: { users: userIds },
  }).catch(() => {});
}

/**
 * Keeps every open describer panel showing the same card. Panels are the
 * describers' own private messages, edited through the interaction that opened them.
 */
async function syncPanels(game, except = null) {
  const payload = renderDescriberPanel(game);
  await Promise.all([...game.panels].map(async ([userId, interaction]) => {
    if (interaction === except) return;
    if (!game.describerIds.includes(userId)) {
      game.panels.delete(userId);
      return;
    }
    await interaction.editReply(payload).catch(() => game.panels.delete(userId));
  }));
}

/** Posts the new turn's message and calls the describers. */
async function announceTurn(game, client) {
  await updateGameMessage(game, client);
  if (game.phase === 'control') {
    const everyone = game.teams.flatMap(team => team.playerIds);
    await ping(game, client, everyone, `♠ ${game.team.name} are on the finish — Control round, every team can guess:`);
  } else {
    await ping(game, client, game.describerIds, `you're describing for Team ${game.team.name}! Open your panel here:`);
  }
}

// ── The timed part of a turn ───────────────────────────────────────────────────

/** Arms the end of the timer from `game.turn.endsAt`. Restore calls this too, so a restarted turn gets only the time it had left. */
function scheduleTurnTimer(game, client) {
  managerOf(client).clearTimers(game);
  if (game.phase !== 'describing') return;
  game.turnTimeout = setTimeout(() => {
    game.turnTimeout = null;
    finishDescribing(game, client).catch(err => console.error('[Articulate] Timer error:', err));
  }, Math.max(0, game.turn.endsAt + TIMER_GRACE_MS - Date.now()));
}

/** The timer ran out (or a foul was called): move the team, then a Control round, a spin, or the next team. */
async function finishDescribing(game, client) {
  const result = managerOf(client).finishDescribing(game);
  if (!result) return;
  await syncPanels(game);
  if (result.next === 'control') {
    await updateGameMessage(game, client);
    const others = game.teams.filter(team => team !== game.team).flatMap(team => team.playerIds);
    return ping(game, client, others, '♠ Control round — every team can guess:');
  }
  if (result.next === 'spin') return updateGameMessage(game, client);
  return endTurn(game, client);
}

// ── Spin squares and Control rounds ────────────────────────────────────────────

async function spin(game, client) {
  if (!managerOf(client).spin(game, spinTheSpinner())) return false;
  if (game.spinResult.steps === 0) return endTurn(game, client);
  return updateGameMessage(game, client);
}

async function applyBonus(game, client, teamIndex) {
  if (!managerOf(client).applyBonus(game, teamIndex)) return false;
  return endTurn(game, client);
}

async function controlWon(game, client, cardNumber, teamIndex) {
  const outcome = managerOf(client).controlWon(game, cardNumber, teamIndex);
  if (!outcome) return false;
  await syncPanels(game);
  if (outcome === 'next') return endTurn(game, client);

  // The game is won: the turn message keeps the summary and the result is posted below it.
  const summary = renderTurnSummary(game);
  const turnMessageId = game.turnMessageId;
  recordTurn(game);
  recordGame(game);
  game.turnMessageId = null;
  game.panels.clear();
  managerOf(client).save(game);
  await editMessage(await fetchChannel(client, game.threadId), turnMessageId, summary);
  await updateGameMessage(game, client);
  return true;
}

async function controlTie(game, client, cardNumber) {
  if (!managerOf(client).controlTie(game, cardNumber)) return false;
  await syncPanels(game);
  return true;
}

/** Leaves a summary on the finished turn's message and starts the next team's turn. */
async function endTurn(game, client) {
  if (game.phase !== 'turnover') return;
  // Work out everything from this turn before the state moves on, so a second
  // call racing this one finds the phase already changed and does nothing.
  const summary = renderTurnSummary(game);
  const turnMessageId = game.turnMessageId;
  recordTurn(game);
  managerOf(client).nextTurn(game);
  game.panels.clear();
  await editMessage(await fetchChannel(client, game.threadId), turnMessageId, summary);
  await announceTurn(game, client);
}

// ── Between games ──────────────────────────────────────────────────────────────

async function rematch(game, client) {
  if (!managerOf(client).rematch(game)) return false;
  await announceTurn(game, client);
  return true;
}

/** Opens a fresh lobby at the bottom of the thread with the same players. */
async function newGame(game, client) {
  if (!managerOf(client).newGame(game)) return false;
  game.messageId = null;
  await updateGameMessage(game, client);
  return true;
}

/** Ends the session from any phase: final positions, archive the thread, delete the game. */
async function closeSession(game, client, reason) {
  managerOf(client).clearTimers(game);
  const thread = await fetchChannel(client, game.threadId);
  if (thread) {
    await thread.send(renderClosed(game, reason)).catch(() => {});
    lockAndArchive(thread, { delayMs: 5_000 });
  }
  managerOf(client).deleteGame(game.threadId);
}

module.exports = {
  updateGameMessage,
  syncPanels,
  announceTurn,
  scheduleTurnTimer,
  finishDescribing,
  spin,
  applyBonus,
  controlWon,
  controlTie,
  endTurn,
  rematch,
  newGame,
  closeSession,
};
