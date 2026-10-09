'use strict';

const BaseGameManager = require('../_core/BaseGameManager');
const { assignRoles } = require('./roles');
const WerewordsRepository = require('./repository');
const WerewordsGameState = require('./state');

const MIN_PLAYERS = 3;

class WerewordsManager extends BaseGameManager {
  constructor() {
    super({ repository: WerewordsRepository, timerKeys: ['timerInterval', 'revealTimeout'], maxPlayers: 10 });
  }

  /**
   * Creates and registers a new game, keyed by thread ID.
   * @returns {WerewordsGameState}
   */
  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new WerewordsGameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  /**
   * Resets the game for a rematch without destroying the session.
   * @param {string} threadId
   * @param {boolean} openSignups  true = back to lobby; false = straight to playing
   * @returns {WerewordsGameState|null}
   */
  resetForRematch(threadId, openSignups) {
    const game = this.games.get(threadId);
    if (!game) return null;

    this.clearTimers(game);

    game.gameNumber++;
    game.phase = openSignups ? 'lobby' : 'playing';
    game.word = null;
    game.wordOptions = [];
    game.pendingSecretInteractions = [];
    game.tokens = { yes_no: 36, maybe: 12, correct: 1, so_close_way_off: 2 };
    game.readyPlayers = new Set();
    game.votes = new Map();
    game.boardMessageId = null;
    game.phaseEndsAt = null;
    game.werewolfRevealed = false;
    game.winnerGuesserUserId = null;
    game.responseStatsShown = false;
    game.timeLeft = 240;
    // For same-group rematch keep the previously chosen mode; for open sign-ups ask again.
    if (openSignups) game.sessionMode = null;
    game.voicePlayerMessageIds = new Map();

    // Reset roles so they get reassigned on start.
    for (const player of game.players.values()) {
      player.role = null;
      player.secretRole = null;
      player.responseStats = { yes: 0, no: 0, maybe: 0, soClose: 0, wayOff: 0 };
    }

    WerewordsRepository.upsert(game);
    return game;
  }

  createPlayer(user) {
    return {
      id: user.id,
      username: user.username,
      role: null,
      secretRole: null,
      responseStats: { yes: 0, no: 0, maybe: 0, soClose: 0, wayOff: 0 },
    };
  }

  /**
   * Shuffles the player list and assigns roles in place.
   * @param {string} threadId
   * @returns {WerewordsGameState|null}
   */
  assignRoles(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;

    const assigned = assignRoles([...game.players.values()]);
    for (const player of assigned) {
      game.players.set(player.id, player);
    }
    WerewordsRepository.upsert(game);
    return game;
  }
}

module.exports = { WerewordsManager, WerewordsGameState, MIN_PLAYERS };
