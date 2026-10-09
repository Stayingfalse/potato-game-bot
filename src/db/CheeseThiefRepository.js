'use strict';

const createRepository = require('../games/_core/createRepository');

/** @param {import('../game/CheeseThiefManager').CheeseThiefGameState} game */
function toRow(game) {
  return {
    thread_id: game.threadId,
    guild_id: game.guildId,
    channel_id: game.channelId,
    host_id: game.hostId,
    host_username: game.hostUsername,
    message_id: game.messageId ?? null,
    ready_message_id: game.readyMessageId ?? null,
    phase: game.phase,
    players: JSON.stringify([...game.players.values()]),
    ready_players: JSON.stringify([...game.readyPlayers]),
    votes: JSON.stringify(Object.fromEntries(game.votes ?? new Map())),
    current_wake_number: game.currentWakeNumber ?? 0,
    phase_ends_at: game.phaseEndsAt ?? null,
    cheese_stolen: game.cheeseStolen ? 1 : 0,
    thief_id: game.thiefId ?? null,
    accomplice_id: game.accompliceId ?? null,
    stolen_at_wake: game.stolenAtWake ?? null,
    game_number: game.gameNumber ?? 1,
    created_at: game._createdAt ?? Date.now(),
  };
}

const repository = createRepository({ table: 'cheese_thief_games', toRow });

module.exports = repository;
