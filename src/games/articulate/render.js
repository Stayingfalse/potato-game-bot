'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { MIN_PLAYERS, MAX_PLAYERS } = require('./manager');
const { CATEGORIES, FINISH, describeSquare } = require('./board');
const { TURN_SECONDS_CHOICES, maxTeamsFor, teamOf, teamsReady, draftPicker } = require('./rules');
const { generateBoardImage } = require('./imageGen');

const TITLE = '🗣️ Articulate';
const COLOR = { lobby: 0x5865F2, turn: 0xF39C12, live: 0x3498DB, control: 0xECF0F1, done: 0x2ECC71, closed: 0x95A5A6 };
const RULES_REMINDER = 'No saying the word or any part of it, no "sounds like" or "rhymes with", and no letters or letter counts. Acting and miming are fine.';

/**
 * Builds the game message for the current phase. Async because turn messages
 * include a generated board image; otherwise it makes no Discord calls.
 *
 * Lobby and setup render into the session message (game.messageId); every turn
 * after that gets its own message (game.turnMessageId), see flow.js.
 *
 * @param {import('./state')} game
 * @param {{ voiceMissing?: string[], includeControls?: boolean }} [options]
 *   voiceMissing: team members not in the voice channel; includeControls: false drops the winner's buttons
 */
async function renderGameMessage(game, options = {}) {
  if (game.phase === 'setup') return renderSetup(game);
  if (game.phase === 'ready' || game.phase === 'describing') return renderTurn(game, options);
  if (game.phase === 'spin') return renderSpin(game);
  if (game.phase === 'control') return renderControl(game);
  if (game.phase === 'ended') return renderWinner(game, options);
  return renderLobby(game);
}

const mention = id => `<@${id}>`;
const teamLabel = team => `${team.emoji} Team ${team.name}`;

function categoryLabel(category) {
  return category ? `${CATEGORIES[category].emoji} ${CATEGORIES[category].name}` : '♠ Any category';
}

// ── Lobby and setup ────────────────────────────────────────────────────────────

function renderLobby(game) {
  const players = [...game.players.keys()].map(id => `• ${mention(id)}`).join('\n') || '*No players yet — be the first to join!*';
  return message([container(COLOR.lobby,
    [
      `## ${TITLE} — Lobby Open`,
      `**Host:** ${mention(game.hostId)}`,
      '',
      'Teams race around the board. On your turn your team\'s describer has **30 seconds** to describe as many words as they can from your square\'s category, over **voice chat**. Every correct guess moves you on a square.',
      'Land on ♠ to describe to **every** team, land on a Spin square to spin for a bonus, and win a ♠ round on the finish to win the game.',
    ].join('\n'),
    `**Players (${game.players.size}/${MAX_PLAYERS})**\n${players}\n\n*At least ${MIN_PLAYERS} players needed (two teams of two). Join the voice channel to play.*`,
    buttons(
      button('ar_join', 'Join', '✋', ButtonStyle.Success),
      button('ar_leave', 'Leave', '🚪', ButtonStyle.Secondary),
      button('ar_start', 'Start', '▶️', ButtonStyle.Primary),
      button('ar_cancel', 'Cancel', '✖️', ButtonStyle.Danger),
    ))]);
}

function teamsText(game) {
  if (game.teams.length === 0) return '*Choose how to pick teams.*';
  const captains = new Set(game.draft?.ids ?? []);
  const lines = game.teams.map(team => `${team.emoji} **${team.name}** — ${team.playerIds.map(id => `${mention(id)}${captains.has(id) ? ' 🧢' : ''}`).join(', ') || '*nobody yet*'}`);
  const unassigned = [...game.players.keys()].filter(id => teamOf(game.teams, id) === null);
  if (unassigned.length > 0) lines.push(`⏳ **Not in a team** — ${unassigned.map(mention).join(', ')}`);
  return lines.join('\n');
}

