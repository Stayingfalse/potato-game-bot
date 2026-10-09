'use strict';

const BaseGameManager = require('../_core/BaseGameManager');
const { sampleN } = require('../_core/random');
const WavelengthRepository = require('./repository');
const WavelengthGameState = require('./state');

const MIN_PLAYERS = 2;

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

module.exports = { WavelengthManager, WavelengthGameState, MIN_PLAYERS };
