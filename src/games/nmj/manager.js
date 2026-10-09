'use strict';

const BaseGameManager = require('../_core/BaseGameManager');
const { shuffle } = require('../_core/random');
const NoMoreJockeysRepository = require('./repository');
const NoMoreJockeysGameState = require('./state');

const CHALLENGE_TOKENS_PER_PLAYER = 3;
const MIN_PLAYERS = 3;

class NoMoreJockeysManager extends BaseGameManager {
  constructor() {
    super({ repository: NoMoreJockeysRepository });
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new NoMoreJockeysGameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  /** Like the base version, but ignores a game that has just ended. */
  getGameByHost(guildId, hostId) {
    for (const game of this.games.values()) {
      if (game.guildId === guildId && game.hostId === hostId && game.phase !== 'ended') return game;
    }
    return null;
  }

  /** Players can only join while the game is in its lobby. */
  addPlayer(threadId, user) {
    if (this.games.get(threadId)?.phase !== 'lobby') return false;
    return super.addPlayer(threadId, user);
  }

  /** Players can only leave while the game is in its lobby. */
  removePlayer(threadId, userId) {
    if (this.games.get(threadId)?.phase !== 'lobby') return false;
    return super.removePlayer(threadId, userId);
  }

  /** Shuffles the turn order. */
  spinWheel(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;
    game.players = new Map(shuffle([...game.players]));
    NoMoreJockeysRepository.upsert(game);
    return game;
  }

  beginGame(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;
    game.phase = 'playing';
    game.currentPlayerIndex = 0;
    game.challengeCounts = new Map(game.turnOrder().map(id => [id, CHALLENGE_TOKENS_PER_PLAYER]));
    game.pendingMove = null;
    game.acceptedPlayers = new Set();
    game.challengeResults = [];
    NoMoreJockeysRepository.upsert(game);
    return game;
  }
}

module.exports = { NoMoreJockeysManager, NoMoreJockeysGameState, CHALLENGE_TOKENS_PER_PLAYER, MIN_PLAYERS };
