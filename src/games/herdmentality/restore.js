'use strict';

const HerdMentalityRepository = require('../../db/HerdMentalityRepository');

/** Crash recovery: reloads saved Herd Mentality games and re-hooks their timers and buttons. */
async function restore(client) {
  const rows = HerdMentalityRepository.getAll();
  if (rows.length === 0) return;

  for (const row of rows) {
    if (row.phase === 'ended') {
      HerdMentalityRepository.remove(row.thread_id);
      continue;
    }

    const playersArray = JSON.parse(row.players);
    const players      = new Map(playersArray.map(p => [p.id, p]));
    const answersObj   = JSON.parse(row.answers || '{}');
    const answers      = new Map(Object.entries(answersObj));
    const usedQuestions = new Set(JSON.parse(row.used_questions || '[]'));

    const game = {
      guildId:            row.guild_id,
      channelId:          row.channel_id,
      threadId:           row.thread_id,
      hostId:             row.host_id,
      hostUsername:       row.host_username,
      messageId:          row.message_id,
      questionMessageId:  row.question_message_id,
      phase:              row.phase,
      players,
      answers,
      currentQuestion:    row.current_question ?? null,
      roundNumber:        row.round_number ?? 0,
      pinkCowHolderId:    row.pink_cow_holder_id ?? null,
      targetScore:        row.target_score ?? 8,
      usedQuestions,
      phaseEndsAt:        row.phase_ends_at ?? null,
      answerTimeout:      null,
      gameNumber:         row.game_number ?? 1,
      reviewGroups:       row.review_groups ? JSON.parse(row.review_groups) : null,
      reviewMessageId:    null,
      _createdAt:         row.created_at,
    };

    client.herdMentalityManager.games.set(row.thread_id, game);

    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      HerdMentalityRepository.remove(row.thread_id);
      client.herdMentalityManager.games.delete(row.thread_id);
      continue;
    }

    // Lobby games just need their thread (and the lobby message's join/leave/start buttons,
    // which already carry the thread ID) to still exist — the game state was already restored
    // above. Skip the "bot restarted" notice so hosts aren't spammed every time a new lobby is
    // created.
    if (row.phase === 'lobby') {
      continue;
    }

    await thread.send({ content: '⚠️ Bot restarted. Attempting to resume Herd Mentality game…' }).catch(() => {});

    if (row.phase === 'answering') {
      // Re-post a new question round (treat as a fresh round starting from where we left off).
      const { startRound } = require('./handlers');
      game.answers = new Map();
      await startRound(game, client, { keepRoundNumber: true });
    } else if (row.phase === 'reviewing') {
      // Re-post the review embed so the host can still merge/score.
      // reviewGroups was restored from DB above; if missing, recompute from answers.
      if (!game.reviewGroups) {
        const { computeReviewGroups } = require('./handlers');
        game.reviewGroups = computeReviewGroups(game);
      }

      const { buildPreviewEmbed, buildPreviewComponents } = require('./handlers');
      const canMerge = game.reviewGroups.length >= 2;
      const msg = await thread.send({
        content: '🔄 Bot restarted. Review answers and score when ready.',
        embeds: [buildPreviewEmbed(game)],
        components: buildPreviewComponents(canMerge),
      }).catch(() => null);
      if (msg) {
        game.reviewMessageId = msg.id;
      }
    } else if (row.phase === 'revealing') {
      // Re-post the reveal controls so the host can proceed.
      const { ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
      await thread.send({
        content: '🔄 Bot restarted. Use the buttons below to continue.',
        components: [
          new AR().addComponents(
            new BB().setCustomId('hm_next_round').setLabel('Next Round').setEmoji('➡️').setStyle(BS.Primary),
            new BB().setCustomId('hm_end_game').setLabel('End Game').setEmoji('🛑').setStyle(BS.Danger),
          ),
        ],
      }).catch(() => {});
    }
  }
}

module.exports = restore;
