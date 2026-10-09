# Game Modules: Consistency Review & Plug-and-Play Plan

Scope: Werewords (WW), Cheese Thief (CT), Herd Mentality (HM), Wavelength (WL), No More Jockeys (NMJ).

> **Update:** Cheese Thief and Herd Mentality were removed in Step 5, to be rebuilt later on the new template rather than refactored (see section 5). The remaining games are WW, WL and NMJ.

NMJ and the recently reworked WL are the newer pattern. WW, CT and HM are the older one. The goal is to move every game onto the newer pattern, then pull the parts every game shares into a small framework so that adding a game means adding one folder.

---

## 1. What the code did at the start

This section records the review as it stood before Step 0. Later steps changed much of it, and CT and HM have since been removed.

### 1.1 Two generations of game

| Concern | Older (WW / CT / HM) | Newer (WL / NMJ) |
|---|---|---|
| Slash command | `/werewords`, `/cheesethief`, `/herdmentality` (no subcommands) | `/wavelength start\|end`, `/nmj start\|end` |
| Thread type | **Private** thread, 60 min auto-archive | **Public** thread, 1440 min auto-archive |
| Lobby location | Embed in the *parent channel*; buttons carry `threadId` in the customId (`ct_join_<threadId>`) | A single message *inside the thread*; the game is looked up by `channelId` |
| Existing game for host | Silently **deletes** the old thread and game | Refuses and links to the existing game, plus a race-condition re-check after thread creation |
| UI tech | Classic `EmbedBuilder` + many separate messages (lobby, ready, board, review…) | Components V2 (`ContainerBuilder`, `IsComponentsV2`), **one persistent message edited in place** (WL adds one message per round) |
| Ending a game | In-thread button only | Button **and** `/x end` (host or `ManageThreads`) |
| State class | WW/CT/HM: class exists, but `restore.js` rebuilds a **plain object literal** by hand | `GameState.fromRow(row)` static, used by restore |
| Restore behaviour | Posts "⚠️ Bot restarted…" then re-sends phase-specific buttons | Re-renders the persistent message in place, so no notice is needed |
| Error wrapping | CT: try/catch. HM: **none**. WW: partial | try/catch with a standard "Something went wrong" reply (`replied/deferred → followUp`) |

### 1.2 Naming and shape drift

- **Host field**: `hostId`/`hostUsername` everywhere except NMJ, which uses `creatorId` and has no username. As a result NMJ needs its own `getGameByCreator`.
- **Phase field**: `phase` everywhere except NMJ, which uses `status` (`recruiting|ordering|playing|ended`). Restore checks `row.phase` in some games and `row.status` in NMJ.
- **Players**: `Map<id, {id, username, …}>` everywhere except NMJ, which uses `string[]`. That gives `game.players.size` in some places and `game.players.length` in others.
- **Lobby/limits**: `MIN_PLAYERS` is exported in NMJ and a local constant in WL. In WW/CT/HM it is hard-coded inline (`< 3`, `< 2`). Max players is hard-coded in each manager's `addPlayer` (10 / 10 / 12 / 20 / none).
- **Manager API**:
  - `deleteGame` returns `undefined` in WL but `boolean` elsewhere.
  - `saveGame` exists on CT/HM/NMJ but not WW/WL. Those call `Repository.upsert` directly from handlers and commands.
  - `getGameByHost` in WL doesn't filter ended games. NMJ's does.
  - Timer cleanup is hand-written per manager (`guessTimeout`, `wakeTimeout`, `answerTimeout`…) and duplicated between `deleteGame` and `resetForRematch`.
- **File layout**:
  - WW owns the generic names: `GameManager.js`, `GameRepository.js`, `StatsRepository.js`, `game/phases/`.
  - WL has its own folder (`game/wavelength/` with handler, render and phases).
  - NMJ is split: `game/nmj/render.js`, but its handler lives in `events/interactionCreateNMJ.js`.
  - CT and HM keep *everything* (state machine, embeds, handlers, exported helpers) in one 900–1000 line `events/` file.
  - CT and HM lobby builders live in `commands/*.js` and are imported back by the event file.
- **Interaction routing**: four separate `interactionCreate` listeners (main, CT, HM, NMJ) each check their own prefix. WL is dispatched from *inside* the Werewords listener. Every interaction runs through all of them.
- **Persistence gaps** (older games):
  - WW: `sessionHistory`, `readyPlayers`, `readyMessageId`, `responseStatsShown` aren't persisted.
  - HM: `reviewMessageId` isn't persisted.
  - CT: ephemeral tokens are lost by design.
  - The schema default for `werewords_games.tokens` (`{"yes":14,"no":5,"maybe":1}`) no longer matches the real shape (`yes_no/maybe/correct/so_close_way_off`).
