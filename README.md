# ♞ Twisted Gambit

Chess with secrets. Pick a game mode, then play a friend on the same device (pass & play) or online.

## Game modes

| Mode | What it does |
|---|---|
| ♛ **Secret Queen** | You keep your normal queen and also pick one pawn to be a second, secret queen. It looks like a pawn and stays disguised as long as it moves like one. The first time it makes a move only a queen could, it's revealed. |
| 🗡 **Traitor** | Secretly mark one enemy piece. Once per game, use your turn to move it as if it were yours, including capturing its own teammates. |
| 🎯 **Hidden Objective** | Each player draws a secret goal (e.g. *capture both enemy knights*, *land a knight on the enemy back rank*). Complete it, or capture the king, to win. |
| ⇄ **Secret Swap** | Once per game, swap the true identities of two of your pieces. To your opponent they keep their old look until one moves in a way its disguise couldn't. |

## Base rules

Standard chess movement, castling, en passant and promotion, but **you win by capturing the king** (there is no check or checkmate). This keeps hidden-information play fair: you're allowed to leave your king hanging, and your opponent has to notice.

## Play

No install, no build step: **double-click `index.html`** and it opens in your browser.

- **Pass & Play:** two players on one device. A privacy screen hides the board between turns.
- **Play Online:** click *Play Online → Create Game* to get a 5-letter code and send it to a friend.
  They open the game, click *Play Online*, and enter the code under *Join a game*. The creator plays White.
  Both players need the game (the files, or a hosted copy) and an internet connection.

Online play uses [PeerJS](https://peerjs.com) (MIT) to connect the two browsers directly. PeerJS's free public server only introduces the players to each other. Both browsers hold the full game state, so a player who opens the browser's developer tools could peek at secrets. It's built for friendly games.

To host it so friends can just open a link, make the repo public and enable **GitHub Pages** (Settings → Pages → deploy from `main`, root).

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

The engine still contains an experimental **Bluff Moves** mode (all pieces hidden, any piece may claim a queen or knight move, with challenges). It's turned off in the menu for now.

## Ideas for next steps

- A simple AI opponent
- Move animations
- More objectives and modes
