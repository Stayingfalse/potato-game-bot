'use strict';

const BaseGameState = require('../_core/BaseGameState');

/**
 * In-memory state of one Articulate session. BaseGameState provides guildId,
 * channelId, threadId, hostId, hostUsername, messageId, phase, players (Map),
 * gameNumber and _createdAt. Saved to `articulate_games` through toRow / fromRow.
 */
class ArticulateGameState extends BaseGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    // phase: 'lobby' | 'setup' | 'ready' | 'describing' | 'spin' | 'control' | 'turnover' | 'ended'
    //   setup:      teams are picked and options chosen (in the session message, messageId)
    //   ready:      a team's turn is up; its describers open their panel and start the timer
    //   describing: the timer is running
    //   spin:       the team landed on a Spin square and spins for a bonus
    //   control:    a ♠ entry described to every team (a Control square, or reaching the finish)
    //   turnover:   the turn is done; the next team's turn starts straight away
    //   ended:      a team has won
    // Each turn gets its own message (turnMessageId).

    this.turnMessageId = null;
    this.options = { teamCount: 2, teamMethod: null, turnSeconds: 30, singleDescriber: false, voiceChannelId: null };
    /** @type {Array<{name, emoji, color, playerIds: string[], position: number, describerIndex: number}>} */
    this.teams = [];
    /** Teams from the last game, for "keep teams". */
    this.previousTeams = null;
    /** Captains' draft: { ids: captain per team, pickNumber }. */
    this.draft = null;

    this.currentTeam = 0;
    this.turnNumber = 0;
    this.describerIds = [];
    /**
     * The timed part of a turn:
     * { category: string|null (null = ♠ entries), card, cardNumber, correct: card[], passed: card[],
     *   passesLeft, endsAt, foulBy }
     */
    this.turn = null;
    /** The current Control round: { reason: 'square'|'finish', card, cardNumber }. */
    this.control = null;
    /** The last spin: { angle, key, steps }, and whether its bonus has been used. */
    this.spinResult = null;
    /** Who takes the next turn when it isn't simply the next team (a Control winner). */
    this.nextTeamOverride = null;
    /** category → words drawn this session, so entries don't repeat. */
    this.used = {};
    this.winnerTeam = null;

    /** setTimeout handle for the end of the describing timer. Not saved; listed in the manager's timerKeys. */
    this.turnTimeout = null;
    /** userId → their open describer panel interaction, so every describer's panel can be kept in step. Not saved. */
    this.panels = new Map();
  }

  get team() {
    return this.teams[this.currentTeam] ?? null;
  }

  /** Rehydrates a game from its saved `articulate_games` row. */
  static fromRow(row) {
    const game = new ArticulateGameState(row.guild_id, row.channel_id, row.thread_id, row.host_id, row.host_username);
    game.messageId = row.message_id;
    game.turnMessageId = row.turn_message_id ?? null;
    game.phase = row.phase;
    game.players = new Map(JSON.parse(row.players || '[]').map(p => [p.id, p]));
    game.options = JSON.parse(row.options || '{}');
    game.teams = JSON.parse(row.teams || '[]');
    game.previousTeams = row.previous_teams ? JSON.parse(row.previous_teams) : null;
    game.draft = row.draft ? JSON.parse(row.draft) : null;
    game.currentTeam = row.current_team;
    game.turnNumber = row.turn_number;
    game.describerIds = JSON.parse(row.describer_ids || '[]');
    game.turn = row.turn ? JSON.parse(row.turn) : null;
    game.control = row.control ? JSON.parse(row.control) : null;
    game.spinResult = row.spin_result ? JSON.parse(row.spin_result) : null;
    game.nextTeamOverride = row.next_team_override ?? null;
    game.used = JSON.parse(row.used || '{}');
    game.winnerTeam = row.winner_team ?? null;
    game.gameNumber = row.game_number;
    game._createdAt = row.created_at;
    return game;
  }

  /** Maps a game to its `articulate_games` row. Its keys are the columns written on every save. */
  static toRow(game) {
    return {
      thread_id:          game.threadId,
      guild_id:           game.guildId,
      channel_id:         game.channelId,
      host_id:            game.hostId,
      host_username:      game.hostUsername,
      message_id:         game.messageId ?? null,
      turn_message_id:    game.turnMessageId ?? null,
      phase:              game.phase,
      players:            JSON.stringify([...game.players.values()]),
      options:            JSON.stringify(game.options),
      teams:              JSON.stringify(game.teams),
      previous_teams:     game.previousTeams ? JSON.stringify(game.previousTeams) : null,
      draft:              game.draft ? JSON.stringify(game.draft) : null,
      current_team:       game.currentTeam,
      turn_number:        game.turnNumber,
      describer_ids:      JSON.stringify(game.describerIds),
      turn:               game.turn ? JSON.stringify(game.turn) : null,
      control:            game.control ? JSON.stringify(game.control) : null,
      spin_result:        game.spinResult ? JSON.stringify(game.spinResult) : null,
      next_team_override: game.nextTeamOverride ?? null,
      used:               JSON.stringify(game.used),
      winner_team:        game.winnerTeam ?? null,
      game_number:        game.gameNumber,
      created_at:         game._createdAt ?? Date.now(),
    };
  }
}

module.exports = ArticulateGameState;
