'use strict';

const WavelengthRepository = require('../db/WavelengthRepository');

class WavelengthGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    this.guildId = guildId;
    this.channelId = channelId;
    this.threadId = threadId;
    this.hostId = hostId;
    this.hostUsername = hostUsername;

    this.messageId = null;

    /** @type {'lobby'|'setup'|'cluing'|'guessing'|'reveal'|'ended'} */
    this.phase = 'lobby';

    /** @type {Map<string, {id:string, username:string, avatarURL:string}>} */
    this.players = new Map();

    this.clueGiverId = null;
    this.spectrumOptions = [];
    this.chosenSpectrum = null;
    this.targetPosition = null;
    this.clue = null;
    this.guesses = new Map();
    this.guessTimeout = null;
    this.autoAdvanceTimeout = null;
    this.gameNumber = 1;
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

class WavelengthManager {
  constructor() {
    this.games = new Map();
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    const game = new WavelengthGameState(guildId, channelId, threadId, hostId, hostUsername);
    game._createdAt = Date.now();
    this.games.set(threadId, game);
    WavelengthRepository.upsert(game);
    return game;
  }

  getGame(threadId) {
    return this.games.get(threadId) ?? null;
  }

  getGameByHost(guildId, hostId) {
    for (const game of this.games.values()) {
      if (game.guildId === guildId && game.hostId === hostId) return game;
    }
    return null;
  }

  deleteGame(threadId) {
    const game = this.games.get(threadId);
    if (!game) return;
    if (game.guessTimeout) {
      clearTimeout(game.guessTimeout);
      game.guessTimeout = null;
    }
    if (game.autoAdvanceTimeout) {
      clearTimeout(game.autoAdvanceTimeout);
      game.autoAdvanceTimeout = null;
    }
    WavelengthRepository.remove(threadId);
    this.games.delete(threadId);
  }

  resetForRematch(threadId, openSignups) {
    const game = this.games.get(threadId);
    if (!game) return null;

    if (game.guessTimeout) {
      clearTimeout(game.guessTimeout);
      game.guessTimeout = null;
    }
    if (game.autoAdvanceTimeout) {
      clearTimeout(game.autoAdvanceTimeout);
      game.autoAdvanceTimeout = null;
    }

    game.gameNumber++;
    game.messageId = null;
    game.phase = openSignups ? 'lobby' : 'cluing';
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

    if (game.guessTimeout) {
      clearTimeout(game.guessTimeout);
      game.guessTimeout = null;
    }
    if (game.autoAdvanceTimeout) {
      clearTimeout(game.autoAdvanceTimeout);
      game.autoAdvanceTimeout = null;
    }

    game.gameNumber = 1;
    game.messageId = null;
    game.phase = openSignups ? 'lobby' : 'setup';
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

  addPlayer(threadId, user) {
    const game = this.games.get(threadId);
    if (!game) return false;
    if (game.players.has(user.id)) return false;
    if (game.players.size >= 20) return false;
    game.players.set(user.id, {
      id: user.id,
      username: user.username,
      avatarURL: user.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }),
    });
    WavelengthRepository.upsert(game);
    return true;
  }

  removePlayer(threadId, userId) {
    const game = this.games.get(threadId);
    if (!game) return false;
    const removed = game.players.delete(userId);
    if (removed) WavelengthRepository.upsert(game);
    return removed;
  }

  startGame(threadId, spectraPool) {
    const game = this.games.get(threadId);
    if (!game) return;

    const playerIds = [...game.players.keys()];
    if (!game.sessionMode) return;
    game.clueGiverId = this.pickClueGiver(game, playerIds);
    if (!game.clueGiverId) return;
    game.targetPosition = Math.floor(Math.random() * 101);

    const pool = [...spectraPool];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    game.spectrumOptions = pool.slice(0, 2);

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
