'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { MIN_PLAYERS, MAX_PLAYERS } = require('./manager');
const { CENTRE, formatCell, sameCell } = require('./board');
const {
  CLUE_TURN_CHOICES,
  POINT_CHOICES,
  recommendedClueTurns,
  describeSessionMode,
  isModeComplete,
  evaluateSessionGoal,
  sessionTotals,
  turnPoints,
} = require('./rules');
const { generateBoardImage, generateRevealImage, generateCardImage } = require('./imageGen');

const TITLE = '🎨 Hues & Clues';
const COLOR = { lobby: 0x5865F2, picking: 0xF39C12, guessing: 0x3498DB, ended: 0x2ECC71, closed: 0x95A5A6 };

/**
 * Builds the game message for the current phase. Async because some phases
 * include a generated board image; otherwise it makes no Discord calls.
 *
 * Lobby and setup render into the session message (game.messageId); every turn
 * after that gets its own message (game.turnMessageId), see flow.js.
 *
 * @param {import('./state')} game
 * @param {{ includeControls?: boolean }} [options]  includeControls: false drops the buttons from a results message
 */
async function renderGameMessage(game, options = {}) {
  if (game.phase === 'setup') return renderSetup(game);
  if (game.phase === 'picking') return renderPicking(game);
  if (game.phase === 'guessing') return renderGuessing(game);
  if (game.phase === 'followup') return renderFollowup(game);
  if (game.phase === 'ended') return renderEnded(game, options);
  return renderLobby(game);
}

// ── Lobby and setup ────────────────────────────────────────────────────────────

function renderLobby(game) {
  const players = [...game.players.keys()].map(id => `• <@${id}>`).join('\n') || '*No players yet — be the first to join!*';
  return message([
    container(COLOR.lobby,
      [
        `## ${TITLE} — Lobby Open`,
        `**Host:** <@${game.hostId}>`,
        '',
        'Each turn one player is the **cue giver**: they draw a card of four colours, pick one, and describe it in **one word**.',
        'Everyone else places a token on the 480-colour board. Then the cue giver can add a **second clue** (up to two words) and everyone places a second token.',
        'Tokens score **3** on the colour, **2** inside the 3×3 frame around it and **1** touching the frame. The cue giver scores **1** for every token inside the frame.',
      ].join('\n'),
      `**Players (${game.players.size}/${MAX_PLAYERS})**\n${players}\n\n*At least ${MIN_PLAYERS} players needed.*`,
      buttons(
        button('hc_join', 'Join', '✋', ButtonStyle.Success),
        button('hc_leave', 'Leave', '🚪', ButtonStyle.Secondary),
        button('hc_start', 'Start Game', '▶️', ButtonStyle.Primary),
        button('hc_cancel', 'Cancel', '✖️', ButtonStyle.Danger),
      )),
  ]);
}

function turnOrderText(game) {
  return game.turnOrder.map((id, i) => `**${i + 1}.** <@${id}>`).join('\n');
}

function renderSetup(game) {
  const mode = game.sessionMode;
  if (!isModeComplete(mode)) {
    const intro = `## ${TITLE} — Choose How the Session Ends\nHost <@${game.hostId}>, pick a mode.`;
    if (!mode) {
      return message([container(COLOR.lobby, intro,
        [
          '🔁 **Everyone gives X clues:** each player is cue giver X times.',
          '🏁 **First to X points:** the session ends when someone reaches X.',
          '♾️ **Endless:** play until the host closes the session.',
        ].join('\n'),
        buttons(
          button('hc_mode_turns', 'Everyone gives X clues', '🔁', ButtonStyle.Primary),
          button('hc_mode_points', 'First to X points', '🏁', ButtonStyle.Secondary),
          button('hc_mode_endless', 'Endless', '♾️', ButtonStyle.Success),
        ))]);
    }

    const recommended = recommendedClueTurns(game.turnOrder.length);
    const choices = mode.type === 'clue_turns'
      ? CLUE_TURN_CHOICES.map(n => button(`hc_target_${n}`, n === recommended ? `${n} each (official)` : `${n} each`, null, ButtonStyle.Primary))
      : POINT_CHOICES.map(n => button(`hc_target_${n}`, `${n} pts`, null, ButtonStyle.Primary));
    return message([container(COLOR.lobby, intro,
      `**Mode:** ${describeSessionMode(mode)}\nChoose X:`,
      buttons(...choices, button('hc_mode_back', 'Back', '↩️', ButtonStyle.Secondary)))]);
  }

  return message([container(COLOR.lobby,
    `## ${TITLE} — Game Options\nHost <@${game.hostId}>, check the options and start the game.`,
    [
      `**Mode:** ${describeSessionMode(mode)}`,
      `**Auto-advance:** ${game.autoAdvanceRounds ? '✅ ON — the next turn starts by itself after each reveal' : '❌ OFF — the host presses **Next Turn**'}`,
      '',
      '**🎲 Cue giver order**',
      turnOrderText(game),
    ].join('\n'),
    buttons(
      button('hc_reshuffle', 'Reshuffle', '🔀', ButtonStyle.Secondary),
      autoAdvanceButton(game),
      button('hc_mode_back', 'Change Mode', '↩️', ButtonStyle.Secondary),
      button('hc_begin', 'Start', '▶️', ButtonStyle.Primary),
    ))]);
}

