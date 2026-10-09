'use strict';

const BaseGameState = require('../_core/BaseGameState');

/**
 * In-memory representation of a single No More Jockeys game.
 * Saved to the `nmj_games` table through toRow / fromRow (see repository.js).
 */
class NoMoreJockeysGameState extends BaseGameState {
  /**
   * @param {string} guildId
   * @param {string} channelId     channel the /nmj start command was run in
   * @param {string} threadId      the single thread the entire game lives in
   * @param {string} hostId
   * @param {string} hostUsername
   */
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    // messageId: the single persistent message that is continually edited.
    // phase: 'lobby'|'ordering'|'playing'|'ended'
    // players: userId → {id, username}. The Map's order is the turn order.

    /** Array of eliminated player user IDs. */
    this.eliminatedPlayers = [];
    this.currentPlayerIndex = 0;

    /** Hidden categories (text) that have already been used and are no longer available. */
    this.bannedCategories = [];
    /** Committed moves: { playerId, celebs: string[], category: string } */
    this.moves = [];

    /**
     * The move currently being declared/resolved.
     * { playerId, celebs: string[], category: string, stage: 'declare'|'respond'|'name_another' }
     */
    this.pendingMove = null;
    this.nameAnotherRequired = false;

    /** Set of player IDs who have accepted the current pendingMove. */
    this.acceptedPlayers = new Set();

    /**
     * Active challenge, if any.
     * {
     *   challengerId, claimedCategoryText, matchedCategory,
     *   votes: Map<playerId, 'success'|'fail'>, voteLocked: bool
     * }
     */
    this.challengeState = null;

    /** Map<playerId, remainingTokens> */
    this.challengeCounts = new Map();

    /** Every resolved challenge this game, for stats: { challengerId, targetId, success } */
    this.challengeResults = [];
  }

  /** Player IDs in turn order, including eliminated players. */
  turnOrder() {
    return [...this.players.keys()];
  }

  alivePlayers() {
    return this.turnOrder().filter(id => !this.eliminatedPlayers.includes(id));
  }

  currentPlayerId() {
    return this.turnOrder()[this.currentPlayerIndex] ?? null;
  }

  /** Rehydrates a game state instance from a saved `nmj_games` row. */
  static fromRow(row) {
    const game = new NoMoreJockeysGameState(row.guild_id, row.channel_id, row.thread_id, row.host_id, row.host_username);
    game.messageId = row.message_id;
    game.phase = row.phase;
    game.players = new Map(JSON.parse(row.players || '[]').map(p => [p.id, p]));
    game.eliminatedPlayers = JSON.parse(row.eliminated_players || '[]');
    game.currentPlayerIndex = row.current_player_index ?? 0;
    game.bannedCategories = JSON.parse(row.banned_categories || '[]');
    game.moves = JSON.parse(row.moves || '[]');
    game.pendingMove = row.pending_move ? JSON.parse(row.pending_move) : null;
    game.nameAnotherRequired = !!row.name_another_required;
    game.challengeState = row.challenge_state ? deserializeChallengeState(JSON.parse(row.challenge_state)) : null;
    game.challengeCounts = new Map(Object.entries(JSON.parse(row.challenge_counts || '{}')));
    game.acceptedPlayers = new Set(JSON.parse(row.accepted_players || '[]'));
    game.challengeResults = JSON.parse(row.challenge_results || '[]');
    game._createdAt = row.created_at;
    return game;
  }

  /** Maps a game state to its `nmj_games` row. */
  static toRow(game) {
    return {
      thread_id: game.threadId,
      guild_id: game.guildId,
      channel_id: game.channelId,
      host_id: game.hostId,
      host_username: game.hostUsername ?? '',
      message_id: game.messageId ?? null,
      phase: game.phase,
      players: JSON.stringify([...game.players.values()]),
      eliminated_players: JSON.stringify(game.eliminatedPlayers ?? []),
      current_player_index: game.currentPlayerIndex ?? 0,
      banned_categories: JSON.stringify(game.bannedCategories ?? []),
      moves: JSON.stringify(game.moves ?? []),
      pending_move: game.pendingMove ? JSON.stringify(game.pendingMove) : null,
      name_another_required: game.nameAnotherRequired ? 1 : 0,
      challenge_state: game.challengeState ? JSON.stringify(serializeChallengeState(game.challengeState)) : null,
      challenge_counts: JSON.stringify(Object.fromEntries(game.challengeCounts ?? [])),
      accepted_players: JSON.stringify([...(game.acceptedPlayers ?? [])]),
      challenge_results: JSON.stringify(game.challengeResults ?? []),
      created_at: game._createdAt ?? Date.now(),
    };
  }
}

/** Converts an in-memory challengeState (with a Map `votes`) into a JSON-safe plain object. */
function serializeChallengeState(challengeState) {
  return { ...challengeState, votes: Object.fromEntries(challengeState.votes ?? []) };
}

/** Converts a saved challengeState (with a plain `votes` object) back into a Map. */
function deserializeChallengeState(raw) {
  return { ...raw, votes: new Map(Object.entries(raw.votes || {})) };
}

module.exports = NoMoreJockeysGameState;