- **Stats**: only WW and WL record player stats. CT, HM and NMJ record none, and the MCP server only exposes WW/WL scoreboards.
- **Dashboard**: `DashboardServer.js` hard-codes a feature list that **omits NMJ**.

### 1.3 Dead and duplicate code

- `src/game/wavelength/phases/render.js` is an older copy of `src/game/wavelength/render.js`, missing the `closedReason` handling. Nothing requires it, so delete it.
- Every game reimplements these:
  - Fisher–Yates shuffle (WW roles, CT roles, WL spectra, NMJ wheel, WW `sampleN`)
  - `persistGame(client, game)`
  - the "fetch thread → fetch message → edit or send" pattern
  - the error-reply block
  - the missing-permissions message
  - the old-thread delete-or-archive fallback

---

## 2. Target conventions (the "uniform" spec)

Use NMJ/WL as the reference and normalise the details:

1. **Command**: `/<game> start` and `/<game> end`. Optionally add `/<game> rules`.
2. **Thread**: public thread, 1440 min archive. Make it per-game configurable (`threadType`) because CT/WW hidden roles may *want* privacy. Decide this explicitly and don't let it drift.
3. **Duplicate start**: refuse and link to the existing game, with a post-create race check. Never silently delete.
4. **Single persistent message** rendered from state with Components V2. Use a `render(game, opts) → payload` pure function. Ephemerals stay for secret info only.
5. **State fields** (every game):
   - Fields: `guildId, channelId, threadId, hostId, hostUsername, messageId, phase, players: Map<id, Player>, gameNumber, _createdAt`.
   - NMJ renames: `creatorId → hostId`, `status → phase`, `players[] → Map` plus a separate `turnOrder: string[]`.
6. **State class** with `static fromRow(row)` and `toRow()`. Restore must never hand-build objects.
7. **Timers**: each manager lists its timer fields once (`timerKeys`), and the shared `clearTimers(game)` stops them, so `deleteGame` and `reset*` never list timers by hand.
8. **Manager API**, the same for every game:
   - `create`, `get`, `getByHost` (ignores ended games), `delete → boolean`, `save`, `addPlayer`, `removePlayer`, `resetForRematch`.
   - Limits come from the game's `minPlayers` / `maxPlayers`.
9. **customIds**: `<prefix>_<action>[_<arg>]`. In-thread lookup is by `channelId`, so the `threadId` doesn't need to be in the id once lobbies live in the thread.
10. **Restore**: re-render the persistent message in place, then re-arm timers from persisted `phaseEndsAt`. No "bot restarted" spam.
11. **Errors**: one shared wrapper used by every dispatch path.
12. **End of game**: the same `rematch_same / rematch_open / close_session` trio and the same `closeSession(game, client, reason)` export.

---

## 3. Plug-and-play architecture

### 3.1 Folder per game

```
src/games/
  _core/
    GameModule.js        # base / contract docs
    BaseGameState.js     # common fields, timers, fromRow/toRow helpers
    BaseGameManager.js   # create/get/delete/save/addPlayer/... + clearTimers
    createRepository.js  # builds upsert/getAll/remove from a column spec
    registry.js          # discovers games/*/index.js
    router.js            # single interactionCreate dispatcher by prefix
    threads.js           # createGameThread, permission message, race check
    messages.js          # updatePersistentMessage(game, client, payload)
    errors.js            # safeReply / withErrorReply
    random.js            # shuffle, sampleN
  werewords/  wavelength/  nmj/
    index.js             # the module manifest (below)
    state.js             # XGameState extends BaseGameState
    manager.js           # XManager extends BaseGameManager (game-specific actions only)
    repository.js        # column spec → createRepository(...)
    render.js            # pure render(game, opts)
    handlers.js          # { buttons: {...}, modals: {...}, selects: {...} }
    phases/              # game logic
    data/                # words.json, spectra.json, questions.json
    stats.js             # optional
```

### 3.2 The module contract

