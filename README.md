# ♞ Gerasimos Gambit

Chess with secrets. Pick a game mode, then play a friend on the same device (pass & play) or online.

## Game modes

| Mode | What it does |
|---|---|
| ♛ **Secret Queen** | You keep your normal queen and also pick one pawn to be a second, secret queen. It looks like a pawn and stays disguised as long as it moves like one. The first time it makes a move only a queen could, it's revealed. |
| 🗡 **Traitor** | Secretly mark one enemy piece. Once per game, use your turn to move it as if it were yours, including capturing its own teammates. |
| 🎯 **Hidden Objective** | Each player draws a secret goal (e.g. *capture both enemy knights*, *land a knight on the enemy back rank*). Complete it, or checkmate the king, to win. |
| ⇄ **Secret Swap** | Once per game, swap the true identities of two of your pieces. To your opponent they keep their old look until one moves in a way its disguise couldn't. |
| 💣 **Landmine** | Each player secretly plants 2 mines in the opponent's half. Any enemy piece except the king that lands on one is blown up. (If the blast would expose that piece's own king, the mine fizzles instead.) |
| 🔮 **Prophecy** | After your move, secretly predict your opponent's reply. If they play exactly that, your next turn is a double move (lost if the first move gives check). Recharges 5 turns after each use. |
| 🦎 **Shapeshifter** | Secretly pick one of your pieces. Each time it captures, it becomes the piece it captured, but keeps its old look until it moves in a way that look couldn't, or gives check. |

## Base rules

Full standard chess, matching the official FIDE rules and chess.com's automatic draws:

- **Checkmate wins.** You can never make a move that leaves your own king in check (pins, no king next to king).
- **Castling:** king and rook unmoved, squares between empty, king not in check, not passing through or landing on an attacked square.
- **En passant** only on the move right after the two-square pawn push.
- **Promotion** to queen, rook, bishop or knight.
- **Draws:** stalemate, threefold repetition, the 50-move rule, insufficient material, or agreement (all declared automatically).

Each player has **10 minutes** on a countdown clock. Running out of time loses, unless the opponent can't possibly checkmate (bare king, or king and one bishop or knight), which is a draw.

With hidden pieces, the game judges everything using each piece's true identity, like an arbiter who can see the whole board. A disguised piece that gives check is revealed immediately.

## Play

No install, no build step: **double-click `index.html`** and it opens in your browser.

- **Pass & Play:** two players on one device. A privacy screen hides the board between turns.
- **Play Bot:** play a computer opponent in any mode (you play White):
  - **Bot v1**, a friendly sparring partner.
  - **Jules**, a real chess engine: alpha-beta search with iterative deepening, quiescence search, a transposition table and move-ordering heuristics, thinking up to about 2.5 seconds a move. It plays every mode deliberately (mines on your knights' squares, your queen as its traitor, a pawn shapeshifter, searched traitor moves and swaps, prophecies from its own analysis, steering toward its hidden objective). It plays fair: it only knows what Black can see.
- **Play Online:** click *Play Online → Create Game*, then *Copy invite link* and send it to a friend.
  Clicking the link joins your game instantly (or they can type the 5-letter code under *Join a game*). The creator plays White.
- **Find Opponent:** *Play Online → Find Opponent* matches you with any other player searching for the same mode.
  Both players need the game (the files, or a hosted copy) and an internet connection.

Online play runs through **Supabase Realtime** (the same project as Charmed Hold'em), so it works on any network, including ones that block direct connections between devices. The two players' browsers agree on a key and encrypt every message (ECDH + AES-GCM), so nobody else who finds the channel can read the game. If Supabase can't be reached, the game falls back to connecting the browsers directly with [PeerJS](https://peerjs.com). Random matchmaking pairs players waiting in each mode's lobby in the order they arrived. Both browsers hold the full game state, so a player who opens the browser's developer tools could still peek at their opponent's secrets. It's built for friendly games.

**Play it online:** https://oksem42.github.io/twisted-gambit/ (hosted with GitHub Pages; send friends this link).

## Tests

The rules engine (`js/engine.js`) is plain JavaScript with no DOM. Tests live in `tests/engine.test.js`:

- in a browser: open `tests/index.html`
- with Node 18+: `node tests/engine.test.js`

## Project layout

```
index.html        page shell
style.css         chess.com-inspired dark theme: sidebar, green board, tabbed side panel
js/engine.js      rules: move generation, game modes, win conditions
js/pieces.js      original SVG piece set
js/ui.js          board, input, secret setup, pass-and-play and online play
tests/            engine tests
```

An earlier experimental **Bluff Moves** mode is removed for now; it's in the git history if it comes back.

## Ideas for next steps

- A simple AI opponent
- Move animations
- More objectives and modes
