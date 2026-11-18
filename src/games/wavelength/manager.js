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
    game.guessEndsAt = null;
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
    game.guessEndsAt = null;
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
    this.dealRound(game, playerIds, spectraPool);
  }

  /**
   * The clue giver isn't giving a clue: hands the round to the next clue giver
   * in the session's order, with a fresh target and spectra. Nothing is scored,
   * and the skipped turn still counts as that player's clue turn.
   * @returns {string|null} the new clue giver's ID, or null if the round can't be skipped
   */
  skipClueGiver(threadId, spectraPool) {
    const game = this.games.get(threadId);
    if (!game || game.phase !== 'cluing' || !game.sessionMode || game.players.size < 2) return null;

    const skippedId = game.clueGiverId;
    const playerIds = [...game.players.keys()];
    // Snake order (at its turn-around) and random order can pick the same player again.
    let nextId = skippedId;
    for (let attempt = 0; attempt < 20 && nextId === skippedId; attempt++) {
      nextId = this.pickClueGiver(game, playerIds);
    }
    if (nextId === skippedId) nextId = playerIds.find(id => id !== skippedId);

    game.clueGiverId = nextId;
    game.chosenSpectrum = null;
    game.clue = null;
    this.dealRound(game, playerIds, spectraPool);
    return nextId;
  }

  /** Deals the round for `game.clueGiverId`: a target, two spectra to choose from and a blank guess for everyone else. */
  dealRound(game, playerIds, spectraPool) {
    game.targetPosition = Math.floor(Math.random() * 101);

    game.spectrumOptions = sampleN(spectraPool, 2);

    game.guesses = new Map();
    game.guessEndsAt = null;
    for (const id of playerIds) {
      if (id !== game.clueGiverId) {
        // touched: the player moved their marker at least once (see countsAsGuess).
        game.guesses.set(id, { position: 50, submitted: false, touched: false });
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

/**
 * Whether a guess takes part in scoring: the player submitted it or moved their
 * marker at least once. Guesses left untouched when the timer ran out are
 * marked `missed` and leave the round out (score, average, spread, image, stats).
 */
function countsAsGuess(guess) {
  return !!guess && !guess.missed && (guess.submitted || guess.touched);
}

/**
 * The guess timer ran out: locks every guess still open. A guess the player
 * moved is kept at its position; one never touched is marked missed.
 */
function lockRemainingGuesses(game) {
  for (const guess of game.guesses.values()) {
    if (guess.submitted) continue;
    guess.submitted = true;
    if (!guess.touched) guess.missed = true;
  }
}

module.exports = { WavelengthManager, WavelengthGameState, MIN_PLAYERS, countsAsGuess, lockRemainingGuesses };
