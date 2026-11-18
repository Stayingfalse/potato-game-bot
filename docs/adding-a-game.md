# Adding a Game

Every game lives in its own folder under `src/games/`. The bot finds games by
looking in that folder, so adding one doesn't need changes anywhere else: its
slash command, buttons, crash recovery, dashboard entry and stats all come
from the game's folder.

`src/games/_template/` is a complete, small game (**High Roll**: everyone rolls
once, the highest roll wins) that you copy to start. Folders starting with `_`
are skipped, so the template itself is never loaded into the bot.

## Quick start

1. Copy the template and its test:
   ```bash
   cp -r src/games/_template src/games/mygame
   cp test/template.test.js test/mygame.test.js
   ```
2. In both copies, rename the template's names to yours:

   | Template | Yours |
   |---|---|
   | `highroll` (id, command, table names) | `mygame` |
   | `High Roll` / `HighRoll` | `My Game` / `MyGame` |
   | `hr_` (button prefix) | a short prefix of your own, e.g. `mg_` |
   | `highRollManager` (client key) | `myGameManager` |
   | `games/_template` (paths in the test) | `games/mygame` |

3. Run `npm test`. At this point your copy is a working High Roll under a new
   name; change it into your game from here, keeping the tests passing.
4. Deploy and restart the bot. On startup it sees the slash commands have changed and
   sends them to Discord itself (`src/utils/commandSync.js`); `npm run deploy` does the
   same by hand.

## What each file does

| File | Purpose |
|---|---|
| `index.js` | The **manifest**: id, name, button prefix, and links to everything below. Fields are documented in `src/games/_core/registry.js`. |
| `command.js` | `/<id> start` and `/<id> end`. Start creates a public thread, refuses a second game for the same host, posts the game message, and replies with the channel card (`card.post`). |
| `card.js` | The game's **channel card**: the status message in the channel the game was started from, made with `createChannelCard` from `src/games/_core/channelCard.js` (see [Channel card](#channel-card)). |
| `state.js` | The game's state class (extends `BaseGameState`) with `fromRow` / `toRow` for saving. |
| `repository.js` | The game's table (`SCHEMA`), and `ADDED_COLUMNS` for columns added after release. Built with `createRepository`. |
| `manager.js` | Game-specific actions on top of `BaseGameManager` (which already has get, delete, add/remove player and timer cleanup). |
| `render.js` | Turns state into the one game message. Pure: no Discord calls. |
| `flow.js` | Phase changes (start, finish, close) and timers, shared by the handlers, the command and restore. |
| `handlers.js` | One function per button, looked up by customId. The game is found from the thread the button was pressed in. |
| `restore.js` | Reloads saved games on startup, redraws their message in place and re-arms timers with the time left. |
| `stats.js` | Optional. Player stats, plus the standard `getPlayer` and `scoreboard` readers and the `describePlayer` and `leaderboard` functions that `/stats` and `/leaderboard` show (see [Stats](#stats)). Leave `stats` out of the manifest if the game has none. |
| `howToPlay.js` | Optional. The rules for new players (`emoji`, one-line `summary`, `players` count and about 8–12 short `rules` lines), set as `howToPlay` in the manifest. `/help` lists and shows it, and the lobby's **How to play** button replies with it. |

## Conventions

These are what every game follows, so they behave the same for players and
for anyone reading the code.

- **Commands:** `/<id> start` and `/<id> end`. `end` works for the host or anyone with Manage Threads.
- **Threads:** each game runs in a public thread that archives after 24 hours. A host can only run one game at a time.
- **One game message**, rendered from state and edited in place. Use ephemeral replies only for private information (like a secret role).
- **Buttons:** every customId starts with the manifest's `prefix`. Look the game up by `interaction.channelId`.
- **Lobby:** build it from `src/games/_core/lobby.js`. `buildLobbyRow` gives the standard Join / Leave / Start / Cancel / How to play row (`<prefix>join`, `<prefix>leave`, `<prefix>start`, `<prefix>cancel`, `<prefix>howto`), with Start disabled and labelled "Need 2 more players" until the minimum is met; `formatPlayerList` lists players as mentions. Keep the minimum-player check in the start handler too. Answer `<prefix>howto` with `howToPlayReply`, before looking the game up, so it works anywhere.
- **Errors:** don't wrap handlers in try/catch just to reply. The router catches anything thrown, logs it, and tells the player something went wrong.
- **Saving:** call `repository.upsert(game)` after every change players would want to survive a restart.
- **Timers:** keep handles in fields listed in the manager's `timerKeys`, so deleting or resetting a game always stops them. Save deadlines as timestamps (like `phaseEndsAt`) so restore can re-arm only the time left.
- **Restore:** redraw the message in place; don't post "bot restarted" messages.
- **Changing what's saved:** add new columns to both `SCHEMA` and `ADDED_COLUMNS`. For bigger changes, write a `migrate` that converts saved games, as `src/games/nmj/repository.js` does, so games in progress survive the upgrade.
- **Channel card:** the reply to `/<id> start` is the game's status card in the starting channel. Keep it up to date from the hooks listed under [Channel card](#channel-card); don't post anything else to the starting channel.
- **Shared helpers** live in `src/games/_core/`: `threads.js` (create, archive, permission messages), `lobby.js` (lobby buttons, player list, how to play), `messages.js` (edit or send), `channelCard.js` (the channel card), `errors.js`, `random.js`.

## Channel card

People in the channel a game was started from see a short status card there
instead of a one-off "game created" message: the lobby (host, `N/max players`,
the players, a **Join** button and a link to the thread), then "Game in
progress", then the result and "Thread closed" (or "Cancelled" if the session
ended before anything was played). Mentions on the card never ping.

`card.js` makes it once:

```js
module.exports = createChannelCard({ name: 'My Game', emoji: '🎯', prefix: 'mg_', clientKey: 'myGameManager', repository: require('./repository') });
```

and the game calls it from a few places (the template shows each one):

| Where | Call |
|---|---|
| `/<id> start`, instead of the reply | `await card.post(interaction, game, client)`: replies with the card and saves its id as `game.cardMessageId` |
| Lobby Join and Leave, Start, and anything that reopens the lobby | `await card.update(client, game)`: lobby or "in progress", from the game's phase |
| The end of the session (`closeSession`) | `await card.finish(client, game, resultLine)` with one or two lines (with their own leading emoji), or `await card.cancel(client, game)` if nothing was played |
| `handleInteraction`, before the game is looked up | `if (interaction.customId === card.joinId) return card.handleJoin(interaction, client, { refreshLobby })` |

The card's Join button (`<prefix>card_join`) is pressed in the starting channel,
not the thread, so `handleJoin` finds the game by the card's message id. It
adds the player as the lobby's Join does (through the manager's `addPlayer`),
adds them to the thread, replies privately with a link, then calls
`refreshLobby(game, client)` to redraw the lobby message and updates the card.

