'use strict';

const db = require('./database');

const stmtUpsert = db.prepare(`
  INSERT INTO nmj_games
    (thread_id, guild_id, channel_id, creator_id, message_id, status,
     players, eliminated_players, current_player_index, banned_categories,
     moves, pending_move, name_another_required, challenge_state,
     challenge_counts, accepted_players, created_at)
  VALUES
    (@thread_id, @guild_id, @channel_id, @creator_id, @message_id, @status,
     @players, @eliminated_players, @current_player_index, @banned_categories,
     @moves, @pending_move, @name_another_required, @challenge_state,
     @challenge_counts, @accepted_players, @created_at)
  ON CONFLICT(thread_id) DO UPDATE SET
    guild_id              = excluded.guild_id,
    channel_id            = excluded.channel_id,
    creator_id            = excluded.creator_id,
    message_id            = excluded.message_id,
    status                = excluded.status,
    players               = excluded.players,
    eliminated_players    = excluded.eliminated_players,
    current_player_index  = excluded.current_player_index,
    banned_categories     = excluded.banned_categories,
    moves                 = excluded.moves,
    pending_move          = excluded.pending_move,
    name_another_required = excluded.name_another_required,
    challenge_state       = excluded.challenge_state,
    challenge_counts      = excluded.challenge_counts,
    accepted_players      = excluded.accepted_players
`);

const stmtGetAll = db.prepare('SELECT * FROM nmj_games');
const stmtDelete = db.prepare('DELETE FROM nmj_games WHERE thread_id = ?');

/**
 * @param {import('../game/NoMoreJockeysManager').NoMoreJockeysGameState|object} game
 */
function upsert(game) {
  stmtUpsert.run({
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
    challenge_state: game.challengeState ? JSON.stringify(game.challengeState) : null,
    challenge_counts: JSON.stringify(game.challengeCounts ?? {}),
    accepted_players: JSON.stringify([...(game.acceptedPlayers ?? [])]),
    created_at: game._createdAt ?? Date.now(),
  });
}

function getAll() {
  return stmtGetAll.all();
}

function remove(threadId) {
  stmtDelete.run(threadId);
}

module.exports = { upsert, getAll, remove };
