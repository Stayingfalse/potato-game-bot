'use strict';

const WavelengthRepository = require('../db/WavelengthRepository');
const { sampleN } = require('../games/_core/random');
const BaseGameState = require('../games/_core/BaseGameState');
const BaseGameManager = require('../games/_core/BaseGameManager');

class WavelengthGameState extends BaseGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);

    // One message per round: this tracks the current round's message, which is
    // edited as the round advances (cluing → guessing → reveal) and then left
    // in place when the next round posts a fresh message.
    this.roundMessageId = null;

    // phase: 'lobby'|'setup'|'cluing'|'guessing'|'reveal'|'ended'
    // players: userId → {id, username, avatarURL}

    this.clueGiverId = null;
    this.spectrumOptions = [];
    this.chosenSpectrum = null;
    this.targetPosition = null;
    this.clue = null;
    this.guesses = new Map();
    this.guessTimeout = null;
    this.autoAdvanceTimeout = null;
    this.sessionHistory = [];
    this.sessionMode = null;
    this.gamePace = 'realtime';
    this.autoAdvanceRounds = false;
    this.clueOrderState = {
      roundRobinIndex: 0,
      snakeIndex: 0,
      snakeDirection: 1,
      clueTurnsByPlayer: {},
    };
  }

  static fromRow(row) {
    const game = new WavelengthGameState(row.guild_id, row.channel_id, row.thread_id, row.host_id, row.host_username);
    game.messageId = row.message_id;
    game.roundMessageId = row.round_message_id ?? null;
    game.phase = row.phase;
    game.players = new Map(JSON.parse(row.players || '[]').map(p => [p.id, p]));
    game.clueGiverId = row.clue_giver_id;
    game.spectrumOptions = row.spectrum_options ? JSON.parse(row.spectrum_options) : [];
    game.chosenSpectrum = row.chosen_spectrum ? JSON.parse(row.chosen_spectrum) : null;
    game.targetPosition = row.target_position;
    game.clue = row.clue;
    game.guesses = new Map(Object.entries(JSON.parse(row.guesses || '{}')));
    game.sessionMode = row.session_mode ? JSON.parse(row.session_mode) : null;
    game.clueOrderState = row.clue_order_state
      ? JSON.parse(row.clue_order_state)
      : { roundRobinIndex: 0, snakeIndex: 0, snakeDirection: 1, clueTurnsByPlayer: {} };
    game.gameNumber = row.game_number;
    game.sessionHistory = JSON.parse(row.session_history || '[]');
    game.gamePace = row.game_pace ?? 'realtime';
    game.autoAdvanceRounds = row.auto_advance_rounds === 1;
    game._createdAt = row.created_at;
    return game;
  }
}