function renderSetup(game) {
  const { teamCount, teamMethod, turnSeconds, singleDescriber, voiceChannelId } = game.options;
  const maxTeams = maxTeamsFor(game.players.size);
  const ready = teamsReady(game.teams, [...game.players.keys()]);

  const box = new ContainerBuilder().setAccentColor(COLOR.lobby)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${TITLE} — Set Up\nHost ${mention(game.hostId)}: choose the teams and options, then start.`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**👥 Teams**'));

  box.addActionRowComponents(buttons(...[2, 3, 4].map(n => button(`ar_teams_${n}`, `${n} teams`, null, n === teamCount ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(n > maxTeams))));
  box.addActionRowComponents(buttons(
    methodButton('random', 'Random', '🎲', teamMethod),
    methodButton('choose', 'Pick your team', '✋', teamMethod),
    methodButton('captains', 'Captains\' draft', '🧢', teamMethod),
    methodButton('keep', 'Keep teams', '♻️', teamMethod).setDisabled(!game.previousTeams),
  ));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(teamsText(game)));

  if (teamMethod === 'random') {
    box.addActionRowComponents(buttons(button('ar_reshuffle', 'Reshuffle', '🔀', ButtonStyle.Secondary)));
  } else if (teamMethod === 'choose') {
    box.addActionRowComponents(buttons(
      ...game.teams.map((team, i) => button(`ar_join_team_${i}`, `Join ${team.name}`, team.emoji, ButtonStyle.Primary)),
      button('ar_place_rest', 'Place the rest', '🎲', ButtonStyle.Secondary),
    ));
  } else if (teamMethod === 'captains') {
    const undrafted = [...game.players.keys()].filter(id => teamOf(game.teams, id) === null);
    if (undrafted.length > 0) {
      const captainId = game.draft.ids[draftPicker(game.draft.ids.length, game.draft.pickNumber)];
      const team = game.teams[teamOf(game.teams, captainId)];
      box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`🧢 ${mention(captainId)}, pick a player for ${teamLabel(team)}.`));
      box.addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId('ar_draft')
        .setPlaceholder('Pick a player…')
        .addOptions(undrafted.slice(0, 25).map(id => ({ label: game.players.get(id)?.username ?? id, value: id })))));
    }
    box.addActionRowComponents(buttons(button('ar_new_captains', 'New captains', '🔀', ButtonStyle.Secondary)));
  }

  box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '**⚙️ Options**',
      `🔊 **Voice channel:** ${voiceChannelId ? `<#${voiceChannelId}>` : '*not set — choose one below*'}`,
      `⏱️ **Timer:** ${turnSeconds} seconds${turnSeconds === 30 ? ' (official)' : ''}`,
      `🗣️ **Describers:** ${singleDescriber ? 'one per turn (advanced variation)' : 'standard — two for teams of three or more'}`,
    ].join('\n')));
  box.addActionRowComponents(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder()
    .setCustomId('ar_voice')
    .setPlaceholder('Choose the voice channel…')
    .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)));
  box.addActionRowComponents(buttons(
    ...TURN_SECONDS_CHOICES.map(s => button(`ar_timer_${s}`, `${s}s`, '⏱️', s === turnSeconds ? ButtonStyle.Success : ButtonStyle.Secondary)),
    button('ar_describers', singleDescriber ? 'One describer' : 'Standard describers', '🗣️', ButtonStyle.Secondary),
  ));
  box.addActionRowComponents(buttons(
    button('ar_begin', 'Start Game', '▶️', ButtonStyle.Primary).setDisabled(!ready),
    button('ar_cancel', 'Cancel', '✖️', ButtonStyle.Danger),
  ));
  return message([box]);
}

function methodButton(method, label, emoji, current) {
  return button(`ar_method_${method}`, label, emoji, method === current ? ButtonStyle.Success : ButtonStyle.Secondary);
}

/** What the setup message becomes once the game starts: the teams, no buttons. */
function renderSessionStarted(game) {
  const voice = game.options.voiceChannelId ? `\n\n🔊 Playing in <#${game.options.voiceChannelId}>` : '';
  return message([container(COLOR.lobby, `## ${TITLE} — Game ${game.gameNumber}`, `${teamsText(game)}${voice}`)]);
}

