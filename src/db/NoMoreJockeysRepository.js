'use strict';

const createRepository = require('../games/_core/createRepository');

/** @param {import('../game/NoMoreJockeysManager').NoMoreJockeysGameState} game */
function toRow(game) {
  return {
    thread_id: game.threadId,
    guild_id: game.guildId,
    channel_id: game.channelId,
    creator_id: game.creatorId,
    message_id: game.messageId ?? null,
    status: game.status,
    players: JSON.stringify(game.players ?? []),
    eliminated_players: JSON.stringify(game.eliminatedPlayers ?? []),
    current_player_index: game.currentPlayerIndex ?? 0,
    banned_categories: JSON.stringify(game.bannedCategories ?? []),
    moves: JSON.stringify(game.moves ?? []),
    pending_move: game.pendingMove ? JSON.stringify(game.pendingMove) : null,
    name_another_required: game.nameAnotherRequired ? 1 : 0,
    challenge_state: game.challengeState ? JSON.stringify(serializeChallengeState(game.challengeState)) : null,
    challenge_counts: JSON.stringify(Object.fromEntries(game.challengeCounts ?? [])),
    accepted_players: JSON.stringify([...(game.acceptedPlayers ?? [])]),
    created_at: game._createdAt ?? Date.now(),
  };
}

const repository = createRepository({ table: 'nmj_games', toRow });

/** Converts an in-memory challengeState (with a Map `votes`) into a JSON-safe plain object. */
function serializeChallengeState(challengeState) {
  return { ...challengeState, votes: Object.fromEntries(challengeState.votes ?? []) };
}

module.exports = repository;
