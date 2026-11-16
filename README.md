# ♞ Twisted Gambit

Chess with secrets. Two players share one device (pass & play), pick any mix of five twists, and try to out-think and out-bluff each other.

## The twists

| Twist | What it does |
|---|---|
| ♛ **Hidden Queen** | Your queen starts disguised as one of your pawns (you pick which). It's revealed the first time it makes a move a pawn couldn't. |
| 🗡 **Traitor** | Secretly mark one enemy piece. Once per game, use your turn to move it as if it were yours, including capturing its own teammates. |
| 🎯 **Hidden Objective** | Each player draws a secret goal (e.g. *capture both enemy knights*, *land a knight on the enemy back rank*). Complete it, or capture the king, to win. |
| 🃏 **Bluff Moves** | Every piece is shuffled and hidden. Any piece may *claim* any queen or knight move. After each move the opponent accepts or challenges: a caught bluff loses the piece and the move is undone, while a wrong challenge costs the challenger a random piece. |
| ⇄ **Secret Swap** | Once per game, swap the true identities of two of your pieces. To your opponent they keep their old look until one moves in a way its disguise couldn't. |

Bluff Moves hides everything, so it can't be combined with Hidden Queen, Traitor or Secret Swap. Every other combination works.

## Base rules

Standard chess movement, castling, en passant and promotion, but **you win by capturing the king** (there is no check or checkmate). This keeps hidden-information play fair: you're allowed to leave your king hanging, and your opponent has to notice.

## Play

It's a static site with no build step:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. You can also enable **GitHub Pages** (Settings → Pages → deploy from `main`, root) to play it online.

## Tests

The rules engine (`js/engine.js`) is pure JavaScript with no DOM. Tests live in `tests/engine.test.js`:

- in a browser: serve the folder and open `/tests/`
- with Node 18+: `node tests/engine.test.js`

## Project layout

```
index.html        page shell
style.css         dark theme with a green board, inspired by the big online chess sites
js/engine.js      rules: move generation, twists, win conditions
js/ui.js          board rendering, click/drag input, secret setup, pass-and-play flow
tests/            engine tests
```

## Ideas for next steps

- Online play (each player on their own device, which removes the need for the privacy screen)
- A simple AI opponent
- Sound effects and move animations
- More objectives and twists
