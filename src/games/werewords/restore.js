'use strict';

const GameRepository = require('../../db/GameRepository');
const { editMessage } = require('../_core/messages');

/** Crash recovery: reloads saved Werewords games and re-hooks their timers and buttons. */
async function restore(client) {
  const rows = GameRepository.getAll();
  if (rows.length === 0) return;

  const {
    buildBoardEmbed,
    buildMayorActionComponents,
  } = require('../../game/phases/playing');
  const { buildVoteComponents } = require('../../game/phases/voting');
  const { buildRevealComponents } = require('../../game/phases/reveal');
  const { startGameTimer }        = require('../../game/phases/timer');
  const { endGame }               = require('../../game/phases/endGame');

  for (const row of rows) {
    if (row.phase === 'ended') {
      GameRepository.remove(row.thread_id);
      continue;
    }

    // Deserialise JSON columns.
    const playersArray   = JSON.parse(row.players);
    const players        = new Map(playersArray.map(p => [p.id, p]));
    const tokens         = JSON.parse(row.tokens);
    const votes          = new Map(Object.entries(JSON.parse(row.votes)));
    const wordOptions    = JSON.parse(row.word_options);

    // Reconstruct the GameState-shaped object and insert into the manager.
    const game = {
      guildId:           row.guild_id,
      channelId:         row.channel_id,
      threadId:          row.thread_id,
      hostId:            row.host_id,
      hostUsername:      row.host_username,
      messageId:         row.message_id,
      boardMessageId:    row.board_message_id,
      phase:             row.phase,
      players,
      word:              row.word,
      wordOptions,
      pendingSecretInteractions: [],
      tokens,
      readyPlayers:      new Set(),
      timerInterval:     null,
      timeLeft:          row.time_left,
      collector:         null,
      votes,
      revealTimeout:     null,
      gameNumber:        row.game_number,
      sessionHistory:    [],
      winnerGuesserUserId: row.winner_guesser_user_id,
      sessionMode:       row.session_mode ?? null,
      voicePlayerMessageIds: row.voice_player_message_ids
        ? new Map(Object.entries(JSON.parse(row.voice_player_message_ids)))
        : new Map(),
      _createdAt:        row.created_at,
    };

    client.gameManager.games.set(row.thread_id, game);

    // Fetch the thread — drop the game if Discord no longer knows about it.
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      GameRepository.remove(row.thread_id);
      client.gameManager.games.delete(row.thread_id);
      continue;
    }

    // Lobby and mode_select games just need their thread (and lobby message, whose join/leave/
    // start buttons already carry the thread ID) to still exist — the game state was already
    // restored above, so those buttons keep working. Skip the "bot restarted" notice for these
    // phases so hosts aren't spammed every time a new lobby is created.
    if (row.phase === 'lobby' || row.phase === 'mode_select') {
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
      const { tallyVotes } = require('../../game/phases/voting');
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
