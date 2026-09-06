'use strict';

const NoMoreJockeysRepository = require('../db/NoMoreJockeysRepository');

const CHALLENGE_TOKENS_PER_PLAYER = 3;
const MIN_PLAYERS = 3;

/**
 * In-memory representation of a single No More Jockeys game.
 * Mirrors the `nmj_games` SQLite table (see src/db/database.js).
 */
class NoMoreJockeysGameState {
  constructor(guildId, channelId, threadId, creatorId) {
    this.guildId = guildId;
    this.channelId = channelId; // channel the /nmj start command was run in
    this.threadId = threadId;   // the single thread the entire game lives in
    this.creatorId = creatorId;
    this.messageId = null;      // the single persistent message that is continually edited

    /** @type {'recruiting'|'ordering'|'playing'|'ended'} */
    this.status = 'recruiting';

    /** Ordered array of player user IDs. */
    this.players = [];
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

    this._createdAt = Date.now();
  }

  alivePlayers() {
    return this.players.filter(id => !this.eliminatedPlayers.includes(id));
  }

  currentPlayerId() {
    return this.players[this.currentPlayerIndex] ?? null;
  }
}

class NoMoreJockeysManager {
  constructor() {
    /** @type {Map<string, NoMoreJockeysGameState>} */
    this.games = new Map();
  }

  createGame(guildId, channelId, threadId, creatorId) {
    const game = new NoMoreJockeysGameState(guildId, channelId, threadId, creatorId);
    this.games.set(threadId, game);
    NoMoreJockeysRepository.upsert(game);
    return game;
  }

  getGame(threadId) {
    return this.games.get(threadId) ?? null;
  }

  getGameByCreator(guildId, creatorId) {
    for (const game of this.games.values()) {
      if (game.guildId === guildId && game.creatorId === creatorId && game.status !== 'ended') return game;
    }
    return null;
  }

  deleteGame(threadId) {
    const game = this.games.get(threadId);
    if (!game) return false;
    NoMoreJockeysRepository.remove(threadId);
    this.games.delete(threadId);
    return true;
  }

  saveGame(threadId) {
    const game = this.games.get(threadId);
    if (!game) return;
    NoMoreJockeysRepository.upsert(game);
  }

  addPlayer(threadId, user) {
    const game = this.games.get(threadId);
    if (!game || game.status !== 'recruiting') return false;
    if (game.players.includes(user.id)) return false;
    game.players.push(user.id);
    NoMoreJockeysRepository.upsert(game);
    return true;
  }

  removePlayer(threadId, userId) {
    const game = this.games.get(threadId);
    if (!game || game.status !== 'recruiting') return false;
    const idx = game.players.indexOf(userId);
    if (idx === -1) return false;
    game.players.splice(idx, 1);
    NoMoreJockeysRepository.upsert(game);
    return true;
  }

  /** Fisher–Yates shuffle of the player order. */
  spinWheel(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;
    const shuffled = [...game.players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    game.players = shuffled;
    NoMoreJockeysRepository.upsert(game);
    return game;
  }

  beginGame(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;
    game.status = 'playing';
    game.currentPlayerIndex = 0;
    game.challengeCounts = new Map(game.players.map(id => [id, CHALLENGE_TOKENS_PER_PLAYER]));
    game.pendingMove = null;
    game.acceptedPlayers = new Set();
    NoMoreJockeysRepository.upsert(game);
    return game;
  }
}

module.exports = { NoMoreJockeysManager, NoMoreJockeysGameState, CHALLENGE_TOKENS_PER_PLAYER, MIN_PLAYERS };