/** What the setup message becomes once the game starts: a record of the mode and order, no buttons. */
function renderSessionStarted(game) {
  return message([container(COLOR.lobby,
    `## ${TITLE} — Game On!`,
    `**Mode:** ${describeSessionMode(game.sessionMode)}\n\n**🎲 Cue giver order**\n${turnOrderText(game)}`)]);
}

// ── A turn ─────────────────────────────────────────────────────────────────────

function turnHeader(game) {
  return `## ${TITLE} — Turn ${game.gameNumber}\n**Cue giver:** <@${game.cueGiverId}>`;
}

function renderPicking(game) {
  return message([container(COLOR.picking,
    turnHeader(game),
    `<@${game.cueGiverId}> is studying their card and choosing a colour to describe…\n\n*The clue will appear here when it's ready.*`,
    buttons(button('hc_cue_panel', 'Open Cue Giver Panel', '🎨', ButtonStyle.Primary)))]);
}

function submissionsText(game) {
  const lines = [...game.tokens].map(([id, token]) => (token.cells.length >= game.guessRound ? `✅ <@${id}>` : `⏳ <@${id}>`));
  const done = lines.filter(line => line.startsWith('✅')).length;
  return `**📊 Tokens placed — ${done}/${lines.length}**\n${lines.join('\n')}`;
}

async function renderGuessing(game) {
  const round = game.guessRound;
  const intro = round === 1
    ? 'Press **Place Your Token** to line up your token on the board, then **Lock In**.'
    : 'Everyone\'s first tokens are on the board below. Place your **second** token!';
  const files = [];
  const parts = [container(COLOR.guessing,
    `${turnHeader(game)}\n\n${cluesText(game.clues)}`,
    `${intro}\n\n${submissionsText(game)}`,
    buttons(
      button('hc_guess_panel', round === 1 ? 'Place Your Token' : 'Place Your Second Token', '📍', ButtonStyle.Primary),
      button('hc_force_lock', 'Lock Remaining (host)', '⏩', ButtonStyle.Secondary),
    ))];
  if (round === 2) await addImage(parts, files, await firstTokensImage(game), 'huesclues_board.png', COLOR.guessing);
  return message(parts, files);
}

async function renderFollowup(game) {
  const files = [];
  const parts = [container(COLOR.picking,
    `${turnHeader(game)}\n\n${cluesText(game.clues)}`,
    `Everyone has placed their first token. <@${game.cueGiverId}>, give a **second clue** (up to two words) — or say nothing more. Either way, everyone then places a second token.`,
    buttons(
      button('hc_clue2', 'Give Second Clue', '💬', ButtonStyle.Primary),
      button('hc_no_more', 'Nothing More to Say', '🤐', ButtonStyle.Secondary),
      button('hc_cue_panel', 'View My Card', '🎨', ButtonStyle.Secondary),
    ))];
  await addImage(parts, files, await firstTokensImage(game), 'huesclues_board.png', COLOR.picking);
  return message(parts, files);
}

function tokenArt(game, userId, cell, ring) {
  const player = game.players.get(userId);
  return { cell, ring, username: player?.username ?? '?', avatarURL: player?.avatarURL ?? null };
}

function firstTokensImage(game) {
  const tokens = [...game.tokens].map(([id, t]) => tokenArt(game, id, t.cells[0], 1));
  return tryImage(() => generateBoardImage({ title: `Turn ${game.gameNumber} · first tokens`, tokens }));
}

// ── Results ────────────────────────────────────────────────────────────────────

async function renderEnded(game, { includeControls = true } = {}) {
  const turn = game.sessionHistory.at(-1);
  if (!turn) return message([container(COLOR.ended, `## ${TITLE}`, '*No turn has been scored yet.*')]);

  const goal = evaluateSessionGoal(game);
  const files = [];
  const parts = [container(COLOR.ended, `## ${TITLE} — Turn ${turn.turnNumber} Results\n${cluesText(turn.clues)}`)];
  await addImage(parts, files, await revealImage(game, turn), 'huesclues_reveal.png', COLOR.ended);
  parts.push(container(COLOR.ended, breakdownText(turn)));

  const summary = container(COLOR.lobby, summaryText(game, goal));
  if (includeControls) summary.addActionRowComponents(endedControls(game, goal));
  parts.push(summary);
  return message(parts, files);
}

