'use strict';

/**
 * Keeps a game's in-memory registry (threadId → game state) in step with its
 * repository. Game managers extend this and add game-specific actions.
 */
class BaseGameManager {
  /**
   * @param {object} options
   * @param {{upsert: Function, remove: Function}} options.repository
   * @param {string[]} [options.timerKeys] game fields that hold setTimeout/setInterval
   *   handles; they're cleared whenever the game is deleted or reset
   * @param {number} [options.maxPlayers] addPlayer refuses players beyond this
   */
  constructor({ repository, timerKeys = [], maxPlayers = Infinity }) {
    /** @type {Map<string, object>} threadId → game state */
    this.games = new Map();
    this.repository = repository;
    this.timerKeys = timerKeys;
    this.maxPlayers = maxPlayers;
  }

  /** Registers a newly created game and persists it. */
  registerGame(game) {
    this.games.set(game.threadId, game);
    this.repository.upsert(game);
    return game;
  }

  getGame(threadId) {
    return this.games.get(threadId) ?? null;
  }

  /** Finds any game in the guild hosted by `hostId`. */
  getGameByHost(guildId, hostId) {
    for (const game of this.games.values()) {
      if (game.guildId === guildId && game.hostId === hostId) return game;
    }
    return null;
  }

  /** @returns {boolean} false if there is no such game */
  saveGame(threadId) {
    const game = this.games.get(threadId);
    if (!game) return false;
    this.repository.upsert(game);
    return true;
  }

  /** Builds the player record stored in `game.players`. Games override this to add fields. */
  createPlayer(user) {
    return { id: user.id, username: user.username };
  }

  /**
   * Adds a Discord user to the game.
   * @returns {boolean} false if there is no game, the user already joined, or the game is full
   */
  addPlayer(threadId, user) {
    const game = this.games.get(threadId);
    if (!game || game.players.has(user.id) || game.players.size >= this.maxPlayers) return false;
    game.players.set(user.id, this.createPlayer(user));
    this.repository.upsert(game);
    return true;
  }

  /** @returns {boolean} whether the player was in the game */
  removePlayer(threadId, userId) {
    const game = this.games.get(threadId);
    if (!game) return false;
    const removed = game.players.delete(userId);
    if (removed) this.repository.upsert(game);
    return removed;
  }

  /** Stops every pending timer on the game. */
  clearTimers(game) {
    for (const key of this.timerKeys) {
      if (game[key]) {
        // Node's clearTimeout also clears intervals.
        clearTimeout(game[key]);
        game[key] = null;
      }
    }
  }

  /**
   * Stops the game's timers and removes it from memory and the database.
   * @returns {boolean} whether a game was removed
   */
  deleteGame(threadId) {
    const game = this.games.get(threadId);
    if (!game) return false;
    this.clearTimers(game);
    this.repository.remove(threadId);
    this.games.delete(threadId);
    return true;
  }
}

module.exports = BaseGameManager;