```js
// src/games/nmj/index.js
module.exports = {
  id: 'nmj',                       // also the dashboard feature id
  name: 'No More Jockeys',
  prefix: 'nmj_',                  // customId namespace
  minPlayers: 3, maxPlayers: 12,
  thread: { type: 'public', autoArchive: 1440 },

  table: 'nmj_games',              // schema + migrations owned by the module
  schema: `CREATE TABLE IF NOT EXISTS nmj_games (...)`,
  migrations: [ /* 'ALTER TABLE nmj_games ADD COLUMN ...' */ ],

  State: NmjGameState,             // has fromRow/toRow
  Manager: NmjManager,

  command,                         // optional extra subcommands; start/end are generated
  render,                          // (game, opts) => payload
  handlers,                        // { buttons, modals, selects } keyed by action
  onRestore,                       // (game, client, thread) => re-arm timers; default = re-render
  closeSession,                    // (game, client, reason)
  stats,                           // optional { record, scoreboard } for MCP/dashboard
};
```

### 3.3 Core pieces that remove the hard-coding

| Today (hard-coded) | Replaced by |
|---|---|
| `index.js` news up 5 managers onto `client.*Manager` | `registry.load()` → `client.games.get('nmj').manager` (keep the old `client.nmjManager` aliases during migration) |
| `database.js` holds every game table + ALTERs | Each module's `schema`/`migrations`, applied by the registry. Use `PRAGMA user_version` per module or a `schema_migrations` table instead of try/catch ALTERs |
| `restore.js`, 5 bespoke functions | One loop: for each module, `getAll` → `State.fromRow` → drop if ended or the thread is gone → `onRestore` |
| 4 `interactionCreate` listeners + WL nested in WW | One `router.js`: match `customId` prefix → module → `handlers.buttons[action]`, wrapped in `withErrorReply`. Slash commands stay in the main listener |
| `commands/*.js` per game | A generated `/<id> start\|end` builder from manifest metadata. Modules add subcommands if needed. `deploy-commands.js` reads the registry |
| Dashboard `FEATURES` array | Built from the registry (fixes the missing NMJ entry) |
| MCP scoreboards (WW/WL only) | Iterate modules exposing `stats.scoreboard` |

**Adding a game** is then: copy a template folder, fill in the manifest, state, render and handlers, then run `npm run deploy`. No edits outside `src/games/<new>/`.

### 3.4 Generic flows the core can own

- **Start**:
  1. Duplicate check.
  2. Create the thread.
  3. Re-check for a race.
  4. `manager.create`.
  5. Add the host.
  6. Send `render(game)`.
  7. Save `messageId`.
  8. Reply with the thread link.

  NMJ and WL already do exactly this in near-identical code.
- **End**: host/`ManageThreads` check → `module.closeSession`.
- **Lobby**: join/leave/start/cancel handlers with min/max checks. A game supplies only `onStart(game, client)`.
- **Rematch**: `rematch_same` / `rematch_open` / `close_session` → `manager.resetForRematch(openSignups)` + re-render.

---

## 4. Migration plan (incremental and shippable at each step)

Each step leaves the bot working. Do one game per PR from step 3 onwards.

**Step 0: Hygiene.** ✅ Done.
- Delete `game/wavelength/phases/render.js`.
- Add NMJ to the dashboard `FEATURES` list.
- Wrap HM dispatch in try/catch.
- Add `.catch` to the slash-command error reply.
- Fix the `werewords_games.tokens` default.

**Step 1: Core utilities.** ✅ Done.
- Add `_core/random.js`, `errors.js`, `threads.js` and `messages.js`.
- Replace the duplicated shuffle, error-reply and permission-message code in all 5 games.

