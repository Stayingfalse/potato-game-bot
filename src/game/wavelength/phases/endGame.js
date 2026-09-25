'use strict';

const { MessageFlags } = require('discord.js');
const WavelengthRepository = require('../../../db/WavelengthRepository');
const { evaluateSessionGoal, computeSessionTotals } = require('./sessionEnd');

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

  // The cluing/guessing message is a dead end once results are in — give the
  // round's outcome its own fresh message instead of editing something players
  // have likely already scrolled past, and leave a pointer behind on the old one.
  const previousRoundMessageId = game.roundMessageId;
  game.roundMessageId = null;
  WavelengthRepository.upsert(game);

  const { updateGameMessage } = require('../interactionHandler');
  await updateGameMessage(game, client);

  if (previousRoundMessageId && game.roundMessageId && previousRoundMessageId !== game.roundMessageId) {
    const thread = await client.channels.fetch(game.threadId).catch(() => null);
    const oldMessage = await thread?.messages.fetch(previousRoundMessageId).catch(() => null);
    if (oldMessage) {
      const { createContainer } = require('../render');
      const resultsUrl = `https://discord.com/channels/${game.guildId}/${game.threadId}/${game.roundMessageId}`;
      await oldMessage.edit({
        components: [createContainer(`✅ Guessing closed — results are in: ${resultsUrl}`, 0x2ECC71)],
        attachments: [],
      }).catch(() => {});
    }
  }

  scheduleAutoAdvance(game, client);
}

async function closeSession(game, client, reason) {
  if (!game) return;

  clearGameTimers(game);
  game.phase = 'ended';
  WavelengthRepository.upsert(game);

  const thread = await client.channels.fetch(game.threadId).catch(() => null);
  if (thread) {
    const { createContainer } = require('../render');
    const cumulative = computeSessionTotals(game);
    const goal = evaluateSessionGoal(game);

    const standingsText = cumulative.length > 0
      ? cumulative.map((entry, idx) => `**${idx + 1}.** <@${entry.userId}> — **${entry.total} pts**`).join('\n')
      : '*No scores recorded this session.*';

    const closingText = [
      '## 〰️ Wavelength — Session Closed',
      reason,
      '',
      '**📈 Final Standings**',
      standingsText,
      goal.complete && goal.message ? `\n**🏁 Goal Reached**\n${goal.message}` : null,
    ].filter(Boolean).join('\n');

    await thread.send({
      components: [createContainer(closingText, 0x95A5A6)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});

    // Give players a few seconds to read the final closing message before the
    // thread is locked and archived. Runs detached so callers don't block on it.
    setTimeout(async () => {
      await thread.setLocked(true).catch(() => {});
      await thread.setArchived(true).catch(() => {});
    }, 5_000);
  }

  client.wavelengthManager.deleteGame(game.threadId);
}

module.exports = {
  clearGameTimers,
  scheduleAutoAdvance,
  endGame,
  closeSession,
};
