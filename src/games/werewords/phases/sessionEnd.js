const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ROLES, isDemon, getRoleDisplayName } = require('../roles');
const { recordGame } = require('../stats');
const WerewordsRepository = require('../repository');
const { editMessage } = require('../../_core/messages');

const ROLE_EMOJI = {
  [ROLES.MAYOR]:    '📝',
  [ROLES.WEREWOLF]: '😈',
  [ROLES.SEER]:     '📚',
  [ROLES.VILLAGER]: '🏡',
};

const OUTCOME_COLOR = {
  villagers_word:  0x57F287,
  villagers_vote:  0x57F287,
  werewolf_time:   0xED4245,
  werewolf_tokens: 0xED4245,
  werewolf_seer:   0xED4245,
  werewolf_vote:   0xED4245,
  host_cancelled:  0x5865F2,
};

const OUTCOME_BANNER = {
  villagers_word:  { title: '🎉  Townsfolk Win!',   description: 'The secret word was guessed correctly — and the Werewolf stayed hidden!' },
  villagers_vote:  { title: '🎉  Townsfolk Win!',   description: 'The Townsfolk correctly voted out the Werewolf!' },
  werewolf_time:   { title: '😈  Werewolves Win!',  description: 'Time ran out before the secret word was guessed.' },
  werewolf_tokens: { title: '😈  Werewolves Win!',  description: 'All tokens were exhausted before the secret word was guessed.' },
  werewolf_seer:   { title: '😈  Werewolves Win!',  description: 'The Werewolf revealed and correctly identified the Seer — stealing the win!' },
  werewolf_vote:   { title: '😈  Werewolves Win!',  description: 'The Townsfolk failed to unmask the Werewolf.' },
  host_cancelled:  { title: '🛑  Game Cancelled',   description: 'The host ended the game early. It doesn\'t count towards anyone\'s stats.' },
};

// ── Embeds ─────────────────────────────────────────────────────────────────────

function buildWinnerEmbed(game, outcome) {
  const { title, description } = OUTCOME_BANNER[outcome];
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .addFields({ name: '🔤 Secret Word', value: `**${game.word || '*(never chosen)*'}**` })
    .setColor(OUTCOME_COLOR[outcome])
    .setTimestamp();
}

function buildSessionSummaryEmbed(game, guildStats) {
  // Per-player session record (wins/losses across this session's games).
  const sessionLines = [...game.players.values()].map(p => {
    const record = game.sessionHistory.reduce(
      (acc, g) => {
        const isWinner = g.winners.includes(p.id);
        return { w: acc.w + (isWinner ? 1 : 0), l: acc.l + (isWinner ? 0 : 1) };
      },
      { w: 0, l: 0 },
    );
    return `<@${p.id}> — **${record.w}W / ${record.l}L** this session`;
  });

  // Career totals from persistent stats.
  const careerLines = [...game.players.values()].map(p => {
    const s = guildStats[p.id];
    if (!s) return `<@${p.id}> — no prior stats`;
    const wr = s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 100) : 0;
    return `<@${p.id}> — ${s.gamesPlayed} played · ${s.wins}W/${s.losses}L · ${wr}% win rate`;
  });

  return new EmbedBuilder()
    .setTitle(`📊  Session Summary — ${game.sessionHistory.length} game${game.sessionHistory.length !== 1 ? 's' : ''} played`)
    .addFields(
      { name: 'This Session', value: sessionLines.join('\n') || '*No data*' },
      { name: 'Career Totals', value: careerLines.join('\n') || '*No data*' },
    )
    .setColor(0x5865F2)
    .setTimestamp();
}

function buildRematchComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ww_rematch_same')
        .setLabel('Rematch (Same Group)')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('ww_rematch_open')
        .setLabel('Rematch (Open Sign-ups)')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ww_close_session')
        .setLabel('Close Session')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── Sequential role reveal ─────────────────────────────────────────────────────

