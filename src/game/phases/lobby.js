const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const LOBBY_COLOR   = 0x5865F2; // Discord blurple
const PLAYING_COLOR = 0xED4245; // Red

// ── Lobby embed ────────────────────────────────────────────────────────────────

/**
 * Builds the public lobby embed shown in the game channel.
 * @param {import('../GameManager').GameState} game
 */
function buildLobbyEmbed(game) {
  const playerLines =
    [...game.players.values()]
      .map((p, i) => `\`${String(i + 1).padStart(2, '0')}.\` <@${p.id}>`)
      .join('\n') || '*No players yet — be the first to join!*';

  return new EmbedBuilder()
    .setTitle('🔮  The Forbidden Word — Lobby')
    .setDescription(
      'A social deduction game of forbidden words and hidden roles.\n' +
      'Click **Join** to enter. The host can **Start** when at least 3 players are ready.',
    )
    .addFields(
      { name: `Players (${game.players.size} / 10)`, value: playerLines },
      { name: '🧵 Game Thread', value: `<#${game.threadId}>` },
    )
    .setColor(LOBBY_COLOR)
    .setFooter({ text: `Host: @${game.hostUsername}  •  Minimum 3 players required` })
    .setTimestamp();
}

// ── Lobby action row ───────────────────────────────────────────────────────────

/**
 * Returns the Join / Leave / Start action row for the lobby.
 * @param {string} threadId  The private game thread ID, embedded in each button's customId.
 */
function buildLobbyComponents(threadId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ww_join_${threadId}`)
        .setLabel('Join')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ww_leave_${threadId}`)
        .setLabel('Leave')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ww_start_${threadId}`)
        .setLabel('Start Game')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ww_cancel_${threadId}`)
        .setLabel('Cancel')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── Active game embed (shown in main channel after game starts) ───────────────

/**
 * Replaces the lobby embed in the main channel once the game has started.
 * Shows the game is underway and links to the private game thread.
 * @param {import('../GameManager').GameState} game
 */
function buildActiveEmbed(game) {
  const playerMentions =
    [...game.players.values()].map(p => `<@${p.id}>`).join(', ');

  return new EmbedBuilder()
    .setTitle('🔮  The Forbidden Word — In Progress')
    .setDescription('A game is currently underway!')
    .addFields(
      { name: 'Players', value: playerMentions },
      { name: '🧵 Game Thread', value: `<#${game.threadId}>` },
    )
    .setColor(PLAYING_COLOR)
    .setFooter({ text: `Host: @${game.hostUsername}` })
    .setTimestamp();
}

// ── Game thread embed (first message posted inside the private thread) ─────────

/**
 * Posted inside the private game thread when the game starts.
 * @param {import('../GameManager').GameState} game
 */
function buildGameThreadEmbed(game) {
  const readyCount = game.readyPlayers?.size ?? 0;
  const totalCount = game.players.size;
  const allReady = readyCount >= totalCount;

  const playerLines = [...game.players.values()].map(p => {
    const isReady = game.readyPlayers?.has(p.id);
    return `${isReady ? '✅' : '⏳'} <@${p.id}>`;
  }).join('\n') || '*No players*';

  return new EmbedBuilder()
    .setTitle('🔮  The Forbidden Word — Game Started!')
    .setDescription(
      allReady
        ? '✅ All players are ready — the game is live!'
        : `Roles have been secretly assigned.\nPress **View Secret Info** to see your role, then click **I'm Ready!** to confirm.\n\n⏳ Waiting for players: **${readyCount} / ${totalCount}** ready`,
    )
    .addFields({ name: 'Player Status', value: playerLines })
    .setColor(PLAYING_COLOR)
    .setFooter({ text: 'Game board loading…' })
    .setTimestamp();
}

// ── Playing-phase components ───────────────────────────────────────────────────

/** Returns the single "View Secret Info" button shown on the playing embed. */
function buildPlayingComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ww_secret')
        .setLabel('View Secret Info')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ww_end_game')
        .setLabel('End Game')
        .setEmoji('🛑')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

/**
 * Returns the Wordsmith's word-picker action row: three preset word buttons and a
 * "Custom Word" button that opens a modal.
 * @param {string[]} wordOptions  Three preset words from game.wordOptions
 */
function buildMayorWordComponents(wordOptions) {
  return [
    new ActionRowBuilder().addComponents(
      ...wordOptions.map((word, i) =>
        new ButtonBuilder()
          .setCustomId(`ww_word_${i}`)
          .setLabel(word)
          .setStyle(ButtonStyle.Primary),
      ),
      new ButtonBuilder()
        .setCustomId('ww_word_custom')
        .setLabel('Custom Word')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── Mode-selection embeds and components ──────────────────────────────────────

/**
 * Embed shown in the main channel while the host selects text vs. voice mode.
 * @param {import('../GameManager').GameState} game
 */
function buildModeSelectingEmbed(game) {
  const playerMentions =
    [...game.players.values()].map(p => `<@${p.id}>`).join(', ');

  return new EmbedBuilder()
    .setTitle('🔮  The Forbidden Word — Choosing Game Mode')
    .setDescription('The host is selecting the play mode in the game thread…')
    .addFields(
      { name: 'Players', value: playerMentions },
      { name: '🧵 Game Thread', value: `<#${game.threadId}>` },
    )
    .setColor(PLAYING_COLOR)
    .setFooter({ text: `Host: @${game.hostUsername}` })
    .setTimestamp();
}

/**
 * Embed posted in the game thread asking the host to choose text or voice mode.
 * @param {import('../GameManager').GameState} game
 */
function buildModeSelectEmbed(game) {
  return new EmbedBuilder()
    .setTitle('🔮  The Forbidden Word — Choose Game Mode')
    .setDescription(
      `<@${game.hostId}>, how will players be making their guesses?\n\n` +
      '📝 **Text Mode** — Players type their guesses in the thread. ' +
      'The Wordsmith responds using the buttons that appear on each guess message.\n\n' +
      '🎙️ **Voice Mode** — Players call out guesses in a voice channel. ' +
      'A response panel is created for each player; the Wordsmith taps the relevant button on the panel to log each response.',
    )
    .setColor(LOBBY_COLOR)
    .setFooter({ text: `Only the host (@${game.hostUsername}) can choose` })
    .setTimestamp();
}

/**
 * Two-button action row for the host to pick text or voice mode.
 */
function buildModeSelectComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ww_mode_text')
        .setLabel('Text Mode')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('ww_mode_voice')
        .setLabel('Voice Mode')
        .setEmoji('🎙️')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

module.exports = {
  buildLobbyEmbed,
  buildLobbyComponents,
  buildActiveEmbed,
  buildGameThreadEmbed,
  buildPlayingComponents,
  buildMayorWordComponents,
  buildModeSelectEmbed,
  buildModeSelectComponents,
  buildModeSelectingEmbed,
};
