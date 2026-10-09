'use strict';

/**
 * Fields every game shares. Game-specific state classes extend this and add
 * their own fields in their constructor.
 */
class BaseGameState {
  /**
   * @param {string} guildId
   * @param {string} channelId     channel the game was started from
   * @param {string} threadId      the game thread; also the game's key everywhere
   * @param {string} hostId
   * @param {string} hostUsername
   */
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    this.guildId = guildId;
    this.channelId = channelId;
    this.threadId = threadId;
    this.hostId = hostId;
    this.hostUsername = hostUsername;
    this.messageId = null;
    this.phase = 'lobby';
    /** @type {Map<string, {id: string, username: string}>} userId → player */
    this.players = new Map();
    this.gameNumber = 1;
    this._createdAt = Date.now();
  }
}

module.exports = BaseGameState;
