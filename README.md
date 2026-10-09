# Potato Game Bot 🎮

[![Tests](https://github.com/Stayingfalse/potato-game-bot/actions/workflows/test.yml/badge.svg)](https://github.com/Stayingfalse/potato-game-bot/actions/workflows/test.yml)

A Discord bot that brings party games and social deduction fun to your server! Host game nights with friends using interactive Discord threads.

## 🎲 Games

### Werewords 🔮

A social deduction word-guessing game where players work together to guess a secret word... but some players are secretly working against the team!

**How to Play:**
- Use `/werewords start` in any channel to open a public game thread, and `/werewords end` inside that thread to end the session early
- The **Mayor** chooses a secret word from three options
- Players ask yes/no questions to guess the word
- **Townsfolk** try to help the team succeed
- **Werewolves** try to sabotage without being caught
- The **Seer** knows the word but can't reveal it directly
- After the word is guessed (or time runs out), players vote on who they think the Werewolf is!

**Features:**
- 🎭 Multiple roles: Mayor, Seer, Werewolf, and Townsfolk
- ⏱️ 4-minute timer for guessing
- 🗳️ Voting phase to identify the Werewolf
- 📊 Response statistics tracking
- 🔄 Session support - play multiple rounds with the same group
- 🎯 Text or voice mode options
- 👥 Supports 3-10 players

### Wavelength 〰️

A party game of clever clues and spectrum guessing! One player gives a clue to help teammates guess where a target sits on a spectrum between two extremes.

**How to Play:**
- Use `/wavelength start` in any channel to open a public game thread, and `/wavelength end` inside that thread to end it early
- The **Clue Giver** is shown a spectrum (e.g., "Cold ↔ Hot") and a secret target position
- They give a one-word clue to help teammates guess the target
- Other players adjust a dial and submit their guess
- Points are awarded based on how close the guesses are to the target!

**Features:**
- 🎨 Visual spectrum board with interactive dial
- 🎲 Random clue giver selection (or round-robin/snake order modes)
- 🏆 Multiple game modes: Classic, First-to-Points, Fixed Rounds, and Unlimited
- 📈 Session tracking with score history
- 🔄 Rematch support to keep the party going
- 👥 Supports 2-20 players

### No More Jockeys 🎬

A party game of celebrities and ever-growing rules: each turn bans a new category, and naming anyone who breaks an earlier ban gets you knocked out.

**How to Play:**
- Use `/nmj start` in any channel to open a public game thread, and `/nmj end` inside that thread to end it early
- Players join, then the host spins the wheel to set the turn order
- On your turn, name a celebrity and a "No More…" category they fit (e.g. *Tom Cruise — No More people who have won an Oscar*). That category is now banned for everyone
- The other players accept the move, ask you to **name another** celebrity who fits, or **challenge** it if your celebrity breaks a category that was already banned
- A challenge goes to a vote: if it succeeds you're knocked out and the challenger gets their token back
- The last player standing wins

**Features:**
- 🪙 3 challenge tokens per player
- 👁️ Spectators and knocked-out players can peek at everything named so far
- 📊 Stats: wins, knock-outs and challenges
- 👥 3 or more players

## 🎉 Additional Features

### Birthday Announcements 🎂

Never forget a friend's birthday again! The bot can automatically announce birthdays in your server with fun messages.

**Commands:**
- `/birthday set <date>` - Set your birthday (format: dd/mm or dd/mm/yyyy)
- `/birthday list` - See the next 3 upcoming birthdays
- `/birthday list all:True` - View all registered birthdays
- `/birthday delete` - Remove your birthday

**Admin Commands:**
- `/birthday start` - Enable automatic birthday announcements
- `/birthday stop` - Disable announcements
- `/birthday setchannel <channel>` - Choose where announcements appear
- `/birthday resend` - Re-send today's birthday messages

## 🎮 Getting Started

1. **Invite the bot** to your Discord server
2. **Grant permissions:**
   - Create Public Threads
   - Send Messages in Threads
   - Manage Threads
3. **Start playing!** Use `/werewords start`, `/wavelength start` or `/nmj start` in any channel to begin

## 🧪 Running the Tests

```bash
npm test
```

The suite uses Node's built-in test runner, so there is nothing extra to install. It plays each game through its real command and button handlers with fake Discord objects, and checks crash recovery and database upgrades. It never connects to Discord, and each test file uses its own temporary database, so your `data/` folder is never touched.

GitHub runs the same suite on Node 20 and 22 for every pull request and every push to `main` (see `.github/workflows/test.yml`).

## 🧩 Adding a Game

Each game is a folder under `src/games/`, and the bot picks up new folders automatically. Copy `src/games/_template/` (a small working game) and follow [docs/adding-a-game.md](docs/adding-a-game.md).

## 🎯 Game Tips

**For Werewords:**
- Players can strategically use their response tokens to guide the guesser
- The Seer should be subtle - revealing yourself too early might help the Werewolves!
- Werewolves should participate naturally to avoid suspicion
- Use "So Close" and "Way Off" tokens wisely - they're limited!

**For Wavelength:**
- Clue Givers: Be creative but not too obscure!
- Guessers: Discuss and coordinate before locking in your guess
- Remember: It's not just about being right, it's about being close!
- Try different game modes to keep things fresh

**For Birthday Celebrations:**
- Set up announcements early so you never miss a celebration
- The bot will post automatically at midnight UTC
- Fun, random messages keep each birthday announcement unique!

## 🛠️ Features Overview

- ✨ Thread-based games for organized play
- 💾 Persistent game state (survives bot restarts)
- 🔄 Session support for marathon game nights
- 📊 Statistics tracking and game history
- 🎨 Rich embeds and interactive buttons
- 🎂 Automated birthday celebration system

## 📝 Note

Each game runs in its own thread to keep your channels clean and conversations organized. Players are automatically added to the thread when they join a game!

---

Ready to play? Start with `/werewords start`, `/wavelength start` or `/nmj start` and let the games begin! 🎉