// ── A turn ─────────────────────────────────────────────────────────────────────

function turnHeading(game) {
  return `## ${TITLE} — Turn ${game.turnNumber}\n### ${teamLabel(game.team)} · ${categoryLabel(game.turn.category)}`;
}

function describersLine(game) {
  const guessers = game.team.playerIds.filter(id => !game.describerIds.includes(id));
  return `🗣️ **Describing:** ${game.describerIds.map(mention).join(' & ')}\n👂 **Guessing:** ${guessers.map(mention).join(', ')}`;
}

function voiceLine(game, missing = []) {
  if (!game.options.voiceChannelId) return null;
  const warning = missing.length > 0 ? `\n⚠️ Not in voice: ${missing.map(mention).join(', ')}` : '';
  return `🔊 <#${game.options.voiceChannelId}>${warning}`;
}

async function renderTurn(game, { voiceMissing = [] } = {}) {
  const live = game.phase === 'describing';
  const { turn } = game;
  const status = live
    ? `⏱️ **Time's up <t:${Math.ceil(turn.endsAt / 1000)}:R>** · ✅ **${turn.correct.length}** · ${turn.passesLeft > 0 ? '⏭️ pass available' : '⏭️ pass used'}`
    : `Describers: open your panel, get your team ready, then press **Start** — you'll have **${game.options.turnSeconds} seconds**.`;
  const squareNote = turn.category === null ? '\n*Your team is on a ♠ square, so every card is its ♠ entry.*' : '';

  const files = [];
  const parts = [container(live ? COLOR.live : COLOR.turn,
    turnHeading(game),
    [describersLine(game), voiceLine(game, voiceMissing), '', `${status}${squareNote}`].filter(line => line !== null).join('\n'),
    buttons(
      button('ar_panel', 'Describer Panel', '🎴', ButtonStyle.Primary),
      button('ar_foul', 'Foul', '🚩', ButtonStyle.Danger).setDisabled(!live),
    ))];
  await addBoard(parts, files, game, `Turn ${game.turnNumber} · ${game.team.name} to play`);
  return message(parts, files);
}

/** The turn's result so far, for the turn message once the timer stops. */
function turnResultText(game, moved) {
  const { turn, team } = game;
  const words = cards => cards.map(card => card.word).join(' · ');
  return [
    turn.correct.length > 0 ? `✅ **${turn.correct.length}:** ${words(turn.correct)}` : '✅ **0**',
    turn.passed.length > 0 ? `⏭️ **Passed:** ${words(turn.passed)}` : null,
    turn.foulBy ? `🚩 **Foul** called by ${mention(turn.foulBy)} — the turn is forfeited.` : null,
    `➡️ ${teamLabel(team)} moved **${moved}** to **${describeSquare(team.position)}** (square ${team.position}/${FINISH}).`,
  ].filter(line => line !== null).join('\n');
}

async function renderSpin(game) {
  const { team, spinResult } = game;
  const moved = game.turn.foulBy ? 0 : game.turn.correct.length;
  const files = [];
  let body;
  let row;
  if (!spinResult) {
    body = `🎡 **Spin square!** ${teamLabel(team)}, spin for a bonus.`;
    row = buttons(button('ar_spin', 'Spin', '🎡', ButtonStyle.Primary));
  } else {
    const kind = spinResult.key === 'narrow' ? 'Narrow green' : 'Wide green';
    body = `🎡 **${kind} — ${spinResult.steps} squares!** Move ${teamLabel(team)} forward, or send another team back (not past the start).`;
    row = buttons(...game.teams.map((t, i) => (i === game.currentTeam
      ? button(`ar_bonus_${i}`, `${t.name} forward ${spinResult.steps}`, '⏩', ButtonStyle.Success)
      : button(`ar_bonus_${i}`, `${t.name} back ${spinResult.steps}`, '⏪', ButtonStyle.Secondary).setDisabled(t.position === 0))));
  }
  const parts = [container(COLOR.turn, turnHeading(game), `${turnResultText(game, moved)}\n\n${body}`, row)];
  if (spinResult) await addBoard(parts, files, game, `Turn ${game.turnNumber} · ${team.name} spun`, spinResult.angle);
  return message(parts, files);
}

