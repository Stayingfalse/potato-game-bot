'use strict';

const BaseGameManager = require('../_core/BaseGameManager');
const HighRollRepository = require('./repository');
const HighRollGameState = require('./state');

const MIN_PLAYERS = 2;
const ROLL_WINDOW_MS = 60_000;

/**
 * BaseGameManager provides getGame, getGameByHost, saveGame, deleteGame,
 * addPlayer / removePlayer (using createPlayer and maxPlayers) and clearTimers
 * (for the fields in timerKeys). Add only the game's own actions here.
 */
class HighRollManager extends BaseGameManager {
  constructor() {
    super({ repository: HighRollRepository, timerKeys: ['rollTimeout'], maxPlayers: 10 });
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new HighRollGameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  /** Players can only join or leave while the game is in its lobby. */
  addPlayer(threadId, user) {
    if (this.games.get(threadId)?.phase !== 'lobby') return false;
    return super.addPlayer(threadId, user);
  }

  removePlayer(threadId, userId) {
    if (this.games.get(threadId)?.phase !== 'lobby') return false;
    return super.removePlayer(threadId, userId);
  }

  /** Starts a round: clears the rolls and opens the rolling window. */
  startRound(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;
    this.clearTimers(game);
    if (game.phase === 'ended') game.gameNumber++;
    game.phase = 'rolling';
    game.rolls = new Map();
    game.phaseEndsAt = Date.now() + ROLL_WINDOW_MS;
    HighRollRepository.upsert(game);
    return game;
  }
}

module.exports = { HighRollManager, HighRollGameState, MIN_PLAYERS, ROLL_WINDOW_MS };
