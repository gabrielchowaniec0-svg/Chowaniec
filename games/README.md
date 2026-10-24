# Chowaniec Games

`/games/` is the arcade. Each game lives in its own folder (`/games/<id>/index.html` + `game.js`, optional `game.css`)
and plugs into the shared frame in `/games/core.js` (`window.ChowGames`), which provides the top bar, sounds,
family high scores, the game-over card and multiplayer. Server: `netlify/functions/games.mjs`, storage in
`netlify/lib/games-store.mjs` (the `GAMES` list there must include the game id).

Game ids: `dino`, `road`, `hop`, `snake`, `2048`, `four`, `memory`, `word`.

## Page template

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
    <link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#000000"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><script src="/pwa.js" defer></script>
    <title>Dino Dash · Chowaniec Games</title>
    <script>try { var m = localStorage.getItem('chowaniec_theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m); } catch (e) {}</script>
    <!-- Tailwind is only used by the shared passcode box -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/passwords.js"></script>
    <script src="/auth-gate.js"></script>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap">
    <link rel="stylesheet" href="/games/games.css">
</head>
<body class="game-page">
    <div id="app-root"></div>
    <script src="/games/core.js"></script>
    <script src="game.js"></script>
</body>
</html>
```

Never use `placeholder` attributes (house rule: no placeholder text anywhere).

## Using ChowGames

```js
ChowGames.mount({
  id: 'dino', title: 'Dino Dash', emoji: '🦖',
  mode: 'race',                 // 'race' (everyone plays at once, same seed) or 'turns' (shared board)
  minPlayers: 2, maxPlayers: 2, // turns only
  scoreLabel: 'points',         // shown under the score on the game-over card
  help: '<ul><li>Tap or press Space to jump</li>…</ul>',   // HTML for the "?" button
  initialShared(players, seed) { return {...}; },          // turns only: the opening board (host's device)
  onReady(ctx) { /* ctx.root = the stage element (fills the screen under the bar), ctx.user = my name */ }
});
```

- `onReady` runs once the person is signed in. Build the game inside `ctx.root` (a `position: relative`
  element that fills the rest of the screen; it can change size, so handle `resize`). Use a crisp
  canvas: scale by `devicePixelRatio`.
- Show your own start screen ("Tap to start") for solo play.
- When a solo game ends: `ChowGames.gameOver({ score, title: 'Game over', again: restartFn })`. The core saves
  the score, shows the personal/family record, and offers Play again, Challenge the family and the leaderboard.
- `ChowGames.sfx(name)`: `jump flap coin score point hit crash click tick drop flip match wrong win lose go whoosh`.
  It already respects the mute button.
- `ChowGames.rng(seed)` returns a seeded `() => number in [0,1)`. **Use it for everything random in a
  multiplayer round**, so every player gets the same course.
- `ChowGames.on('pause', fn)` fires when the page is hidden. Pause solo games.
- `ChowGames.toast(text)`, `ChowGames.modal(html)`/`closeModal()`, `ChowGames.modalOpen()`: don't let
  keyboard or tap input drive the game while a modal is open.

### Race games (mode 'race')

- `ChowGames.on('multiStart', info => …)`: fires after the shared 3-2-1 countdown. `info.seed` is the
  round's seed, `info.players` the names, `info.colors` their colours (same order) and `info.me` my name.
  Reset the game with `ChowGames.rng(info.seed)` and start playing **immediately** (no start screen).
- While playing, call `ChowGames.race.update({ score, ...anything small })` every frame or whenever it
  changes. The core sends the latest copy about twice a second and draws a live scoreboard
  (top right). Keep the state small: a few numbers.
- `ChowGames.race.others()` returns `[{ name, color, state, age }]`: the other players' latest states.
  Draw them as see-through "ghosts" (with their name) where it makes sense, e.g. other dinos and cars.
  Their state is up to 0.6 s old, so interpolate gently.
- When you die or finish: `ChowGames.gameOver({ score })`. In a race this reports your finish and shows
  live results. The host can start the next round, which fires `multiStart` again.
- A once-a-day game (Daily Word) must call `ChowGames.race.finish(score)` instead of `gameOver` in a race,
  so a practice race doesn't use up the day's entry.
- `ChowGames.on('multiEnd', fn)`: the person left the multiplayer game. Go back to your solo start screen.
- `ChowGames.isMulti()` is true while a multiplayer round is running.

### Turn games (mode 'turns')

- The host's device calls `initialShared(players, seed)` to make the opening board (plain JSON, under
  20 KB). It must be fully determined by `players` and `seed`.
- `ChowGames.on('multiStart', info)` fires, then `ChowGames.on('shared', (shared, info) => …)` fires
  with the board, and again whenever anyone moves. `info.players`, `info.myIndex` (-1 = watching),
  `info.colors`. Store whose turn it is inside `shared` and only let that player move.
- `await ChowGames.turns.commit(newShared, { done })` saves a move. It returns false if someone else
  moved first; the fresh board then arrives through 'shared'. Set `done: true` on the final move.
- When the game ends, every device calls `ChowGames.gameOver({ title: 'Amelia wins!', detail, score })`.
  `score` is what to add to the family leaderboard for this person (e.g. 1 for a win, else 0).
- Store the player names inside `shared` and find yourself with `ChowGames.me()`: if someone leaves
  mid-game they drop out of `info.players`, so indexes can shift. People who open the link after the game
  started get the board with `info.myIndex === -1` (watching).
- Solo play against the computer is good too: run it locally without the core, then `gameOver` as usual.

## Quality bar

These are for the whole family, from young kids to grandparents. They should feel polished:
- Smooth 60 fps on phones.
- Big touch targets, with keyboard controls on desktop.
- Clear "how to play".
- Bright, friendly art drawn in canvas or CSS, with no image files needed.
- Juicy feedback (particles, little animations, sounds) and a fair difficulty curve that starts easy.
- Nothing scary or violent.
- They must work in portrait on an iPhone and on a desktop browser.