async function renderControl(game) {
  const { control, team } = game;
  const intro = control.reason === 'finish'
    ? `🏁 ${teamLabel(team)} ${game.turn.correct.length > 0 ? 'reached' : 'are on'} the finish! Win this ♠ round to win the game.`
    : `♠ ${teamLabel(team)} landed on a Control square.`;
  const result = game.turn.endsAt ? `${turnResultText(game, game.turn.foulBy ? 0 : game.turn.correct.length)}\n\n` : '';
  return message([container(COLOR.control,
    `## ${TITLE} — Turn ${game.turnNumber}\n### ♠ Control Round`,
    [
      `${result}${intro}`,
      '',
      `${game.describerIds.map(mention).join(' & ')} describe${game.describerIds.length === 1 ? 's' : ''} a ♠ entry to **every team** — no time limit. The first team to shout the answer wins${control.reason === 'finish' ? '' : ' and takes the next turn'}.`,
    ].join('\n'),
    buttons(button('ar_panel', 'Describer Panel', '🎴', ButtonStyle.Primary)))]);
}

/** The turn message once the turn is over: what happened, no buttons. The board moves to the next turn's message. */
function renderTurnSummary(game) {
  const { turn, spinResult, control } = game;
  const lines = [];
  if (turn.endsAt) lines.push(turnResultText(game, turn.foulBy ? 0 : turn.correct.length));
  if (spinResult) {
    const target = spinResult.target !== undefined ? game.teams[spinResult.target] : null;
    lines.push(spinResult.steps === 0
      ? '🎡 Spun: no bonus.'
      : `🎡 Spun ${spinResult.steps}: ${target === game.team ? `${teamLabel(target)} moved forward` : `${teamLabel(target)} sent back`} to **${describeSquare(target.position)}**.`);
  }
  if (control?.winner !== undefined) {
    lines.push(`♠ Control: **${control.card.word}** (${categoryLabel(control.card.category)}) — won by ${teamLabel(game.teams[control.winner])}${control.reason === 'finish' && control.winner !== game.currentTeam ? `, so ${teamLabel(game.team)} try again next turn` : ''}.`);
  }
  return message([container(COLOR.done, `### ${TITLE} — Turn ${game.turnNumber} · ${teamLabel(game.team)} · ${categoryLabel(turn.category)}`, lines.join('\n'))]);
}

// ── End of the game ────────────────────────────────────────────────────────────

function standingsText(game) {
  return [...game.teams]
    .map(team => ({ team, position: team.position }))
    .sort((a, b) => b.position - a.position)
    .map(({ team }, i) => `**${i + 1}.** ${teamLabel(team)} — square ${team.position}/${FINISH} · ${team.playerIds.map(mention).join(', ')}`)
    .join('\n');
}

async function renderWinner(game, { includeControls = true } = {}) {
  const winner = game.teams[game.winnerTeam];
  const files = [];
  const parts = [container(COLOR.done, `## ${TITLE} — ${winner.emoji} Team ${winner.name} Win!`, `🏆 ${winner.playerIds.map(mention).join(', ')}\n\n${standingsText(game)}`,
    includeControls ? buttons(
      button('ar_rematch', 'Rematch (same teams)', '🔄', ButtonStyle.Primary),
      button('ar_new_game', 'New Game (Open Signups)', '📋', ButtonStyle.Secondary),
      button('ar_close', 'Close Session', '🔒', ButtonStyle.Danger),
    ) : null)];
  await addBoard(parts, files, game, `${winner.name} win!`);
  return message(parts, files);
}

