'use strict';

/**
 * Crash-recovery: reload all active games from the DB and re-hook timers/buttons.
 * Called once from ready.js after the bot logs in.
 *
 * @param {import('discord.js').Client} client
 */
async function restoreGames(client) {
  const CheeseThiefRepository    = require('./CheeseThiefRepository');
  const GameRepository           = require('./GameRepository');
  const WavelengthRepository     = require('./WavelengthRepository');
  const HerdMentalityRepository  = require('./HerdMentalityRepository');
  const NoMoreJockeysRepository  = require('./NoMoreJockeysRepository');

  await Promise.all([
    restoreCheeseThief(client, CheeseThiefRepository),
    restoreWerewords(client, GameRepository),
    restoreWavelength(client, WavelengthRepository),
    restoreHerdMentality(client, HerdMentalityRepository),
    restoreNoMoreJockeys(client, NoMoreJockeysRepository),
  ]);
}

// ── Cheese Thief restore ───────────────────────────────────────────────────────

async function restoreCheeseThief(client, CheeseThiefRepository) {
  const rows = CheeseThiefRepository.getAll();
  if (rows.length === 0) return;

  const { resumeCheeseThiefGame } = require('../events/interactionCreateCheeseThief');

  for (const row of rows) {
    if (row.phase === 'ended') {
      CheeseThiefRepository.remove(row.thread_id);
      continue;
    }

    const playersArray = JSON.parse(row.players);
    const players = new Map(playersArray.map(p => [p.id, p]));
    const readyPlayers = new Set(JSON.parse(row.ready_players || '[]'));
    const votes = new Map(Object.entries(JSON.parse(row.votes || '{}')));

    const game = {
      guildId: row.guild_id,
      channelId: row.channel_id,
      threadId: row.thread_id,
      hostId: row.host_id,
      hostUsername: row.host_username,
      messageId: row.message_id,
      readyMessageId: row.ready_message_id,
      phase: row.phase,
      players,
      readyPlayers,
      votes,
      currentWakeNumber: row.current_wake_number ?? 0,
      phaseEndsAt: row.phase_ends_at ?? null,
      cheeseStolen: !!row.cheese_stolen,
      thiefId: row.thief_id ?? null,
      accompliceId: row.accomplice_id ?? null,
      stolenAtWake: row.stolen_at_wake ?? null,
      // In-memory only — start empty after a restart; players must reopen Secret Info
      ephemeralTokens: new Map(),
      playerLogs: new Map(),
      discussionReadyPlayers: new Set(),
      wakeTimeout: null,
      accompliceTimeout: null,
      revealTimeout: null,
      gameNumber: row.game_number ?? 1,
      _createdAt: row.created_at,
    };

    client.cheeseThiefManager.games.set(row.thread_id, game);

    if (row.phase === 'lobby') {
      // Lobby games just need their thread (and the lobby message's join/leave/start buttons,
      // which already carry the thread ID) to still exist — the game state was already
      // restored above. Skip resumeCheeseThiefGame() since its "reopen Secret Info" notice
      // only applies to in-progress rounds.
      const thread = await client.channels.fetch(row.thread_id).catch(() => null);
      if (!thread) {
        CheeseThiefRepository.remove(row.thread_id);
        client.cheeseThiefManager.games.delete(row.thread_id);
      }
      continue;
    }

    const resumed = await resumeCheeseThiefGame(game, client);
    if (!resumed) {
      CheeseThiefRepository.remove(row.thread_id);
      client.cheeseThiefManager.games.delete(row.thread_id);
    }
  }
}

// ── Werewords restore ──────────────────────────────────────────────────────────

