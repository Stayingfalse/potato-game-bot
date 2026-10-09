'use strict';

const CheeseThiefRepository = require('../../db/CheeseThiefRepository');

/** Crash recovery: reloads saved Cheese Thief games and re-hooks their timers and buttons. */
async function restore(client) {
  const rows = CheeseThiefRepository.getAll();
  if (rows.length === 0) return;

  const { resumeCheeseThiefGame } = require('./handlers');

  for (const row of rows) {
    if (row.phase === 'ended') {
      CheeseThiefRepository.remove(row.thread_id);
      continue;
    }

    const playersArray = JSON.parse(row.players);
    const players = new Map(playersArray.map(p => [p.id, p]));
    const readyPlayers = new Set(JSON.parse(row.ready_players || '[]'));
    const votes = new Map(Object.entries(JSON.parse(row.votes || '{}')));

    const game = {
      guildId: row.guild_id,
      channelId: row.channel_id,
      threadId: row.thread_id,
      hostId: row.host_id,
      hostUsername: row.host_username,
      messageId: row.message_id,
      readyMessageId: row.ready_message_id,
      phase: row.phase,
      players,
      readyPlayers,
      votes,
      currentWakeNumber: row.current_wake_number ?? 0,
      phaseEndsAt: row.phase_ends_at ?? null,
      cheeseStolen: !!row.cheese_stolen,
      thiefId: row.thief_id ?? null,
      accompliceId: row.accomplice_id ?? null,
      stolenAtWake: row.stolen_at_wake ?? null,
      // In-memory only — start empty after a restart; players must reopen Secret Info
      ephemeralTokens: new Map(),
      playerLogs: new Map(),
      discussionReadyPlayers: new Set(),
      wakeTimeout: null,
      accompliceTimeout: null,
      revealTimeout: null,
      gameNumber: row.game_number ?? 1,
      _createdAt: row.created_at,
    };

    client.cheeseThiefManager.games.set(row.thread_id, game);

    if (row.phase === 'lobby') {
      // Lobby games just need their thread (and the lobby message's join/leave/start buttons,
      // which already carry the thread ID) to still exist — the game state was already
      // restored above. Skip resumeCheeseThiefGame() since its "reopen Secret Info" notice
      // only applies to in-progress rounds.
      const thread = await client.channels.fetch(row.thread_id).catch(() => null);
      if (!thread) {
        CheeseThiefRepository.remove(row.thread_id);
        client.cheeseThiefManager.games.delete(row.thread_id);
      }
      continue;
    }

    const resumed = await resumeCheeseThiefGame(game, client);
    if (!resumed) {
      CheeseThiefRepository.remove(row.thread_id);
      client.cheeseThiefManager.games.delete(row.thread_id);
    }
  }
}

module.exports = restore;
