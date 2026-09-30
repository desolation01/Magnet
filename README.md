# Magnet Mayhem

A single-player 3D arcade brawler for the browser. You and 10 AI opponents spawn on a floating sky arena, each carrying a magnet. Pull crates, barrels and other players toward you, then blast them away. The last one standing wins.

Built with TypeScript, [Babylon.js](https://www.babylonjs.com/), Havok physics and Vite. Everything is procedural: characters and props are built from mesh primitives, animation is code-driven, and all sound is synthesized with the Web Audio API. There are no external model, texture or audio files.

## How to play

Knock every opponent off the arena. If you fall below the arena, it's game over.

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move (relative to the camera) |
| `Space` | Jump |
| `Shift` (hold) | Sprint |
| Mouse | Aim / rotate the camera (click the game to lock the pointer, `Esc` to release it) |
| Left click (hold) | **Attract**: pull objects and players toward you and hold them |
| Right click | **Repulse**: launch what you're holding and knock back everything in front of you (4 s cooldown) |

- **Magnet power** drains while you attract and regenerates when you stop.
- **Stability** drops each time you're hit. The lower it is, the further the next hit sends you flying. It regenerates over time.
- Magnetic objects that fall off the arena respawn after 5 seconds.

Choose **Easy**, **Normal** or **Hard** on the main menu. Difficulty changes how fast the AI reacts, how accurately it aims, how often it dodges and throws objects, and how careful it is near edges. There are five AI personalities (Aggressive, Defensive, Pusher, Object User, Chaotic), two opponents each.

## Getting started

Requires [Node.js](https://nodejs.org/) 22 or newer.

```bash
npm install
npx playwright install chromium   # only needed to run the tests
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173) in a desktop browser.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Type-check (`tsc --noEmit`) and build to `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm run test:smoke` | Smoke test: start a match and fail on any console error |
| `npm test` | Run the full Playwright suite (movement, magnet, AI, match flow, elimination, input, leak checks) |

The tests build the game, serve it on port 4173 and drive it in headless Chromium through a debug hook (`window.__MM_DEBUG__`). Physics runs in real time, so the suite is slow on software rendering. Two environment variables adjust it:

- `MM_GL=swiftshader` forces software WebGL (the default everywhere except macOS, which uses Metal).
- `PW_WORKERS=<n>` sets how many browsers run in parallel (default 2).

## Project structure

```text
src/
  main.ts          Engine and Havok bootstrap
  config.ts        Every tunable number: movement, magnet, AI, difficulty, colors
  game/            Game loop, state machine, match manager, test/debug hooks
  character/       Shared character (physics body, stability, magnet power) and procedural rig/animation
  player/          Keyboard/mouse controller and third-person camera
  ai/              AI decision loop, targeting/perception and steering behaviors
  combat/          Magnet (attract, hold, repulse), knockback and visual effects
  arena/           Static arena geometry and magnetic object spawns/respawns
  ui/              HTML/CSS HUD, menus, end screens, notifications; Babylon GUI nameplates
  audio/           Web Audio sound synthesis
  util/            Math helpers and the seedable RNG
tests/             Playwright specs
```

The player and the AI drive the same `Character` class through the same input struct, so both follow identical movement, magnet and cooldown rules. All AI randomness goes through one seedable RNG, so a seed reproduces a match.

## Tuning

Gameplay numbers (speeds, magnet range and strength, cooldowns, AI personalities and difficulty tables) are all in [`src/config.ts`](src/config.ts). Change them there, not in the game logic.

## Assets and licenses

No third-party art or audio is used. See [ASSET_LICENSES.md](ASSET_LICENSES.md) for details and for the npm libraries the game bundles.