function cluesText(clues) {
  return clues.map((clue, i) => (clue === null ? '> 🤐 *Nothing more to say*' : `> 💬 **Clue ${i + 1}:** "${clue}"`)).join('\n');
}

function revealImage(game, turn) {
  const tokens = Object.entries(turn.tokens).flatMap(([id, cells]) => cells.map((cell, i) => tokenArt(game, id, cell, i + 1)));
  const thisTurn = turnPoints(turn);
  const scoreRows = sessionTotals(game).map(({ userId, total }) => ({
    ...tokenArt(game, userId, null, null),
    turnPoints: thisTurn[userId] ?? 0,
    total,
    isCueGiver: userId === turn.cueGiverId,
  }));
  const title = `Turn ${turn.turnNumber} · target ${formatCell(turn.target)}`;
  return tryImage(() => generateRevealImage({ title, target: turn.target, tokens, scoreRows }));
}

function breakdownText(turn) {
  const guesserLines = Object.entries(turn.scores.guessers).map(([id, { points, total }]) => {
    const cells = turn.tokens[id].map((cell, i) => (cell ? `${sameCell(cell, turn.target) ? '🎯 ' : ''}\`${formatCell(cell)}\` +${points[i]}` : '*no token*'));
    return `<@${id}> — ${cells.join(' · ')} = **${total}**`;
  });
  const cue = turn.scores.cueGiver;
  return [
    `🎯 **Target:** \`${formatCell(turn.target)}\``,
    '',
    '**📊 Guessers**',
    guesserLines.join('\n') || '*No guessers.*',
    '',
    '**🎨 Cue giver**',
    `<@${cue.id}> — ${cue.inFrame} token${cue.inFrame === 1 ? '' : 's'} inside the frame = **${cue.total}**`,
  ].join('\n');
}

function standingsText(game) {
  const totals = sessionTotals(game);
  return totals.length > 0
    ? totals.map((entry, i) => `**${i + 1}.** <@${entry.userId}> — **${entry.total} pts**`).join('\n')
    : '*No scores yet.*';
}

function summaryText(game, goal) {
  const autoAdvancing = game.advanceAt && !goal.complete;
  return [
    `**Mode:** ${describeSessionMode(game.sessionMode)}`,
    '',
    '**📈 Running Totals**',
    standingsText(game),
    goal.message ? `\n**${goal.complete ? '🏁 Session Over' : '📌 Goal'}**\n${goal.message}` : null,
    autoAdvancing ? `\n🔄 **Auto-advance is ON** — the next turn starts <t:${Math.ceil(game.advanceAt / 1000)}:R>.` : null,
  ].filter(line => line !== null).join('\n');
}

function endedControls(game, goal) {
  if (game.advanceAt && !goal.complete) {
    return buttons(autoAdvanceButton(game), button('hc_close', 'End Game & Close Session', '🔒', ButtonStyle.Danger));
  }
  return buttons(
    button('hc_next', 'Next Turn', '🔄', ButtonStyle.Primary).setDisabled(goal.complete),
    button('hc_new_game', 'New Game (Open Signups)', '📋', ButtonStyle.Secondary),
    autoAdvanceButton(game),
    button('hc_close', 'End Game & Close Session', '🔒', ButtonStyle.Danger),
  );
}

/** The final message posted when the session closes. */
function renderClosed(game, reason) {
  const goal = evaluateSessionGoal(game);
  return message([container(COLOR.closed,
    `## ${TITLE} — Session Closed\n${reason}`,
    [
      '**📈 Final Standings**',
      standingsText(game),
      goal.complete ? `\n**🏁 Goal Reached**\n${goal.message}` : null,
    ].filter(line => line !== null).join('\n'))]);
}

/** What a finished turn message becomes: a link to where the game went next. */
function renderPointer(text) {
  return message([container(COLOR.ended, text)]);
}

// ── Private panels (ephemeral) ─────────────────────────────────────────────────

/** The cue giver's card: pick a colour, then give the first clue. */
async function renderCuePanel(game) {
  const image = await tryImage(() => generateCardImage(game.card, game.targetIndex));
  const files = image ? [new AttachmentBuilder(image, { name: 'huesclues_card.png' })] : [];
  const cardList = game.card.map((cell, i) => `${i + 1} · \`${formatCell(cell)}\``).join('   ');

  if (game.phase !== 'picking') {
    return { content: `🎨 **Your colour:** \`${formatCell(game.target)}\` (colour ${game.targetIndex + 1} on your card)`, components: [], files };
  }

  const picked = game.targetIndex !== null;
  return {
    content: [
      `🎨 **Your card:** ${cardList}`,
      picked
        ? `You're describing **colour ${game.targetIndex + 1}** (\`${formatCell(game.target)}\`). Give a **one-word** clue, or pick a different colour.`
        : 'Pick the colour you\'ll describe.',
      '*Clue rules: no basic colour names (red, blue…) and no grid refs.*',
    ].join('\n'),
    components: [
      buttons(...game.card.map((cell, i) => button(
        `hc_pick_${i}`, `${i + 1} · ${formatCell(cell)}`, null, i === game.targetIndex ? ButtonStyle.Success : ButtonStyle.Secondary,
      ))),
      buttons(button('hc_clue1', 'Give One-Word Clue', '💬', ButtonStyle.Primary).setDisabled(!picked)),
    ],
    files,
  };
}