/** Posts one message per player, 1.5 s apart, revealing their role. */
async function postSequentialReveal(thread, players) {
  const list = [...players.values()];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const emoji = ROLE_EMOJI[p.role] ?? '❓';
    const roleText = p.role === ROLES.MAYOR && p.secretRole
      ? `${getRoleDisplayName(p.role)} (Secret: ${getRoleDisplayName(p.secretRole)})`
      : getRoleDisplayName(p.role);
    await thread.send({ content: `${emoji}  <@${p.id}> was the **${roleText}**` }).catch(() => {});
    if (i < list.length - 1) await delay(1500);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Player response-card stats ─────────────────────────────────────────────────

/**
 * Builds a per-player summary of how many Yes/No/Maybe/So-Close/Way-Off
 * response cards each player received during the game.
 * @param {import('../state').GameState} game
 * @returns {EmbedBuilder}
 */
function buildPlayerStatsEmbed(game) {
  const lines = [...game.players.values()].map(p => {
    const s = p.responseStats ?? {};
    const yes     = s.yes     ?? 0;
    const no      = s.no      ?? 0;
    const maybe   = s.maybe   ?? 0;
    const soClose = s.soClose ?? 0;
    const wayOff  = s.wayOff  ?? 0;
    return `<@${p.id}> — ✅ **${yes}** Yes ❌ **${no}** No ❔ **${maybe}** Maybe 🔥 **${soClose}** So Close 🚫 **${wayOff}** Way Off`;
  });

  return new EmbedBuilder()
    .setTitle('🃏 Response Cards — This Game')
    .setDescription(lines.join('\n') || '*No responses recorded*')
    .setColor(0xFEE75C)
    .setTimestamp();
}



/**
 * Records a finished game: appends it to the session history and updates player
 * stats, then saves. A game the host cancelled is not recorded.
 *
 * @param {import('../state')} game
 * @param {string} outcome
 * @param {string|null} seerVictimUserId  The userId the Werewolf correctly named as Seer (if any).
 */
function recordResult(game, outcome, seerVictimUserId = null) {
  if (outcome === 'host_cancelled') return;

  const VILLAGER_WIN_OUTCOMES = new Set(['villagers_word', 'villagers_vote']);
  const werewolfWins = !VILLAGER_WIN_OUTCOMES.has(outcome);
  const winnerIds = [...game.players.values()]
    .filter(p => werewolfWins ? isDemon(p) : !isDemon(p))
    .map(p => p.id);

  game.sessionHistory.push({
    gameNumber: game.gameNumber,
    outcome,
    word: game.word,
    winners: winnerIds,
    players: [...game.players.values()].map(p => ({
      id: p.id,
      username: p.username,
      role: p.role,
      secretRole: p.secretRole ?? null,
    })),
  });
  WerewordsRepository.upsert(game);

  recordGame(
    game.guildId,
    game.players,
    outcome,
    game.winnerGuesserUserId,
    seerVictimUserId,
  );
}

/**
 * The end-of-game sequence that follows the result banner (the game message):
 *   1. "🎭 Let's see who everyone was…"
 *   2. Sequential role reveals (1.5 s apart)
 *   3. Response-card stats, if they weren't shown during voting
 *   4. Session summary + rematch/close buttons
 *   5. Update the lobby message
 *
 * @param {import('../state')} game
 * @param {import('discord.js').Client} client
 * @param {string} outcome
 */
async function runEndSequence(game, client, outcome) {
  const thread = await client.channels.fetch(game.threadId).catch(() => null);

  if (thread) {
    await delay(1500);

    // 1. Transition line.
    await thread.send({ content: '🎭 Let\'s see who everyone was…' }).catch(() => {});

    await delay(1000);

    // 2. Sequential role reveal.
    await postSequentialReveal(thread, game.players);

    await delay(1000);

    // 3. Response-card stats (only if not already shown during voting).
    if (!game.responseStatsShown) {
      await thread.send({ embeds: [buildPlayerStatsEmbed(game)] }).catch(() => {});
      await delay(500);
    }
  }

  // 4. Session summary + action buttons.
  const { getGuildStats } = require('../stats');
  const guildStats = getGuildStats(game.guildId);

  if (thread) {
    await thread.send({
      embeds: [buildSessionSummaryEmbed(game, guildStats)],
      components: buildRematchComponents(),
    }).catch(() => {});
  }

  // 5. Update the lobby message at the top of the thread.
  if (thread && game.messageId) {
    const { title } = OUTCOME_BANNER[outcome];
    const waitEmbed = new EmbedBuilder()
      .setTitle(`🔮  Werewords — Game ${game.gameNumber} Complete`)
      .setDescription(`**${title}** — waiting for the host to start the next game or close the session.`)
      .setColor(OUTCOME_COLOR[outcome])
      .setTimestamp();
    await editMessage(thread, game.messageId, { embeds: [waitEmbed], components: [] });
  }
}

module.exports = {
  recordResult,
  runEndSequence,
  buildRematchComponents,
  buildSessionSummaryEmbed,
  buildPlayerStatsEmbed,
  buildWinnerEmbed,
};
