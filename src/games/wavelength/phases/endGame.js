'use strict';

const { MessageFlags } = require('discord.js');
const WavelengthRepository = require('../repository');
const card = require('../card');
const { fetchChannel, lockAndArchive } = require('../../_core/threads');
const { editMessage } = require('../../_core/messages');
const { evaluateSessionGoal, computeSessionTotals } = require('./sessionEnd');

function scheduleAutoAdvance(game, client) {
  const goal = evaluateSessionGoal(game);
  if (game.phase !== 'ended' || !game.autoAdvanceRounds || goal.complete || game.autoAdvanceTimeout) return false;

  game.autoAdvanceTimeout = setTimeout(async () => {
    game.autoAdvanceTimeout = null;
    if (game.phase !== 'ended') return;
    const { startConfiguredRound } = require('../handlers');
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
  client.wavelengthManager.clearTimers(game);

  // The cluing/guessing message is a dead end once results are in — give the
  // round's outcome its own fresh message instead of editing something players
  // have likely already scrolled past, and leave a pointer behind on the old one.
  const previousRoundMessageId = game.roundMessageId;
  game.roundMessageId = null;
  WavelengthRepository.upsert(game);

  const { updateGameMessage } = require('../handlers');
  await updateGameMessage(game, client);

  if (previousRoundMessageId && game.roundMessageId && previousRoundMessageId !== game.roundMessageId) {
    const { createContainer } = require('../render');
    const resultsUrl = `https://discord.com/channels/${game.guildId}/${game.threadId}/${game.roundMessageId}`;
    await editMessage(await fetchChannel(client, game.threadId), previousRoundMessageId, {
      components: [createContainer(`✅ Guessing closed — results are in: ${resultsUrl}`, 0x2ECC71)],
      attachments: [],
    });
  }

  scheduleAutoAdvance(game, client);
}

async function closeSession(game, client, reason) {
  if (!game) return;

  client.wavelengthManager.clearTimers(game);
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
    lockAndArchive(thread, { delayMs: 5_000 });
  }

  client.wavelengthManager.deleteGame(game.threadId);
  // Nothing was played: the card says the game was cancelled rather than showing empty standings.
  const cancelled = (game.sessionHistory ?? []).length === 0;
  await (cancelled ? card.cancel(client, game) : card.finish(client, game, cardResult(game)));
}

/** One line for the channel card: the top three of the session's standings. */
function cardResult(game) {
  const top = computeSessionTotals(game).slice(0, 3);
  if (top.length === 0) return null;
  const medals = ['🥇', '🥈', '🥉'];
  return `🏁 Final standings: ${top.map((entry, i) => `${medals[i]} <@${entry.userId}> ${entry.total} pts`).join(' · ')}`;
}

module.exports = {
  scheduleAutoAdvance,
  endGame,
  closeSession,
};
