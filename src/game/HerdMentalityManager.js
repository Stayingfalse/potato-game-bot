'use strict';

const HerdMentalityRepository = require('../db/HerdMentalityRepository');
const BaseGameState = require('../games/_core/BaseGameState');
const BaseGameManager = require('../games/_core/BaseGameManager');

class HerdMentalityGameState extends BaseGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    this.questionMessageId = null;

    // phase: lobby | answering | reviewing | revealing | ended
    // players: userId -> { id, username, score, hasPinkCow }
    this.answers = new Map(); // userId -> string (raw answer)
    this.currentQuestion = null;
    this.roundNumber = 0;
    this.pinkCowHolderId = null;
    this.targetScore = 8;
    this.usedQuestions = new Set();
    this.phaseEndsAt = null;

    this.answerTimeout = null;

    // Populated during the 'reviewing' phase; null otherwise.
    // Array<{ key: string, playerIds: string[] }> where key is the normalised answer label.
    this.reviewGroups = null;
    // Message ID of the pre-score review embed so it can be updated after merges.
    this.reviewMessageId = null;
  }
}

class HerdMentalityManager extends BaseGameManager {
  constructor() {
    super({ repository: HerdMentalityRepository, timerKeys: ['answerTimeout'], maxPlayers: 12 });
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new HerdMentalityGameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  createPlayer(user) {
    return {
      id: user.id,
      username: user.username,
      score: 0,
      hasPinkCow: false,
    };
  }
}

module.exports = HerdMentalityManager;
