'use strict';

const createRepository = require('../games/_core/createRepository');
const db = require('./database');

/** @param {import('../game/GameManager').GameState} game */
function toRow(game) {
  return {
    thread_id:               game.threadId,
    guild_id:                game.guildId,
    channel_id:              game.channelId,
    host_id:                 game.hostId,
    host_username:           game.hostUsername,
    message_id:              game.messageId ?? null,
    board_message_id:        game.boardMessageId ?? null,
    phase:                   game.phase,
    players:                 JSON.stringify([...game.players.values()]),
    word:                    game.word ?? null,
    word_options:            JSON.stringify(game.wordOptions ?? []),
    tokens:                  JSON.stringify(game.tokens),
    time_left:               game.timeLeft,
    votes:                   JSON.stringify(Object.fromEntries(game.votes ?? new Map())),
    game_number:             game.gameNumber,
    winner_guesser_user_id:  game.winnerGuesserUserId ?? null,
    session_mode:            game.sessionMode ?? null,
    voice_player_message_ids: JSON.stringify(Object.fromEntries(game.voicePlayerMessageIds ?? new Map())),
    created_at:              game._createdAt ?? Date.now(),
  };
}

const repository = createRepository({ table: 'werewords_games', toRow });

const stmtUpdateTimeLeft = db.prepare(`
  UPDATE werewords_games SET time_left = @time_left WHERE thread_id = @thread_id
`);

/**
 * Lightweight update for just the time_left column (called on every board refresh).
 * @param {string} threadId
 * @param {number} timeLeft
 */
function updateTimeLeft(threadId, timeLeft) {
  stmtUpdateTimeLeft.run({ thread_id: threadId, time_left: timeLeft });
}

module.exports = { ...repository, updateTimeLeft };