Save `cardMessageId` like any other field: a `card_message_id TEXT` column in
`SCHEMA` and `ADDED_COLUMNS`, and in the state's `toRow` / `fromRow`. Restore
needs nothing else; the card is left as it is. Card updates never throw: a
missing card, channel or message, or a failed edit, is ignored.

## Stats

A game whose manifest has `stats` appears in `/stats` and `/leaderboard` by
itself; the commands know nothing about individual games. `stats.js` exports:

| Function | Returns |
|---|---|
| `getPlayer(guildId, userId)` | The player's stats row, or `null`. |
| `scoreboard(guildId)` | The top 10 rows, best first. |
| `describePlayer(row)` | What `/stats` shows for a row from `getPlayer`: `[{ label, value }]`. |
| `leaderboard(guildId)` | What `/leaderboard` shows: every player, best first, as `{ user_id, username, headline, detail }`. `headline` is the number the ranking is about (`"3 wins"`); `detail` is a short extra (`"best roll 90"`). |

To put a "🏆 Leaderboard" button on the game's results screen, add a button
with the customId `<prefix>leaderboard` and route it to
`replyWithLeaderboard(interaction, '<id>')` from `src/games/_core/statsDisplay.js`.

## Testing

`test/template.test.js` shows the pattern: `test/helpers/discord.js` provides fake
threads, channels, users and interactions, and `test/helpers/env.js` (required
first) gives each test file its own temporary database. Play a full game
through the real command and handlers, then check restarts mid-game. GitHub
runs `npm test` on every pull request.