/** The final message posted when the session closes. */
function renderClosed(game, reason) {
  const body = game.teams.length > 0 && game.turnNumber > 0 ? `**📍 Final positions**\n${standingsText(game)}` : null;
  return message([container(COLOR.closed, `## ${TITLE} — Session Closed\n${reason}`, body)]);
}

// ── The describer's panel (ephemeral) ──────────────────────────────────────────

/** What a describer sees: their card and the buttons for it. Kept in step for every describer. */
function renderDescriberPanel(game) {
  const { turn, control } = game;
  if (game.phase === 'ready') {
    return {
      content: [
        `🎴 You're describing for **${teamLabel(game.team)}** — category **${categoryLabel(turn.category)}**.`,
        `Get your team ready in voice, then press **Start**: you'll have **${game.options.turnSeconds} seconds**.`,
        `-# ${RULES_REMINDER}`,
      ].join('\n'),
      components: [buttons(button('ar_go', 'Start', '▶️', ButtonStyle.Success))],
    };
  }
  if (game.phase === 'describing') {
    const { card } = turn;
    return {
      content: [
        `# ${card.word}`,
        `${categoryLabel(card.category)}${card.spade ? ' ♠' : ''} · ✅ **${turn.correct.length}** so far · time's up <t:${Math.ceil(turn.endsAt / 1000)}:R>`,
      ].join('\n'),
      components: [buttons(
        button(`ar_got_${turn.cardNumber}`, 'Got it', '✅', ButtonStyle.Success),
        button(`ar_pass_${turn.cardNumber}`, turn.passesLeft > 0 ? 'Pass (1 per turn)' : 'Pass used', '⏭️', ButtonStyle.Secondary).setDisabled(turn.passesLeft <= 0),
      )],
    };
  }
  if (game.phase === 'control') {
    return {
      content: [
        '♠ **Control round** — describe this to **every team**, no time limit:',
        `# ${control.card.word}`,
        `${categoryLabel(control.card.category)} ♠`,
        '-# Press the team that shouted it first. If two teams shout at once, take a new card.',
      ].join('\n'),
      components: [buttons(
        ...game.teams.map((team, i) => button(`ar_win_${control.cardNumber}_${i}`, team.name, team.emoji, ButtonStyle.Primary)),
        button(`ar_tie_${control.cardNumber}`, 'Tie — new card', '🔁', ButtonStyle.Secondary),
      )],
    };
  }
  const total = turn?.correct.length ?? 0;
  return { content: turn?.endsAt ? `⏱️ **Time's up!** Your team got **${total}**.` : 'Nothing to describe right now.', components: [] };
}

// ── Small builders ─────────────────────────────────────────────────────────────

/** Board images are cached per state, so editing a turn message doesn't redraw an unchanged board. */
const boardCache = new WeakMap();

async function addBoard(parts, files, game, heading, spinAngle = null) {
  const key = JSON.stringify([heading, spinAngle, game.currentTeam, game.teams.map(t => t.position)]);
  let buffer = boardCache.get(game)?.key === key ? boardCache.get(game).buffer : null;
  if (!buffer) {
    try {
      buffer = await generateBoardImage({ heading, teams: game.teams, currentTeam: game.currentTeam, spinAngle });
      boardCache.set(game, { key, buffer });
    } catch (err) {
      console.error('[Articulate] Board image failed:', err);
      return;
    }
  }
  files.push(new AttachmentBuilder(buffer, { name: 'articulate_board.png' }));
  parts.push(new ContainerBuilder().setAccentColor(COLOR.turn).addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://articulate_board.png')),
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

module.exports = {
  renderGameMessage,
  renderSessionStarted,
  renderTurnSummary,
  renderClosed,
  renderDescriberPanel,
};
