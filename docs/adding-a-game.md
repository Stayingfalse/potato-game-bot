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
4. Deploy, then run `npm run deploy` so Discord learns the new slash command.

## What each file does

| File | Purpose |
|---|---|
| `index.js` | The **manifest**: id, name, button prefix, and links to everything below. Fields are documented in `src/games/_core/registry.js`. |
| `command.js` | `/<id> start` and `/<id> end`. Start creates a public thread, refuses a second game for the same host, and posts the game message. |
| `state.js` | The game's state class (extends `BaseGameState`) with `fromRow` / `toRow` for saving. |
| `repository.js` | The game's table (`SCHEMA`), and `ADDED_COLUMNS` for columns added after release. Built with `createRepository`. |
| `manager.js` | Game-specific actions on top of `BaseGameManager` (which already has get, delete, add/remove player and timer cleanup). |
| `render.js` | Turns state into the one game message. Pure: no Discord calls. |
| `flow.js` | Phase changes (start, finish, close) and timers, shared by the handlers, the command and restore. |
| `handlers.js` | One function per button, looked up by customId. The game is found from the thread the button was pressed in. |
| `restore.js` | Reloads saved games on startup, redraws their message in place and re-arms timers with the time left. |
| `stats.js` | Optional. Player stats, plus the standard `getPlayer` and `scoreboard` readers. Leave `stats` out of the manifest if the game has none. |

## Conventions

These are what every game follows, so they behave the same for players and
for anyone reading the code.

- **Commands:** `/<id> start` and `/<id> end`. `end` works for the host or anyone with Manage Threads.
- **Threads:** each game runs in a public thread that archives after 24 hours. A host can only run one game at a time.
- **One game message**, rendered from state and edited in place. Use ephemeral replies only for private information (like a secret role).
- **Buttons:** every customId starts with the manifest's `prefix`. Look the game up by `interaction.channelId`.
- **Errors:** don't wrap handlers in try/catch just to reply. The router catches anything thrown, logs it, and tells the player something went wrong.
- **Saving:** call `repository.upsert(game)` after every change players would want to survive a restart.
- **Timers:** keep handles in fields listed in the manager's `timerKeys`, so deleting or resetting a game always stops them. Save deadlines as timestamps (like `phaseEndsAt`) so restore can re-arm only the time left.
- **Restore:** redraw the message in place; don't post "bot restarted" messages.
- **Changing what's saved:** add new columns to both `SCHEMA` and `ADDED_COLUMNS`. For bigger changes, write a `migrate` that converts saved games, as `src/games/nmj/repository.js` does, so games in progress survive the upgrade.
- **Shared helpers** live in `src/games/_core/`: `threads.js` (create, archive, permission messages), `messages.js` (edit or send), `errors.js`, `random.js`.

## Testing

`test/template.test.js` shows the pattern: `test/helpers/discord.js` provides fake
threads, channels, users and interactions, and `test/helpers/env.js` (required
first) gives each test file its own temporary database. Play a full game
through the real command and handlers, then check restarts mid-game. GitHub
runs `npm test` on every pull request.
