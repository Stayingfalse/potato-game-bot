'use strict';

/**
 * What players see of the games' stats: the embeds behind /stats and
 * /leaderboard, and the "🏆 Leaderboard" button on a game's results screen.
 *
 * Nothing here knows about individual games. Each game's stats.js says how its
 * numbers read, through `describePlayer(row)` and `leaderboard(guildId)`.
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');

const COLOR = 0xF1C40F;
const TOP = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

/** Users are mentioned so names are current, but nobody is pinged. */
const NO_PINGS = { parse: [] };

// Required when first used, not at the top: games' handlers require this file while the registry is loading them.
const getGames = () => require('./registry').getGames();

/** Games whose stats can be shown, in display order. */
function gamesWithStats() {
  return getGames().filter(game => game.stats?.describePlayer && game.stats?.leaderboard);
}

function findGameWithStats(gameId) {
  return gamesWithStats().find(game => game.id === gameId) ?? null;
}

/** "/wavelength start", for telling players how to get on the board. */
function startCommand(game) {
  return `\`/${game.command.data.name} start\``;
}

function rankLine(row, rank) {
  const place = MEDALS[rank - 1] ?? `**${rank}.**`;
  return `${place} <@${row.user_id}> — **${row.headline}**${row.detail ? ` · ${row.detail}` : ''}`;
}

/**
 * A game's top 10 in a guild. If `viewerId` has played but is further down,
 * their own rank is shown underneath.
 */
function buildLeaderboardEmbed(game, guildId, viewerId = null) {
  const rows = game.stats.leaderboard(guildId);
  const embed = new EmbedBuilder().setTitle(`🏆 ${game.name} Leaderboard`).setColor(COLOR);
  if (rows.length === 0) {
    return embed.setDescription(`No games played yet. Try ${startCommand(game)}.`);
  }

  const lines = rows.slice(0, TOP).map((row, i) => rankLine(row, i + 1));
  const viewerIndex = rows.findIndex(row => row.user_id === viewerId);
  if (viewerIndex >= TOP) lines.push('⋯', rankLine(rows[viewerIndex], viewerIndex + 1));

  return embed
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${rows.length} player${rows.length === 1 ? '' : 's'} ranked` });
}

/**
 * One player's stats: a section for each of `games` they have played.
 * @param {object[]} games  manifests to look in (one game, or all with stats)
 * @param {boolean} isSelf  whether the viewer is looking at their own stats
 */
function buildStatsEmbed(games, guildId, userId, isSelf = true) {
  const embed = new EmbedBuilder().setTitle('📊 Player Stats').setColor(COLOR);
  const sections = games
    .map(game => ({ game, row: game.stats.getPlayer(guildId, userId) }))
    .filter(({ row }) => row);

  if (sections.length === 0) {
    const what = games.length === 1 ? `${games[0].name} games` : 'games';
    const suggestion = games.find(game => game.id === 'wavelength') ?? games[0];
    const tryIt = suggestion ? ` Try ${startCommand(suggestion)}.` : '';
    return embed.setDescription(isSelf
      ? `No ${what} played yet.${tryIt}`
      : `<@${userId}> hasn't played any ${what} yet.`);
  }

  return embed
    .setDescription(`<@${userId}> in this server`)
    .addFields(sections.map(({ game, row }) => ({
      name: game.name,
      value: game.stats.describePlayer(row).map(({ label, value }) => `${label}: **${value}**`).join('\n'),
      inline: true,
    })));
}

/** The reply to a game's "🏆 Leaderboard" button: that game's leaderboard, only for the player who pressed it. */
function replyWithLeaderboard(interaction, gameId) {
  const game = findGameWithStats(gameId);
  if (!game || !interaction.guildId) {
    return interaction.reply({ content: 'The leaderboard isn\'t available here.', flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({
    embeds: [buildLeaderboardEmbed(game, interaction.guildId, interaction.user.id)],
    allowedMentions: NO_PINGS,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  NO_PINGS,
  gamesWithStats,
  findGameWithStats,
  buildLeaderboardEmbed,
  buildStatsEmbed,
  replyWithLeaderboard,
};