**Step 2: Base classes and registry.** ✅ Done.
- Added `BaseGameState`, `BaseGameManager` and `createRepository`. All five managers and repositories now use them. NMJ's state class keeps its own shape until Step 3.
- Added the registry and router. Each game now has `src/games/<id>/` with `index.js` (manifest), `command.js`, `handlers.js` (Wavelength's handler is still in `game/wavelength/`) and `restore.js`.
- `index.js`, `db/restore.js`, `deploy-commands.js` and the dashboard iterate the registry.
- The `client.xManager` aliases are kept; managers are also at `client.games.get(id).manager`.
- The 4 `interactionCreate` listeners are now one listener plus the router.

**Step 3: NMJ to the reference shape.** ✅ Done.
- Renamed `creatorId/status` → `hostId/phase` and added `hostUsername`. The lobby phase is now `'lobby'` (was `'recruiting'`), matching the other games.
- `players` is a `Map` like the other games. Its order is the turn order (`game.turnOrder()`), so no separate list is needed.
- State (`state.js`, with `fromRow`/`toRow`), manager, repository and render now all live in `games/nmj/`.
- NMJ owns its table: `games/nmj/repository.js` holds the schema and a one-time upgrade. On startup it converts saved games from the old layout inside a transaction, so games in progress carry on.

**Step 4: WL.** ✅ Done.
- Everything moved to `games/wavelength/`: state (with `fromRow`/`toRow`), manager, repository (owning the table schema and its column upgrades), handlers, render, image generation, phases and spectra.
- `deleteGame` already returned a boolean after Step 2.
- `getByHost` deliberately still counts `'ended'` games. In Wavelength `'ended'` means a round finished and the session is waiting to rematch or close; closing deletes the game. Ignoring `'ended'` would let a host open a second session alongside the first.
- Timers: Step 2's shared `timerKeys` cleanup replaced the `game.timers` idea. Wavelength's own duplicate `clearGameTimers` helper is gone.
- Fixed a crash on main since `9c3dfc1`: `render.js` didn't export `createContainer`, so ending a round and closing a session both threw.

**Step 5: Remove HM and CT.** ✅ Done.
- Deleted both games: their folders in `src/games/`, managers, repositories and the Herd Mentality question bank. Their slash commands, buttons, dashboard entries and crash recovery went with them, because those all come from the registry.
- `db/database.js` no longer creates `cheese_thief_games` or `herd_mentality_games`. Existing databases keep those tables and their rows; nothing reads them.
- Sassy's "don't interject during a game" check no longer looks for Cheese Thief games.
- README and `package.json` no longer mention Cheese Thief.

**Step 6: WW.** Largest.
- Rename `GameManager` / `GameRepository` / `StatsRepository` / `game/phases` to `werewords`-specific names and move them into `games/werewords/`, as for NMJ and WL.
- Split `games/werewords/handlers.js` (moved out of the shared listener in Step 2, still ~1150 lines) into smaller handler and phase files.
- Persist `sessionHistory`, `readyPlayers` and `readyMessageId`.
- Convert the board, ready and vote messages to one rendered message.

**Step 7: Optional stats.**
- Add a `stats` hook for NMJ (wins, games played), and for any rebuilt games.
- Make the MCP and dashboard scoreboards registry-driven.

**Step 8: Template and docs.**
- Add `src/games/_template/` and a "Adding a game" README section.

### Decisions needed from you

1. **Private vs public threads.** Should WW (hidden roles) move to a public thread like NMJ/WL, or stay private? Recommendation: make it a manifest option, default to public, and keep WW private unless you prefer otherwise.
2. **Command shape.** Should `/werewords` become `/werewords start`? The change affects users' muscle memory. Recommendation: yes, for consistency, and deploy both shapes for one release.
3. **Breaking in-flight games.** ✅ Decided: migrate saved games rather than clearing them. Each game that changes its saved layout ships a one-time upgrade with its repository, as NMJ does in Step 3.

### Testing

There is still no committed test suite. Each step so far was checked with throwaway scripts: an in-memory SQLite database, fake Discord objects and, for NMJ and WL, a full game played through the real handlers. Turning those into a committed `node:test` suite would protect the remaining steps. It should cover:
- the manager APIs
- `fromRow(toRow(state))` round-trips, and each game's table upgrade
- the router's prefix dispatch
- a scripted game per module

---

## 5. Future: rebuilding Herd Mentality and Cheese Thief

Both games were removed rather than refactored, to be rebuilt on the template once it exists (Step 8).

- **Recovering the old code and data.** Everything is in git history. Find the removal commit with `git log --diff-filter=D --oneline -- src/data/herd_mentality_questions.json`, then read any file from the commit before it, e.g. `git show <commit>^:src/data/herd_mentality_questions.json` for the question bank, or `<commit>^:src/games/cheesethief/handlers.js` for the Cheese Thief rules logic.
- **Use new table names.** Existing databases still contain `cheese_thief_games` and `herd_mentality_games` in the old layout. A rebuilt game's `CREATE TABLE IF NOT EXISTS` with the same name would silently keep the old table, so either pick new names or have the new repository's `migrate` drop or convert the old table first.
- **Build them like NMJ:**
  - `/herdmentality start|end` and `/cheesethief start|end`
  - the lobby and game state in one message inside the thread, rendered from state
  - ephemerals only for secret information, such as Cheese Thief roles and dice
  - timers re-armed on restore from a saved `phaseEndsAt`
- **Cheese Thief's ephemeral tokens.** It edited players' private messages through stored interaction tokens, which are lost on restart. A rebuild should let players reopen their private view from a button instead of relying on those tokens.