/** A guesser's token: a preview on the board, with buttons to move it and lock it in. */
async function renderGuessPanel(game, userId) {
  const token = game.tokens.get(userId);
  const locked = token.cells.length >= game.guessRound;
  const cell = locked ? token.cells[game.guessRound - 1] : token.draft ?? CENTRE;

  const others = game.guessRound === 2
    ? [...game.tokens].filter(([id]) => id !== userId).map(([id, t]) => tokenArt(game, id, t.cells[0], 1))
    : [];
  const own = [
    ...(game.guessRound === 2 ? [tokenArt(game, userId, token.cells[0], 1)] : []),
    ...(cell ? [tokenArt(game, userId, cell, locked ? game.guessRound : 'draft')] : []),
  ];
  const clues = game.clues.filter(clue => clue !== null).map(clue => `"${clue}"`).join(' · ');
  const image = await tryImage(() => generateBoardImage({ title: `Clue: ${clues}`, tokens: [...others, ...own] }));
  const files = image ? [new AttachmentBuilder(image, { name: 'huesclues_token.png' })] : [];

  const ordinal = game.guessRound === 1 ? 'first' : 'second';
  const content = locked
    ? (cell ? `✅ Your ${ordinal} token is locked in at **${formatCell(cell)}**. Waiting for the others…` : `⏩ The ${ordinal} round was closed before you placed a token.`)
    : `📍 Your ${ordinal} token is on **${formatCell(cell)}**. Move it with the arrows or type a grid ref (like \`F12\`), then **Lock In**.`;

  return {
    content,
    components: [
      buttons(
        button('hc_move_left', null, '⬅️', ButtonStyle.Secondary).setDisabled(locked),
        button('hc_move_up', null, '⬆️', ButtonStyle.Secondary).setDisabled(locked),
        button('hc_move_down', null, '⬇️', ButtonStyle.Secondary).setDisabled(locked),
        button('hc_move_right', null, '➡️', ButtonStyle.Secondary).setDisabled(locked),
      ),
      buttons(
        button('hc_type_ref', 'Type Grid Ref', '✏️', ButtonStyle.Secondary).setDisabled(locked),
        button('hc_lock', locked ? 'Locked In' : 'Lock In', '✅', locked ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(locked),
      ),
    ],
    files,
  };
}

// ── Small builders ─────────────────────────────────────────────────────────────

/** Image generation must never break a turn: log the error and carry on without the picture. */
async function tryImage(generate) {
  try {
    return await generate();
  } catch (err) {
    console.error('[Hues & Clues] Image generation failed:', err);
    return null;
  }
}

async function addImage(parts, files, buffer, name, accent) {
  if (!buffer) return;
  files.push(new AttachmentBuilder(buffer, { name }));
  parts.push(new ContainerBuilder().setAccentColor(accent).addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)),
  ));
}

/**
 * A message payload. `attachments: []` is always sent so an edit drops any
 * image the message had before (files sent with it are kept).
 */
function message(components, files = []) {
  return { components, flags: MessageFlags.IsComponentsV2, files, attachments: [] };
}

function container(accent, header, body, actionRow) {
  const box = new ContainerBuilder().setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
  if (body) {
    box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }
  if (actionRow) box.addActionRowComponents(actionRow);
  return box;
}

function buttons(...items) {
  return new ActionRowBuilder().addComponents(...items);
}

function button(customId, label, emoji, style) {
  const built = new ButtonBuilder().setCustomId(customId).setStyle(style);
  if (label) built.setLabel(label);
  if (emoji) built.setEmoji(emoji);
  return built;
}

function autoAdvanceButton(game) {
  return button('hc_toggle_auto', game.autoAdvanceRounds ? 'Auto-advance: ON' : 'Auto-advance: OFF', game.autoAdvanceRounds ? '✅' : '❌',
    game.autoAdvanceRounds ? ButtonStyle.Success : ButtonStyle.Secondary);
}

module.exports = {
  renderGameMessage,
  renderSessionStarted,
  renderClosed,
  renderPointer,
  renderCuePanel,
  renderGuessPanel,
};
