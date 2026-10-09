'use strict';

const createRepository = require('../games/_core/createRepository');

/** @param {import('../game/HerdMentalityManager').HerdMentalityGameState} game */
function toRow(game) {
  return {
    thread_id:           game.threadId,
    guild_id:            game.guildId,
    channel_id:          game.channelId,
    host_id:             game.hostId,
    host_username:       game.hostUsername,
    message_id:          game.messageId ?? null,
    question_message_id: game.questionMessageId ?? null,
    phase:               game.phase,
    players:             JSON.stringify([...game.players.values()]),
    answers:             JSON.stringify(Object.fromEntries(game.answers ?? new Map())),
    current_question:    game.currentQuestion ?? null,
    round_number:        game.roundNumber ?? 0,
    pink_cow_holder_id:  game.pinkCowHolderId ?? null,
    target_score:        game.targetScore ?? 8,
    used_questions:      JSON.stringify([...(game.usedQuestions ?? new Set())]),
    phase_ends_at:       game.phaseEndsAt ?? null,
    game_number:         game.gameNumber ?? 1,
    review_groups:       game.reviewGroups ? JSON.stringify(game.reviewGroups) : null,
    created_at:          game._createdAt ?? Date.now(),
  };
}

const repository = createRepository({ table: 'herd_mentality_games', toRow });

module.exports = repository;
