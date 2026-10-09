const CheeseThiefRepository = require('../db/CheeseThiefRepository');
const { shuffle } = require('../games/_core/random');
const BaseGameState = require('../games/_core/BaseGameState');
const BaseGameManager = require('../games/_core/BaseGameManager');

class CheeseThiefGameState extends BaseGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    this.readyMessageId = null;

    // phase: lobby|playing|accomplice|discussion|voting|ended
    this.readyPlayers = new Set();
    this.votes = new Map();

    this.currentWakeNumber = 0;
    this.phaseEndsAt = null;
    this.cheeseStolen = false;
    this.thiefId = null;
    this.accompliceId = null;
    this.stolenAtWake = null;

    // In-memory only (not persisted — regenerated on each game start / restored as empty on resume)
    this.ephemeralTokens      = new Map(); // userId → { token, applicationId }
    this.playerLogs           = new Map(); // userId → string[]
    this.discussionReadyPlayers = new Set();

    this.wakeTimeout = null;
    this.accompliceTimeout = null;
    this.revealTimeout = null;
  }
}

const CT_ROLES = Object.freeze({
  THIEF: 'Cheese Thief',
  FALL_MOUSE: 'Fall Mouse',
  SLEEPY_MICE: 'Sleepy Mice',
});

function assignCheeseThiefRoles(players) {
  if (players.length < 3) throw new Error('At least 3 players are required to start Cheese Thief.');

  const result = shuffle(players).map(p => ({ ...p, role: CT_ROLES.SLEEPY_MICE, dieValue: null, isAccomplice: false }));
  result[0].role = CT_ROLES.THIEF;
  result[1].role = CT_ROLES.FALL_MOUSE;
  return result;
}

class CheeseThiefManager extends BaseGameManager {
  constructor() {
    super({
      repository: CheeseThiefRepository,
      timerKeys: ['wakeTimeout', 'accompliceTimeout', 'revealTimeout'],
      maxPlayers: 10,
    });
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new CheeseThiefGameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  createPlayer(user) {
    return {
      id: user.id,
      username: user.username,
      role: null,
      dieValue: null,
      isAccomplice: false,
    };
  }

  assignRoles(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;
    const assigned = assignCheeseThiefRoles([...game.players.values()]);
    for (const player of assigned) {
      game.players.set(player.id, player);
    }
    game.thiefId = assigned.find(p => p.role === CT_ROLES.THIEF)?.id ?? null;
    CheeseThiefRepository.upsert(game);
    return game;
  }

  resetForRematch(threadId, openSignups) {
    const game = this.games.get(threadId);
    if (!game) return null;

    this.clearTimers(game);

    game.gameNumber += 1;
    game.phase = openSignups ? 'lobby' : 'playing';
    game.readyPlayers = new Set();
    game.votes = new Map();
    game.currentWakeNumber = 0;
    game.phaseEndsAt = null;
    game.cheeseStolen = false;
    game.accompliceId = null;
    game.stolenAtWake = null;
    game.readyMessageId = null;

    if (openSignups) {
      const host = game.players.get(game.hostId);
      game.players = new Map();
      if (host) game.players.set(host.id, { ...host, role: null, dieValue: null, isAccomplice: false });
    } else {
      for (const player of game.players.values()) {
        player.role = null;
        player.dieValue = null;
        player.isAccomplice = false;
      }
    }

    CheeseThiefRepository.upsert(game);
    return game;
  }
}

module.exports = { CheeseThiefManager, CT_ROLES };