async function restoreWerewords(client, GameRepository) {
  const rows = GameRepository.getAll();
  if (rows.length === 0) return;

  const {
    buildBoardEmbed,
    buildMayorActionComponents,
  } = require('../game/phases/playing');
  const { buildVoteComponents } = require('../game/phases/voting');
  const { buildRevealComponents } = require('../game/phases/reveal');
  const { startGameTimer }        = require('../game/phases/timer');
  const { endGame }               = require('../game/phases/endGame');

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
      if (game.boardMessageId) {
        const bMsg = await thread.messages.fetch(game.boardMessageId).catch(() => null);
        if (bMsg) {
          await bMsg.edit({
            embeds: [buildBoardEmbed(game)],
            components: buildMayorActionComponents(game.tokens),
          }).catch(() => {});
        }
      }
    } else if (row.phase === 'voting') {
      // Re-post vote buttons. Auto-tally after 60 s.
      const { tallyVotes } = require('../game/phases/voting');
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

// ── Wavelength restore ─────────────────────────────────────────────────────────

async function restoreWavelength(client, WavelengthRepository) {
  const rows = WavelengthRepository.getAll();
  if (rows.length === 0) return;

  const { WavelengthGameState } = require('../game/WavelengthManager');
  const { updateGameMessage, scheduleGuessTimeout } = require('../game/wavelength/interactionHandler');
  const { scheduleAutoAdvance } = require('../game/wavelength/phases/endGame');
  const { evaluateSessionGoal } = require('../game/wavelength/phases/sessionEnd');

  for (const row of rows) {
    const game = WavelengthGameState.fromRow(row);
    client.wavelengthManager.games.set(row.thread_id, game);

    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      WavelengthRepository.remove(row.thread_id);
      client.wavelengthManager.games.delete(row.thread_id);
      continue;
    }

    const restored = await updateGameMessage(game, client, { createIfMissing: false }, thread);
    if (!restored) {
      WavelengthRepository.remove(row.thread_id);
      client.wavelengthManager.games.delete(row.thread_id);
      continue;
    }

    if (game.phase === 'guessing' && game.gamePace !== 'turnbased') {
      await scheduleGuessTimeout(game, client);
    }

    if (game.phase === 'ended' && game.autoAdvanceRounds && !evaluateSessionGoal(game).complete) {
      scheduleAutoAdvance(game, client);
    }
  }
}

// ── Herd Mentality restore ─────────────────────────────────────────────────────

async function restoreHerdMentality(client, HerdMentalityRepository) {
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
      const { startRound } = require('../events/interactionCreateHerdMentality');
      game.answers = new Map();
      await startRound(game, client, { keepRoundNumber: true });
    } else if (row.phase === 'reviewing') {
      // Re-post the review embed so the host can still merge/score.
      // reviewGroups was restored from DB above; if missing, recompute from answers.
      if (!game.reviewGroups) {
        const { computeReviewGroups } = require('../events/interactionCreateHerdMentality');
        game.reviewGroups = computeReviewGroups(game);
      }

      const { buildPreviewEmbed, buildPreviewComponents } = require('../events/interactionCreateHerdMentality');
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

// ── No More Jockeys restore ─────────────────────────────────────────────────

async function restoreNoMoreJockeys(client, NoMoreJockeysRepository) {
  const rows = NoMoreJockeysRepository.getAll();
  if (rows.length === 0) return;

  const { updateGameMessage } = require('../events/interactionCreateNMJ');
  const { NoMoreJockeysGameState } = require('../game/NoMoreJockeysManager');

  for (const row of rows) {
    if (row.status === 'ended') {
      NoMoreJockeysRepository.remove(row.thread_id);
      continue;
    }

    const game = NoMoreJockeysGameState.fromRow(row);
    client.nmjManager.games.set(row.thread_id, game);

    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread) {
      NoMoreJockeysRepository.remove(row.thread_id);
      client.nmjManager.games.delete(row.thread_id);
      continue;
    }

    // Re-render the single persistent message in place so its buttons are immediately
    // wired to the restored game state — no separate "bot restarted" notice is needed
    // since the game is fully playable again as soon as this edit completes.
    await updateGameMessage(game, client, undefined, thread);
  }
}

module.exports = { restoreGames };
