const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { isDemon } = require('../roles');
const { endGame } = require('./endGame');
const WerewordsRepository = require('../repository');

const VOTE_COLOR = 0xEB459E; // pink

const VOTE_DURATION = 60_000; // 60 seconds

// ── Embeds ─────────────────────────────────────────────────────────────────────

function buildWordRevealEmbed(game) {
  return new EmbedBuilder()
    .setTitle('🔤  Werewords — Revealed!')
    .setDescription(
      `Time's up! The secret word was **"${game.word || '*(never chosen)*'}"**.\n\n` +
      'Now vote for who you think the **Werewolf** is!',
    )
    .setColor(VOTE_COLOR)
    .setTimestamp();
}

function buildVoteEmbed(game) {
  const timeStr = `<t:${Math.floor((game.phaseEndsAt ?? Date.now() + VOTE_DURATION) / 1000)}:R>`;
  const voted = [...game.votes.keys()].map(id => `<@${id}>`).join(' ') || '*Nobody yet*';

  return new EmbedBuilder()
    .setTitle('🗳️  Werewords — Vote!')
    .setDescription(
      'Vote for who you think the **Werewolf** is. ' +
      'If the majority picks correctly, the Townsfolk win!\n\n' +
      `Voting closes ${timeStr}. You can change your vote before it ends.`,
    )
    .addFields({ name: `Voted (${game.votes.size} / ${game.players.size})`, value: voted })
    .setColor(VOTE_COLOR)
    .setTimestamp();
}

// ── Components ─────────────────────────────────────────────────────────────────

/**
 * One button per player in the game (everyone can be suspected).
 * Laid out in rows of up to 5.
 * @param {Map<string, {id: string, username: string}>} players
 */
function buildVoteComponents(players) {
  const all = [...players.values()];
  const rows = [];
  for (let i = 0; i < all.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        all.slice(i, i + 5).map(p =>
          new ButtonBuilder()
            .setCustomId(`ww_vote_${p.id}`)
            .setLabel(p.username)
            .setStyle(ButtonStyle.Secondary),
        ),
      ),
    );
  }
  return rows;
}

// ── Tally ──────────────────────────────────────────────────────────────────────

/**
 * Counts current votes, determines the winner, and calls endGame.
 * Tie → werewolf_vote (Demons win). Majority on Demon → townsfolk_vote.
 *
 * @param {import('../state').GameState} game
 * @param {import('discord.js').Client} client
 */
async function tallyVotes(game, client) {
  const tally = new Map(); // targetId → count
  for (const targetId of game.votes.values()) {
    tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }

  // Find player(s) with the most votes.
  let maxVotes = 0;
  for (const count of tally.values()) {
    if (count > maxVotes) maxVotes = count;
  }

  const topTargets = [...tally.entries()]
    .filter(([, count]) => count === maxVotes)
    .map(([id]) => id);

  // Tie → Demons win.
  if (topTargets.length !== 1) {
    await endGame(game, client, 'werewolf_vote');
    return;
  }

  // Check if the top target is the Demon.
  const suspected = game.players.get(topTargets[0]);
  const isWerewolf = isDemon(suspected);

  await endGame(game, client, isWerewolf ? 'villagers_vote' : 'werewolf_vote');
}

// ── Phase entry point ──────────────────────────────────────────────────────────

/**
 * Arms the vote's deadline from `game.phaseEndsAt`, so a restored game gets only
 * the time it had left. When it passes, the votes cast so far are tallied.
 */
function scheduleVoteTimeout(game, client) {
  if (game.revealTimeout) clearTimeout(game.revealTimeout);
  const remaining = Math.max(0, (game.phaseEndsAt ?? Date.now()) - Date.now());
  game.revealTimeout = setTimeout(async () => {
    try {
      if (game.phase !== 'voting') return;
      await tallyVotes(game, client);
    } catch (err) {
      console.error('[Voting] Auto-tally timer error:', err);
    }
  }, remaining);
}

/**
 * Transitions the game into the voting phase: the game message moves to the
 * bottom of the thread showing the word, each player's response cards and the
 * vote, and a 60 s countdown starts.
 *
 * @param {import('../state')} game
 * @param {import('discord.js').Client} client
 */
async function startVotingPhase(game, client) {
  client.werewordsManager.clearTimers(game);

  game.phase = 'voting';
  game.phaseEndsAt = Date.now() + VOTE_DURATION;
  game.responseStatsShown = true;
  WerewordsRepository.upsert(game);

  const { moveGameMessage } = require('../gameMessage');
  await moveGameMessage(game, client);
  scheduleVoteTimeout(game, client);
}

module.exports = {
  startVotingPhase,
  scheduleVoteTimeout,
  tallyVotes,
  buildWordRevealEmbed,
  buildVoteEmbed,
  buildVoteComponents,
};
