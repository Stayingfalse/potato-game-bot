const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { isLibrarian } = require('../roles');
const { endGame } = require('./endGame');
const WerewordsRepository = require('../repository');
const { fetchChannel } = require('../../_core/threads');

const REVEAL_COLOR = 0xFEE75C; // yellow

/** How long the Werewolf has to decide whether to reveal. */
const REVEAL_WINDOW_MS = 90_000;
/** How long a revealed Werewolf has to name the Seer. */
const SEER_PICK_WINDOW_MS = 20_000;

// ── Embed ──────────────────────────────────────────────────────────────────────

function buildRevealEmbed(game) {
  const deadline = game.phaseEndsAt ? `<t:${Math.floor(game.phaseEndsAt / 1000)}:R>` : 'soon';
  const description = game.werewolfRevealed
    ? `The secret word **"${game.word}"** was correctly guessed!\n\n` +
      `😈 **The Werewolf has revealed themselves!** They have until ${deadline} to identify the Seer.`
    : `The secret word **"${game.word}"** was correctly guessed!\n\n` +
      '**Werewolf:** you may now reveal yourself to attempt to identify the Seer.\n' +
      'If you correctly name the Seer, your team steals the win!\n\n' +
      `_If you don't reveal by ${deadline}, the Townsfolk win._`;

  return new EmbedBuilder()
    .setTitle('🔮  Werewords — The Word Was Guessed!')
    .setDescription(description)
    .setColor(REVEAL_COLOR)
    .setTimestamp();
}

// ── Components ─────────────────────────────────────────────────────────────────

/**
 * Before the reveal: the Werewolf's "Reveal Yourself" button. After it: a button
 * that reopens the Werewolf's Seer picker (e.g. after a restart or if they closed it).
 */
function buildRevealComponents(game) {
  const button = game.werewolfRevealed
    ? new ButtonBuilder().setCustomId('ww_seer_panel').setLabel('Pick the Seer').setEmoji('🔮').setStyle(ButtonStyle.Primary)
    : new ButtonBuilder().setCustomId('ww_reveal').setLabel('Reveal Yourself').setEmoji('😈').setStyle(ButtonStyle.Danger);
  return [new ActionRowBuilder().addComponents(button)];
}

/**
 * One button per player who could be the Seer (excludes only the Werewolf themselves).
 * Mayor is included because they may carry a secret Seer role.
 * @param {Map<string, {id: string, username: string, role: string}>} players
 * @param {string} werewolfId
 */
function buildSeerPickComponents(players, werewolfId) {
  const candidates = [...players.values()].filter(
    p => p.id !== werewolfId,
  );

  const rows = [];
  for (let i = 0; i < candidates.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        candidates.slice(i, i + 5).map(p =>
          new ButtonBuilder()
            .setCustomId(`ww_seer_pick_${p.id}`)
            .setLabel(p.username)
            .setStyle(ButtonStyle.Primary),
        ),
      ),
    );
  }
  return rows;
}

// ── Deadline ───────────────────────────────────────────────────────────────────

/**
 * Arms the timeout for the current reveal window from `game.phaseEndsAt`, so a
 * restored game gets only the time it had left. If the window closes, the
 * Townsfolk win.
 */
function scheduleRevealTimeout(game, client) {
  if (game.revealTimeout) clearTimeout(game.revealTimeout);
  const remaining = Math.max(0, (game.phaseEndsAt ?? Date.now()) - Date.now());
  game.revealTimeout = setTimeout(async () => {
    try {
      if (game.phase !== 'reveal') return;
      if (game.werewolfRevealed) {
        const thread = await fetchChannel(client, game.threadId);
        await thread?.send({ content: '⏰ The Werewolf ran out of time to identify the Seer — **Townsfolk win!**' }).catch(() => {});
      }
      await endGame(game, client, 'villagers_word');
    } catch (err) {
      console.error('[Werewords] Reveal timeout error:', err);
    }
  }, remaining);
}

// ── Phase entry point ──────────────────────────────────────────────────────────

/**
 * Transitions the game into the reveal phase.
 * - If there's no Seer in the game the Townsfolk win immediately.
 * - Otherwise the game message moves to the bottom of the thread showing the
 *   Werewolf's reveal prompt, with a 90 s window.
 *
 * @param {import('../state')} game
 * @param {import('discord.js').Client} client
 */
async function startRevealPhase(game, client) {
  client.werewordsManager.clearTimers(game);

  const hasSeer = [...game.players.values()].some(isLibrarian);
  if (!hasSeer) {
    await endGame(game, client, 'villagers_word');
    return;
  }

  game.phase = 'reveal';
  game.werewolfRevealed = false;
  game.phaseEndsAt = Date.now() + REVEAL_WINDOW_MS;
  WerewordsRepository.upsert(game);

  const { moveGameMessage } = require('../gameMessage');
  await moveGameMessage(game, client);
  scheduleRevealTimeout(game, client);
}

module.exports = {
  SEER_PICK_WINDOW_MS,
  startRevealPhase,
  scheduleRevealTimeout,
  buildRevealEmbed,
  buildRevealComponents,
  buildSeerPickComponents,
};
