'use strict';

const WerewordsRepository = require('./repository');
const WerewordsGameState = require('./state');
const { editMessage } = require('../_core/messages');

/** Crash recovery: reloads saved Werewords games and re-hooks their timers and buttons. */
async function restore(client) {
  const rows = WerewordsRepository.getAll();
  if (rows.length === 0) return;

  const {
    buildBoardEmbed,
    buildMayorActionComponents,
  } = require('./phases/playing');
  const { buildVoteComponents } = require('./phases/voting');
  const { buildRevealComponents } = require('./phases/reveal');
  const { startGameTimer }        = require('./phases/timer');
  const { endGame }               = require('./phases/endGame');

  for (const row of rows) {
    const game = WerewordsGameState.fromRow(row);
    client.werewordsManager.games.set(row.thread_id, game);

    // Fetch the thread — drop the game if Discord no longer knows about it.
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      WerewordsRepository.remove(row.thread_id);
      client.werewordsManager.games.delete(row.thread_id);
      continue;
    }

    // Lobby, mode_select and ended (between games, waiting for Rematch or Close Session)
    // just need their thread to still exist: their buttons find the game by thread, so
    // they keep working. Skip the "bot restarted" notice for these phases.
    if (row.phase === 'lobby' || row.phase === 'mode_select' || row.phase === 'ended') {
      continue;
    }

    await thread.send({ content: '⚠️ Bot restarted. Attempting to resume game…' }).catch(() => {});

    // ── Phase-specific recovery ────────────────────────────────────────────
    if (row.phase === 'playing') {
      // Restart the countdown from saved time_left.
      startGameTimer(game, thread, client);
      await editMessage(thread, game.boardMessageId, {
        embeds: [buildBoardEmbed(game)],
        components: buildMayorActionComponents(game.tokens),
      });
    } else if (row.phase === 'voting') {
      // Re-post vote buttons. Auto-tally after 60 s.
      const { tallyVotes } = require('./phases/voting');
      await thread.send({
        content: '🗳️ Voting has resumed — please re-cast your vote:',
        components: buildVoteComponents(game.players),
      }).catch(() => {});

      game.revealTimeout = setTimeout(async () => {
        if (game.phase !== 'voting') return;
        await tallyVotes(game, client);
      }, 60_000);
    } else if (row.phase === 'reveal') {
      // Re-post Demon reveal button. 90 s timeout.
      await thread.send({
        content: '😈 Resume: Werewolf, you may still reveal yourself:',
        components: buildRevealComponents(),
      }).catch(() => {});

      game.revealTimeout = setTimeout(async () => {
        if (game.phase !== 'reveal') return;
        await endGame(game, client, 'villagers_word');
      }, 90_000);
    }
  }
}

module.exports = restore;
