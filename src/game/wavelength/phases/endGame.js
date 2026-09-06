'use strict';

const WavelengthRepository = require('../../../db/WavelengthRepository');
const { evaluateSessionGoal } = require('./sessionEnd');

function clearGameTimers(game) {
  if (game.guessTimeout) {
    clearTimeout(game.guessTimeout);
    game.guessTimeout = null;
  }
  if (game.autoAdvanceTimeout) {
    clearTimeout(game.autoAdvanceTimeout);
    game.autoAdvanceTimeout = null;
  }
}

function scheduleAutoAdvance(game, client) {
  const goal = evaluateSessionGoal(game);
  if (game.phase !== 'ended' || !game.autoAdvanceRounds || goal.complete || game.autoAdvanceTimeout) return false;

  game.autoAdvanceTimeout = setTimeout(async () => {
    game.autoAdvanceTimeout = null;
    if (game.phase !== 'ended') return;
    const { startConfiguredRound } = require('../interactionHandler');
    const resetGame = client.wavelengthManager.resetForRematch(game.threadId, false);
    if (!resetGame) return;
    await startConfiguredRound(resetGame, client);
  }, 5_000);

  WavelengthRepository.upsert(game);
  return true;
}

async function endGame(game, client) {
  if (game.phase === 'ended') return;
  game.phase = 'ended';
  clearGameTimers(game);
  WavelengthRepository.upsert(game);

  const { updateGameMessage } = require('../interactionHandler');
  await updateGameMessage(game, client);
  scheduleAutoAdvance(game, client);
}

async function closeSession(game, client, reason) {
  if (!game) return;

  clearGameTimers(game);
  game.phase = 'ended';
  WavelengthRepository.upsert(game);

  const thread = await client.channels.fetch(game.threadId).catch(() => null);
  if (thread) {
    const { updateGameMessage } = require('../interactionHandler');
    await updateGameMessage(game, client, {
      resultText: reason,
      closedReason: reason,
      includeControls: false,
    }, thread);
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
  }

  client.wavelengthManager.deleteGame(game.threadId);
}

module.exports = {
  clearGameTimers,
  scheduleAutoAdvance,
  endGame,
  closeSession,
};