class WavelengthManager extends BaseGameManager {
  constructor() {
    super({
      repository: WavelengthRepository,
      timerKeys: ['guessTimeout', 'autoAdvanceTimeout'],
      maxPlayers: 20,
    });
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new WavelengthGameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  resetForRematch(threadId, openSignups) {
    const game = this.games.get(threadId);
    if (!game) return null;

    this.clearTimers(game);

    game.gameNumber++;
    game.phase = openSignups ? 'lobby' : 'cluing';
    game.roundMessageId = null;
    game.clueGiverId = null;
    game.spectrumOptions = [];
    game.chosenSpectrum = null;
    game.targetPosition = null;
    game.clue = null;
    game.guesses = new Map();
    WavelengthRepository.upsert(game);
    return game;
  }

  resetForNewSession(threadId, openSignups) {
    const game = this.games.get(threadId);
    if (!game) return null;

    this.clearTimers(game);

    game.gameNumber = 1;
    game.phase = openSignups ? 'lobby' : 'setup';
    game.roundMessageId = null;
    game.clueGiverId = null;
    game.spectrumOptions = [];
    game.chosenSpectrum = null;
    game.targetPosition = null;
    game.clue = null;
    game.guesses = new Map();
    game.sessionHistory = [];
    game.sessionMode = null;
    game.gamePace = 'realtime';
    game.autoAdvanceRounds = false;
    game.clueOrderState = {
      roundRobinIndex: 0,
      snakeIndex: 0,
      snakeDirection: 1,
      clueTurnsByPlayer: {},
    };

    WavelengthRepository.upsert(game);
    return game;
  }

  setGameOptions(threadId, gamePace, autoAdvanceRounds) {
    const game = this.games.get(threadId);
    if (!game) return null;
    game.gamePace = gamePace;
    game.autoAdvanceRounds = autoAdvanceRounds;
    WavelengthRepository.upsert(game);
    return game;
  }

  toggleAutoAdvance(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;
    game.autoAdvanceRounds = !game.autoAdvanceRounds;
    WavelengthRepository.upsert(game);
    return game.autoAdvanceRounds;
  }

  setSessionMode(threadId, sessionMode) {
    const game = this.games.get(threadId);
    if (!game) return null;
    game.sessionMode = sessionMode;
    game.clueOrderState = {
      roundRobinIndex: 0,
      snakeIndex: 0,
      snakeDirection: 1,
      clueTurnsByPlayer: {},
    };
    WavelengthRepository.upsert(game);
    return game;
  }

  createPlayer(user) {
    return {
      id: user.id,
      username: user.username,
      avatarURL: user.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }),
    };
  }

  startGame(threadId, spectraPool) {
    const game = this.games.get(threadId);
    if (!game) return;

    const playerIds = [...game.players.keys()];
    if (!game.sessionMode) return;
    game.clueGiverId = this.pickClueGiver(game, playerIds);
    if (!game.clueGiverId) return;
    game.targetPosition = Math.floor(Math.random() * 101);

    game.spectrumOptions = sampleN(spectraPool, 2);

    game.guesses = new Map();
    for (const id of playerIds) {
      if (id !== game.clueGiverId) {
        game.guesses.set(id, { position: 50, submitted: false });
      }
    }

    game.phase = 'cluing';
    WavelengthRepository.upsert(game);
  }

  pickClueGiver(game, playerIds) {
    if (playerIds.length === 0) return null;
    const order = game.sessionMode?.clueOrder ?? 'random';
    const state = game.clueOrderState ?? {};

    let selectedId;

    if (order === 'round_robin') {
      const idx = state.roundRobinIndex ?? 0;
      selectedId = playerIds[idx % playerIds.length];
      game.clueOrderState.roundRobinIndex = (idx + 1) % playerIds.length;
    } else if (order === 'snake') {
      if (playerIds.length === 1) {
        selectedId = playerIds[0];
      } else {
        let idx = Math.max(0, Math.min(playerIds.length - 1, state.snakeIndex ?? 0));
        let dir = state.snakeDirection === -1 ? -1 : 1;
        selectedId = playerIds[idx];
        ({ idx, dir } = this.advanceSnakeIndex(idx, dir, playerIds.length));

        game.clueOrderState.snakeIndex = idx;
        game.clueOrderState.snakeDirection = dir;
      }
    } else {
      selectedId = playerIds[Math.floor(Math.random() * playerIds.length)];
    }

    const counts = game.clueOrderState.clueTurnsByPlayer ?? {};
    counts[selectedId] = (counts[selectedId] ?? 0) + 1;
    game.clueOrderState.clueTurnsByPlayer = counts;
    return selectedId;
  }

  advanceSnakeIndex(idx, dir, playerCount) {
    if (playerCount <= 1) return { idx: 0, dir: 1 };
    if (dir === 1) {
      if (idx >= playerCount - 1) return { idx: playerCount - 1, dir: -1 };
      return { idx: idx + 1, dir };
    }
    if (idx <= 0) return { idx: 0, dir: 1 };
    return { idx: idx - 1, dir };
  }
}

module.exports = WavelengthManager;
module.exports.WavelengthGameState = WavelengthGameState;
