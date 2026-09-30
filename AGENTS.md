# AGENTS.md — Magnet Mayhem

## Project Overview

Build a complete playable **single-player 3D browser game called "Magnet Mayhem" using Babylon.js**.

The game should feel like a polished Roblox-style arcade game:

- Low-poly 3D
- Colorful and readable
- Chunky/simple geometry
- Slightly exaggerated proportions
- Smooth third-person movement
- Fun physics interactions
- Simple UI
- Designed to run smoothly in a normal desktop browser
- No multiplayer

The player fights against **10 AI-controlled opponents**.

The core objective is:

> Knock other players out of the arena using magnetic attraction and repulsion.

The core loop is:

`SPAWN → MOVE → AIM MAGNET → ATTRACT / REPULSE → USE ENVIRONMENT → KNOCK OPPONENTS OFF → SURVIVE → WIN → RESTART`

The game should prioritize **fun gameplay and emergent physics interactions over complexity**.

All numbers in this document are **starting values**. Every one of them lives in `src/config.ts` (see §33) so it can be tuned without touching game logic.

---

# 1. Non-Negotiable Development Rules

1. Build the game incrementally, following the phases in §40 in the order they are listed.
2. Do not put the entire game in one file. Follow the structure in §33.
3. Use TypeScript, Babylon.js, Havok physics and Vite. Nothing else unless a phase requires it.
4. The MVP uses **no external asset files**. Characters and props are built from Babylon.js primitives and sounds are synthesized with the Web Audio API.
5. Keep the game at about 60 FPS on a normal desktop/laptop.
6. Do not add multiplayer, accounts, databases, inventories, shops, quests or backend systems (see §43).
7. Do not leave broken placeholder systems. If a system is not done, it should not appear in the game.

## 1.1 Verification Loop (required after every phase)

After every phase in §40:

1. Run `npm run build` (`tsc --noEmit && vite build`). It must pass with zero TypeScript errors.
2. Run `npm run test:smoke` (Playwright, see §1.2). It must pass.
3. Test the phase's gameplay acceptance criteria. If an acceptance criterion can only be judged by a human (feel, fun, visuals), say so explicitly and ask the user to check it. Do not claim it works.
4. Fix all failures before starting the next phase.

## 1.2 Smoke Test

`tests/smoke.spec.ts` (Playwright, Chromium):

1. Start the Vite preview server (use Playwright's `webServer` config).
2. Open the page and collect every `console` message of type `error` and every `pageerror`.
3. Click the **PLAY** button on the main menu.
4. Wait until `window.__MM_DEBUG__.state === "PLAYING"` (timeout 10 s).
5. Wait 3 more seconds.
6. Fail if any console errors or page errors were collected.

The game exposes a read-only debug object for this test:

```ts
window.__MM_DEBUG__ = { state: GameState, aliveCount: number, fps: number };
```

It also carries `meshes`, `bodies`, `particles` and `nameplates` counts, the startup `quality` tier (`"high"` / `"low"`) and the current adaptive `renderScale` (§32). It is refreshed about 4 times per second (`DEBUG.publishInterval`) and immediately on every state change and elimination.

Additional debug hooks (development and automated tests only, never used by the game itself):

- **`?noend`** URL parameter: the match keeps running after the player is eliminated, until one character is left. Used by headless AI playtests with an idle player.
- **`window.__MM_DUMP__()`**: returns a snapshot for playtests: `{ time, eliminations: [{ name, time, by, x, z, speed, gx, gz, behavior, hit }], ai: [{ name, personality, alive, behavior, zone, target, x, y, z, power, stability }] }`. `by` is the last character that hit or pulled the eliminated one (`null` = self-inflicted fall), `gx/gz` its last grounded position and `hit` the kind and strength of the last knockback.
- **`?test`** URL parameter: installs `window.__MM_TEST__` (`src/game/DebugHooks.ts`) for the Playwright specs: state/character/object snapshots, player input override, teleports, AI freeze.

If WebGL is unavailable in headless Chromium, launch it with `--use-angle=swiftshader`.

---

# 2. Technology

## 2.1 Project Bootstrap (Phase 1, first step)

The folder currently contains an unrelated old prototype ("Candy Isle"). Before starting:

1. Delete `index.html`, `game.js`, `_test.html` and `_chompy_test.html`.
2. Scaffold a Vite + TypeScript project at the repository root (`npm create vite@latest . -- --template vanilla-ts`, or the equivalent manual setup).
3. Install runtime dependencies: `@babylonjs/core`, `@babylonjs/gui`, `@babylonjs/havok`.
4. Install dev dependencies: `@playwright/test` (then `npx playwright install chromium`).
5. Add scripts: `dev`, `build`, `preview`, `test:smoke`.
6. In `vite.config.ts`, add `optimizeDeps: { exclude: ["@babylonjs/havok"] }` so the Havok WASM file loads correctly.

Do not add any other dependencies without a clear reason stated to the user.

## 2.2 Browser Input

- Clicking the canvas during PLAYING requests **pointer lock**. Mouse movement then rotates the camera.
- Disable the browser context menu on the canvas (`contextmenu` → `preventDefault`) so right-click can be used for Repulse.
- Read mouse buttons from **pointer events** (`pointerdown` / `pointerup` / `pointermove`) by diffing `PointerEvent.buttons` (bit 1 = left, bit 2 = right). Babylon calls `preventDefault` on the canvas `pointerdown`, which suppresses `mousedown`/`mouseup`, and a second button pressed while another is held (right click while holding attract) only fires `pointermove`. The click that acquires pointer lock never triggers a magnet action.
- Pressing ESC releases pointer lock (browser default). The game does not need a pause menu. While pointer lock is released, the match keeps running.

## 2.3 Rendering of UI

- HUD, menus, countdown, notifications and end screens are **HTML/CSS overlays** above the canvas. They are simple to style and easy for Playwright to click.
- Nameplates above characters are camera-facing billboards, one small `AdvancedDynamicTexture` per character (`src/ui/Nameplates.ts`), not a single fullscreen `linkWithMesh` GUI (see §28).

The game runs entirely client-side.

---

# 3. Core Match Structure

Each match contains exactly:

- 1 human player
- 10 AI opponents
- 11 total characters

All characters spawn simultaneously.

The match ends on the **first** of these conditions:

| Condition | Result |
|---|---|
| The player is eliminated | GAME OVER screen immediately, even if several AI are still alive |
| The player is alive and 0 AI remain | YOU WIN screen |
| The player and the last AI are eliminated in the same frame | GAME OVER |

Game over screen:

```text
GAME OVER

Opponents Remaining: X

[RESTART]   [MENU]
```

Victory screen:

```text
YOU WIN!

Opponents Eliminated: 10
Time: mm:ss

[PLAY AGAIN]   [MENU]
```

- **RESTART / PLAY AGAIN** resets the match (§38) and goes straight to the countdown with the same difficulty.
- **MENU** returns to the main menu, where the difficulty can be changed.

Neither requires a page refresh.

---

# 4. Arena

One floating arena in the sky, about **82 × 82** centered on the origin (x and z from about −41 to +41). The top surface of the base platforms is at y = 0. The design and reasons are in `docs/superpowers/specs/2026-09-29-arena-expansion-design.md` (user-approved 2026-09-29, 1.5× the original 60 × 60 arena).

Below the arena is empty sky. An elimination check at **y = −10** eliminates any character whose center falls below it (§29).

Use a simple sky color or gradient (no skybox texture needed).

---

# 5. Arena Layout

The layout is data in `src/arena/ArenaLayout.ts` (platforms, walkways, static pieces); `Arena.ts` builds geometry, edge footprints and the routing graph from it. Sizes are in world units, all in `ARENA` in `config.ts`. N = −Z, E = +X.

```
            (NW)──────[ N ]──────(NE)          ── ring catwalk, 2.5 wide
              \         |         /            |  spoke bridge, 3 wide
               \        |        /             ( ) diagonal island, circle r 7
    [ W ]──────────( HUB r20 )──────────[ E ]  [ ] cardinal platform, 14×14
               /        |        \             bounce pads on the hub rim face each island
              /         |         \
            (SW)──────[ S ]──────(SE)
```

## 5.1 Base Platforms and Walkways (used for edge awareness and routing)

| Piece | Shape | Size | Center |
|---|---|---|---|
| Hub | cylinder | r 20, thickness 2 | (0, −1, 0) |
| Cardinal platforms N/S/E/W | box | 14 × 2 × 14 | distance 34 on each axis |
| Diagonal islands NE/SE/SW/NW | cylinder | r 7, thickness 2 | (±24, ±24) |
| Spoke bridges (4) | box | 3 wide, 1 thick | hub rim (r 20) → cardinal inner edge (27), along the axes |
| Ring catwalks (8) | box, rotated | 2.5 wide, 1 thick | each cardinal ↔ its two neighbouring islands, along the line between their centers, clipped to both footprints (about 11.4 long) |

- Walkway meshes overlap both platforms by 0.5 (`ARENA.walkwayOverlap`). Their tops sit 1 cm below y = 0 (`ARENA.bridgeTopOffset`) so the surfaces never z-fight.
- The diagonal islands are reached **only** through the catwalks or the bounce pads (§5.4).

## 5.2 Obstacles (static)

All on top of the base platforms (surface y = 0). The hub has point symmetry.

| Piece | Size | Center (x, z) | Notes |
|---|---|---|---|
| Raised block A / B | 6 × 2 × 6 | (9, −4) / (−9, 4) | top at y = 2 |
| Ramp A / B | 3 wide × 4 long | (4, −4) / (−4, 4) | join block A's west side / block B's east side |
| Pillars ×4 | cylinder r 1, h 5 | (11, 7), (−11, −7), (4, 14), (−4, −14) | |
| Cover walls ×2 | 0.6 × 1.2 × 4 | (14, 3.5), (−14, −3.5) | low, jumpable |
| Guard walls E/W | 0.5 × 1.2 × 8 | (±40.5, 0) | outer edge of E and W |
| Guard rails N/S | 0.5 × 1.2 × 3, two each | outer corners of N and S | middle left open |

Island themes (colliders, all on the outward half of their island, all avoided by AI wander/flank points):

| Island | Pieces |
|---|---|
| NE crystal garden | 1 hex crystal (convex-hull collider, r 1.1, h 3) |
| SE scrapyard | 2 scrap piles (boxes about 1.5 high) |
| SW grove | 3 tree trunks (cylinder r 0.4, h 2.5) with canopies |
| NW lookout | 3 × 3 × 3 tower with 3 steps (tops at 1, 2, 3) on its hub-facing side |

## 5.3 Magnetic Objects (dynamic)

| Object | Count | Shape | Size | Mass |
|---|---|---|---|---|
| Metal crate | 8 | Box | 1 × 1 × 1 | 2 |
| Metal barrel | 5 | Cylinder | diameter 0.8, height 1.2 | 1.5 |
| Metal ball | 4 | Sphere | diameter 1 | 1 |
| Large metal block | 2 | Box | 2 × 2 × 2 | 6 (heavy) |
| Anvil | 2 | Box collider, anvil-shaped visual | 1.2 × 0.8 × 0.8 | 10 (heavy) |
| Spring ball | 3 | Sphere, striped | diameter 0.9 | 0.8, restitution 0.9 |

- 24 fixed spawns in `OBJECT_SPAWNS` (`ArenaObjects.ts`): hub 10, cardinals 2 each, SE scrapyard 3, NE/SW/NW 1 each. Heavy objects receive 50% of a repulse (§9).
- Magnetic objects have a metallic, slightly emissive material (riveted plate texture) so they read as "magnetic".
- If a magnetic object falls below y = −10, dispose it. Respawn it at its original spawn position after **5 seconds**.
- Moving platforms are **not** part of the MVP (see §44).

## 5.4 Bounce Pads

`src/arena/BouncePads.ts`, values in `BOUNCE` in `config.ts`.

- Four pads on the hub rim at radius 17 on the diagonals, (±12, ±12), each facing the island behind it. Static cylinder r 1.2, h 0.2, glowing top with an arrow.
- A live character whose feet are on the pad (or a magnetic object resting on it) gets its velocity **set** to an arc that lands on the target island's center: `v_y = 14`, horizontal speed = distance / flight time (flight time includes the pad height). Per-body, per-pad cooldown 0.6 s.
- A launched character has 30% movement control, relative to the launch velocity, until it lands. A launch is **not a hit**: no stability loss and no elimination credit.
- Feedback: particle burst, synthesized "boing", pad glow pulse. AI never steer onto pads (they are obstacles for wander/flank points) but can be knocked onto them.

## 5.5 Surfaces and Dressing

- `src/arena/ArenaTextures.ts` / `ArenaTexturePaint.ts`: grayscale procedural canvas textures drawn once at startup, multiplying the existing colors (hub stone tiles, cardinal plates, island turf, walkway planks, rock sides, bricks on blocks/walls/pillars/tower, riveted metal on props). A yellow/black hazard-stripe band runs around every platform rim, 2 cm above the surface, cut where a walkway meets the rim.
- `src/arena/ArenaDecor.ts`: visual-only dressing (no physics, not pickable, no ground or camera tags): rocky undersides, grass tufts, crystal clusters, scrap bits, tree canopies, a flag, bobbing floating rocks and clouds. Repeated items use thin instances.

---

# 6. Player Controls

| Input | Action |
|---|---|
| W / A / S / D | Move forward / left / backward / right, relative to the camera's facing |
| SPACE | Jump (only when grounded) |
| SHIFT (held) | Sprint |
| Mouse movement (pointer locked) | Rotate camera |
| Left mouse (held) | Attract |
| Right mouse (press) | Repulse |

Movement values:

| Constant | Value |
|---|---|
| Walk speed | 7 u/s |
| Sprint speed | 11 u/s |
| Ground acceleration | reach target speed in ~0.1 s |
| Air control | 50% of ground acceleration |
| Jump velocity | 8 u/s upward |
| Gravity | −20 u/s² |

- The character turns to face its movement direction when moving.
- While Attract is held, the character faces the camera's aim direction instead.
- "Grounded" is determined with a short downward raycast (length 0.15 below the capsule bottom).

Movement must feel responsive and arcade-like, not realistic or sluggish.

---

# 7. Third-Person Camera

| Constant | Value |
|---|---|
| Distance behind player | 9 |
| Height above player | 4.5 |
| Mouse sensitivity | 0.0025 rad per pixel |
| Pitch clamp | −10° to +60° |
| Follow smoothing | lerp factor ~10 × dt |

- The camera orbits the player (yaw and pitch from the mouse) and looks at a point 1.5 units above the player's feet.
- **Collision:** each frame, cast one ray from the look-at point toward the desired camera position. If it hits static arena geometry, place the camera at the hit point minus 0.3 units. Ignore characters and magnetic objects for this ray.
- The aim direction for the magnet is the camera's forward direction projected onto the horizontal plane.

---

# 8. Magnet System

The magnet is the only weapon. Every character (player and AI) carries a visible U-shaped magnet and uses the same `MagnetSystem` code with the same rules. AI "presses the buttons" through the same input interface as the player (see §16).

## 8.1 Attract (hold Left Click)

| Constant | Value |
|---|---|
| Range | 10.5 |
| Cone | 60° total width, centered on the aim direction |
| Pull acceleration | 40 u/s² × (1 − distance / range) |
| Hold point | 2.5 units in front of the character, at chest height (1.2) |
| Capture distance | within 1.5 units of the hold point |

Behavior:

1. While held, every magnetic object and every other **ragdolled** character (§24.1) inside the cone and range is pulled toward the hold point. A character that is not ragdolled is never pulled, by anyone (player → AI, AI → player, AI → AI). Apply force/velocity changes through physics. Never teleport.
2. When a target reaches the capture distance, it becomes **held**. A held target is pulled to the hold point by a damped spring (stiffness 60, damping 10) with gravity cancelled, so it hovers in front of the magnet and moves with the character.
3. A character can hold **several objects** at once, but at most **1 character**.
4. A ragdolled character can be pulled and held for its whole ragdoll. When the ragdoll ends it is released and can no longer be pulled. A character thrown by repulse is ignored by the thrower's magnet for **0.75 s** (`ATTRACT.regrabLockout`).
5. Releasing Left Click, running out of Magnet Power, or being knocked back releases everything held.
6. An object launched by repulse (§9) is ignored by the launcher's own magnet for **0.75 s** (`ATTRACT.objectRegrabLockout`), so a thrower who keeps Left Click held does not immediately pull it back.
7. Pulling a character counts as hitting it: if it then falls, the puller gets the elimination credit.

## 8.2 Magnet Power

| Constant | Value |
|---|---|
| Maximum | 100 |
| Drain while attracting | 25 per second |
| Regeneration while not attracting | 20 per second |
| Restart threshold | Attract cannot start again until power ≥ 20 |

- Attract stops automatically at 0.
- Repulse does **not** use Magnet Power. It only has a cooldown.
- The same rules apply to AI.

---

# 9. Repulse (press Right Click)

| Constant | Value |
|---|---|
| Range | 12 |
| Cone | 60° total width, centered on the aim direction |
| Point-blank radius | 2.5 (all directions) |
| Velocity change at 0 distance | 18 u/s horizontally away from the character + 5 u/s upward |
| Characters hit directly | receive 55% of the horizontal velocity change (`REPULSE.characterFactor`) |
| Distance falloff | × (1 − 0.5 × distance / range) |
| Held target launch speed | 25 u/s along the aim direction |
| Large metal block | receives 50% of the velocity change |
| Cooldown | 2.5 s (user decision 2026-09-30, was 4 s; AI scale it by their perk, §21) |

Behavior, in this order:

1. Anything currently held is launched along the aim direction at the launch speed.
2. Every other character and magnetic object inside the cone (or inside the point-blank radius) gets the velocity change. Apply it as an impulse (`impulse = mass × velocityChange`) so light and heavy objects feel consistent.
3. Characters that are hit have the knockback multiplied by their stability multiplier (§24).
4. Play the repulse effects: particle burst, shockwave ring, sound (§30). When the **player** repulses, add a short camera shake (0.15 s, amplitude 0.15).

A direct repulse on a character is deliberately modest: at full stability on flat ground it sends it about 4.4 units from 2 units away and 3.6 units from 4 units away (half of the original 8.7 / 7.4). It knocks a character off when the character is already near an edge. Objects are pushed at full strength, and **projectiles hit harder**: a character hit by a flying object or character is topped up to 70% of the closing speed (`STABILITY.objectHitTransfer`), so a launched crate sends a character about 9 units.

**Speed caps (safety):** a character's horizontal speed is clamped to **30 u/s** (`MOVE.maxHorizontalSpeed`) and a magnetic object's to **30 u/s** (`OBJECTS.maxSpeed`), so stacked repulses and impacts can never produce runaway velocities.

---

# 10. Magnet Visual Effects

Every character visibly carries a stylized magnet.

Preferred appearance:

- U-shaped magnet
- Two contrasting ends (red / silver)
- Simple low-poly geometry
- Slight glow

When attracting:

- Particles travel toward the magnet.
- The magnet glows brighter.

When repulsing:

- Particles burst outward.
- A short expanding shockwave ring.

Keep particle counts low: at most 50 particles per attract emitter and 80 per repulse burst. Attract particles are 0.25–0.45 units, emitted from a box roughly as wide as the cone 7 units ahead. All particle systems share one runtime texture. One-shot bursts come from a fixed pool of 10 systems (`PARTICLES.burstPool`) that lives for the whole session and are never disposed: disposing the last burst released its compiled shader, so the next burst recompiled it (a 200–450 ms stall mid-match). The particle, shockwave and range-indicator shaders are compiled while loading (`Effects.warmUp`). Only the **player's** attract shows continuous particles. AI attract shows only the magnet glow.

---

# 11. Magnet Range Indicator

While the **player** holds Attract, show a translucent **flat 60° sector on the ground** (radius 10.5, the attract range) in front of the player, rotated with the aim. It is warm yellow (`COLORS.rangeIndicator`) so it stays visible on the blue floor at low opacity:

- Fades in over 0.1 s when Attract starts and fades out over 0.2 s when it stops.
- Opacity at most 0.15, no depth write, so it never blocks the view.
- Does not collide with anything.

AI do not show range indicators.

---

# 12. Physics

Use Havok (`@babylonjs/havok` + `HavokPlugin`).

| Object | Physics |
|---|---|
| Base platforms, bridges, obstacles, raised blocks, ramps, walls | Static bodies with box/cylinder shapes |
| Magnetic objects | Dynamic bodies with box/cylinder/sphere shapes, masses from §5.3 |
| Characters (player and AI) | Dynamic capsule bodies (radius 0.5, height 2, mass 1) |

Character physics rules:

- Rotation is locked (set inertia to zero) so characters never tip over. Facing is done by rotating the visual mesh, not the body.
- Movement sets the body's **horizontal** linear velocity toward the target velocity (§6). Vertical velocity stays under physics control.
- Knockback is applied as impulses (§9).
- After receiving a knockback, the character has **30% movement control for 0.4 s**, so the hit actually sends it flying instead of being cancelled by input.
- A grounded character with movement control disabled (countdown, end screens, AI frozen by tests) brakes with the normal ground acceleration, because the capsules are frictionless and would otherwise slide forever. It does not brake while being pulled or held.
- The per-frame `dt` used by game logic is clamped to **0.1 s** (`WORLD.maxFrameDt`), the same clamp Babylon's physics engine applies to its step, so game logic and physics never disagree after a long frame.
- The grounded check (§6) tests a cached list of meshes tagged `metadata.ground` (world bounding-sphere reject first, then the exact ray/mesh test) instead of picking the whole scene.

Only these objects are dynamic. Do not make decoration dynamic.

---

# 13. Character Model

Characters are built from Babylon.js primitives. No external model files. They are merged into a small hierarchy under one root:

- Box torso
- Sphere head
- Box arms and legs (separate meshes so they can be animated)
- U-shaped magnet held in the right hand (a torus half or three boxes, with red/silver tips)

Proportions are chunky and Roblox-like: big head, short legs.

Colors:

- **Player:** gold/yellow torso, with a white highlight outline (`renderOutline`, width 0.06) so it is always easy to find.
- Only the torso, head and legs cast shadows (arms, eyes and magnet are too small to matter).
- Parts whose material is the same for everyone (legs, head, eyes, silver magnet tip) are **instances** of shared hidden source meshes for the AI: one draw call per part type for all AI. The player uses its own copies, because its outline must not spread to the instances. The red magnet pieces are merged into one mesh per character.
- **AI:** each of the 10 AI has its own distinct saturated color, from a fixed palette in `config.ts`.

The visual rig is purely cosmetic. Collisions use only the capsule body (§12).

---

# 14. Animation Requirements

All animation is **procedural (code-driven)**. Rotate/scale the limb meshes each frame. There are no animation files.

States (exactly one active full-body state, plus the MAGNET upper-body overlay while the magnet is in use):

| State | Trigger | Motion |
|---|---|---|
| IDLE | grounded, horizontal speed < 0.5 | gentle body bob, slight arm sway |
| MOVE | grounded, moving | leg/arm swing; swing frequency and amplitude scale with speed (sprint looks faster) |
| AIR | not grounded | arms up, legs tucked |
| KNOCKBACK | during the 0.4 s after a knockback, or while held by another magnet | body tilted backward, arms flailing |
| RAGDOLL | while ragdolled (§24.1), including while held | whole body tipped over onto its back and resting over the capsule, arms spread, slow limp wobble; the body does not turn |
| ELIMINATED | after elimination | spinning flail while falling |
| MAGNET (upper-body overlay) | attracting or repulsing | magnet arm raised forward. Attract: slight vibration. Repulse: quick 0.2 s recoil punch |

Priority: ELIMINATED > RAGDOLL > KNOCKBACK > AIR > MOVE > IDLE. The MAGNET overlay applies on top of AIR/MOVE/IDLE, but not during KNOCKBACK, RAGDOLL or ELIMINATED.

Blend between poses by lerping limb rotations over ~0.1 s so there are no snaps.

Optional polish, only after Phase 13: land squash-and-stretch, and a victory celebrate (jumping with arms up on the VICTORY screen).

---

# 15. Assets and Licensing

- The MVP uses **no external assets**: no models, texture files, animations, sound files or music. Surface textures are drawn on canvases at runtime (§5.5).
- Create `ASSET_LICENSES.md` containing: "No third-party assets are used. All geometry is procedural and all audio is synthesized at runtime."
- If external assets are added later (§44), each must be CC0 or clearly licensed, stored locally in `assets/`, never hotlinked, and logged in `ASSET_LICENSES.md` with source URL and license.

---

# 16. AI Opponents

There are exactly **10 AI opponents** at the start of every match.

Each AI is a `Character` (the same class as the player) driven by an `AIController` instead of keyboard/mouse. The AI controller only writes to the character's input struct:

```ts
interface CharacterInput {
  moveDir: Vector3;   // horizontal, length 0..1
  sprint: boolean;
  jump: boolean;
  attract: boolean;
  repulse: boolean;   // true for one frame to trigger
  aimYaw: number;     // radians
}
```

This guarantees AI follow exactly the same movement, magnet, power and cooldown rules as the player.

Every AI must: move, select targets, attract, repulse, dodge, jump, retreat, respect edges, use objects, and be able to be eliminated (including by its own mistakes). No AI should stand still for more than 2 seconds during PLAYING.

---

# 17. AI Personality Types

Five personalities, two AI each. A personality is **only a set of weights** read by one shared decision loop (§22). Do not write separate code paths per personality.

| Personality | aggression | edgeCaution | objectUse | randomness | flankBias |
|---|---|---|---|---|---|
| Aggressive | 0.9 | 0.3 | 0.2 | 0.2 | 0.2 |
| Defensive | 0.3 | 0.9 | 0.3 | 0.1 | 0.1 |
| Pusher | 0.6 | 0.6 | 0.1 | 0.1 | 0.9 |
| Object User | 0.5 | 0.6 | 0.9 | 0.1 | 0.2 |
| Chaotic | 0.6 | 0.2 | 0.4 | 0.9 | 0.3 |

Meaning of each weight (0–1):

- **aggression:** how much the AI prefers ATTACK over other options and how close it is willing to chase.
- **edgeCaution:** how strongly edge danger (§20) pushes it toward RETREAT.
- **objectUse:** base probability of choosing USE_OBJECT when an object is nearby.
- **randomness:** chance per decision to pick a random target or a random strafe direction.
- **flankBias:** how much it tries to stand on the opposite side of the target from the target's nearest edge before repulsing.

Personality assignment:

```text
AI-01 Aggressive   AI-06 Aggressive
AI-02 Defensive    AI-07 Defensive
AI-03 Pusher       AI-08 Pusher
AI-04 Object User  AI-09 Object User
AI-05 Chaotic      AI-10 Chaotic
```

---

# 18. AI Target Selection

**Perception:** an AI only considers characters within **16 units** of itself (`AI.localPerceptionRadius`, user request 2026-09-30: with 26, AI on the outer platforms all walked into the hub fights and crowded the center). In the late game (§19) this widens to **26 units** (`AI.perceptionRadius`) so the last few AI still find each other on the 1.5× arena. There are no line-of-sight checks. This is what "not omniscient" means for this game.

Score each perceived opponent (player or other AI):

```text
score = aggression
      − distance / 10                                    // AI.targetDistanceScale: prefer local fights
      + 1.0 × clamp(1 − targetEdgeDistance / 7, 0, 1)   // near an edge = attractive
      + 0.5 × (1 − targetStability / 100)                // unstable = attractive
      + 0.6 if the target is ragdolled                   // AI.ragdollTargetBonus
      − 0.5 × (characters within 6 of the target)        // AI.crowdPenalty / crowdRadius: crowded = unattractive
      − 0.5 if the AI itself is in WARNING or DANGER
```

- **Player focus** (user request 2026-09-30): if the player is within **12 units** (`AI.playerFocusRadius`), it is always the target, whatever the scores, and it overrides the 1.5 s target hold. While the player is that close, the player is also the only character the AI will grab (§19).

- Pick the highest score, then add a random value in ±(randomness × 0.5).
- Keep the current target for at least 1.5 s unless it is eliminated or leaves perception range (this prevents jittery switching).
- Difficulty aim error (§21) is applied when aiming at the chosen target.

---

# 19. AI Magnet Logic

Rules used by the decision loop:

- **Attract** a target when it is inside the attract cone and range, and Magnet Power ≥ 20. A character target is only attracted while it is ragdolled (§24.1). A ragdolled opponent gets a target-score bonus (`AI.ragdollTargetBonus`), so AI go for the grab-and-throw. A ragdolled AI makes no decisions.
- **Repulse** when a held object exists and the target is within 12 units in the aim direction, or when an opponent is within 8 units and in the cone. Only if the cooldown is ready.
- **Kill combos** (user request 2026-09-30: AI must actively set up eliminations). The AI's main plan is *throw an object → the hit ragdolls the target → grab the ragdolled target → drop or throw it off the arena*.
- **Object combo (USE_OBJECT behavior):**
  1. Pick the nearest free magnetic object within 20 units (`AI.objectSearchRadius`) that is at most 8 units farther away than the target (`AI.objectDetour`). Chance per decision: `0.4 + objectUse × difficulty object-use multiplier` (`AI.objectComboChanceBase`).
  2. Sprint toward it until 3.5 units away (`AI.objectApproachDist`) and attract until it is held.
  3. **Edge-line throw:** if the target's nearest reachable void is within `9 × its stability multiplier + 6` (`AI.throwKillReach`, `AI.throwLineSlack`), first walk to the spot 6 units behind the target on the far side from that void (`AI.throwStandoff`), until the AI → target direction is within 30° of the target → void direction (`AI.throwLineDeg`), so the hit drives the target off. Skipped when that spot is not standable or magnet power is below 40. Then close to within 7 units (`AI.throwRange`; up to 12 when power is below 40) and aim at the **intercept point** (where a projectile at the AI's launch speed meets the moving target, at most 1 s ahead, `AI.maxLeadTime`), with 40% of the difficulty aim error (`AI.throwAimErrorScale`).
  4. Repulse to launch it. A launch of anything held waits only for the cooldown and the opening delay, not the repulse rest (power drains while holding).
  5. Abort if it takes longer than 6 s (`AI.objectComboTimeout`); 2 s before the next combo (`AI.objectComboCooldown`).
- **Grab (GRAB behavior):** a ragdolled opponent within 22 units (`AI.grabSearchRadius`) that the AI can reach before its ragdoll ends, and that nobody else holds, is the top priority after DANGER and dodging. The AI sprints to within 3.5 units while attracting, and once it holds the opponent:
  1. It scans 16 directions for the nearest reachable void (`findDropDirection`; paths through walls, blocks, pillars or bounce pads are skipped) and faces it.
  2. If repulse is ready and that void is within 18 units (`AI.throwVoidRange`), it throws the opponent into it.
  3. Otherwise it walks toward the void until 1 unit from it (`AI.carryStandoff`; the edge guard shrinks to 0.6 while carrying) and lets go once the opponent hangs at least 0.6 out over the void (`AI.dropOverhang`). It keeps the elimination credit from the pull.
  4. While holding someone it never retreats or dodges.
- **Finisher** (part of GRAB, before pulling): if the AI's repulse is ready, the ragdolled opponent is not held by anyone, and its nearest void is within `8 × its stability multiplier` (`AI.finishReach`), the AI lines up 2.5 units behind it on the far side from the void (`AI.finishStandoff`) and repulses it off from within 4 units (`AI.finishFireDist`). Several AI can go for the same helpless opponent.
- **No caution retreats during a kill:** while an AI holds anything or has a grabbable ragdolled opponent, it skips the low-stability and WARNING retreat rolls (DANGER still retreats).
- **Direct repulses flank more:** the ATTACK flank chance is `flankBias + 0.4` (`AI.flankBonus`), so direct repulses push targets toward an edge.

**Aiming, commitment and pacing** (tuned so matches last 1–3 minutes, see the balance targets under Phase 9):

- **Aim turn rate:** an AI's aim turns toward where it wants to aim at most **300°/s** (`AI.aimTurnRateDeg`). It never snaps. It only fires repulse when its aim is within **15°** of the wanted direction (`AI.fireAlignDeg`).
- **Repulse commitment:** at each decision, an AI that is not yet committed rolls `0.3 + 0.5 × aggression` (`AI.repulseChanceBase/Aggression`). Once committed, it fires at the next opportunity from the rule above. Held objects/characters are launched without this roll.
- **Repulse rest:** after firing, an AI waits its (perk-scaled) cooldown **plus** a rest of `random(1.5, 3) s × (1.4 − aggression) × difficulty.repulseRestMultiplier` (`AI.repulseRestMin/Max`, `AI.repulseRestAggressionBase`; halved 2026-09-30) before it may repulse again. Aggressive AI rest about 0.75–1.5 s, Defensive about 1.65–3.3 s.
- **Opening:** no AI repulses before a random time of 5–9 s after GO! (`AI.openingRepulseMin/Max`) and none attracts before 1.5–3.5 s (`AI.openingAttractMin/Max`).
- **Attract usage:** when an AI starts attacking a target, it decides once whether to use attract on it, with chance `0.3 + 0.5 × aggression` (`AI.attractChanceBase/Aggression`).
- **Late-game push** (user decision 2026-09-29, for the 1.5× arena): once at most 5 AI are alive (`AI.lateGameAliveAI`), every AI flanks more (`flankBias + 0.5`), commits to repulses more (`+ 0.3`), rests 60% less (`× 0.4`), weighs "target near an edge" twice as much, and no longer retreats for low stability (only DANGER retreats). Without it the last AI, all worn down to stability ≈ 0, kept retreating to the hub center where no knockback reaches an edge, and matches stalled past 4 minutes.
---

# 20. AI Edge Awareness

**Edge distance** is computed against the **base platforms** in §5.1:

1. Cast a ray straight down from the character to find which base platform it is above.
2. Distance to edge:
   - **Cylinder:** radius − horizontal distance to the center.
   - **Box:** the smallest distance to any of its four sides.
3. If the character is on a **walkway** (spoke bridge or catwalk, any direction), it is always at least WARNING. Walkway footprints are rotated rectangles (center, axis, half length, half width).
4. Raised blocks, ramps and island pieces are ignored. Falling off them lands on the platform below.
5. If nothing is below the character (airborne over a gap), treat it as DANGER.

Every `Platform` object stores its shape and footprint so this check is cheap.

Zones (thresholds multiplied by the difficulty's edge multiplier, §21):

```text
                hub                  cardinal platforms and islands
SAFE:           edge distance > 7    edge distance > 3.5
WARNING:        3 < distance ≤ 7     1.5 < distance ≤ 3.5   → retreat roll against edgeCaution (see below)
DANGER:         distance ≤ 3         distance ≤ 1.5         → RETREAT toward the platform center, unless a mistake is rolled
walkways:       always WARNING
```

Cardinal platforms and islands use smaller thresholds (`AI.outerSafeEdge`, `AI.outerDangerEdge`): with the hub values, most of a 14 × 14 platform or an r 7 island would be WARNING, so cautious AI could never cross. Near a walkway end (within 2.5 along its axis, `AI.walkwayCorridorExtend`), the edge distance is raised to at least 4 so walking onto a walkway is never DANGER.

**WARNING only matters when heading outward:** the retreat roll happens only if the AI is moving (velocity > 0.5 u/s, `AI.warningOutwardSpeed`) or steering toward its nearest edge, and never while it is deliberately crossing to another platform (standing on a walkway, or its target or wander point is on a different platform).

**Per-frame edge guard** (cheap, runs every frame after the behavior's steering): on a walkway, the part of the AI's steering across the walkway axis is replaced by a pull back to its centerline (`AI.bridgeCenterGain`); an AI with (almost) no steering on a walkway steps off it along the axis instead of circling sideways; on a platform within **1.5** units of the edge (`AI.edgeGuardDistance`), any outward component of the steering is removed. Knockback is not affected.

**Mistakes:** each decision in DANGER has a difficulty-based chance (§21) of ignoring the danger for that decision. The same chance, rolled every decision, also switches the per-frame edge guard off until the next decision. The AI must not be perfectly safe.

---

# 21. AI Difficulty

The player picks the difficulty on the main menu. The default is **NORMAL**.

| Setting | EASY | NORMAL | HARD |
|---|---|---|---|
| Decision interval | 400 ms | 300 ms | 200 ms |
| Reaction delay (before acting on a new decision) | 500 ms | 300 ms | 150 ms |
| Aim error (random, ±) | 20° | 10° | 4° |
| Edge threshold multiplier | 0.7 | 1.0 | 1.3 |
| Mistake chance in DANGER | 15% | 7% | 2% |
| Dodge chance | 10% | 30% | 60% |
| Object-use multiplier | 0.5 | 1.0 | 1.5 |
| Repulse rest multiplier (§19) | 1.5 | 1.0 | 0.7 |
| AI perk: repulse cooldown | ×1.0 | ×0.7 | ×0.55 |
| AI perk: launch speed of held objects/characters | ×1.0 | ×1.15 | ×1.25 |
| AI perk: attract pull strength | ×1.0 | ×1.4 | ×1.7 |

All of these live in one table in `config.ts` (`DIFFICULTY`, perks in `aiPerks`).

**AI perks** (user decision 2026-09-30: AI may cheat so they can finish kills). Every character carries `perks` (`MagnetPerks`); the player always has `NO_PERKS` (all 1), AI get their difficulty's `aiPerks`, applied in `MagnetSystem`. With the 2.5 s base cooldown the AI cooldown is 2.5 s (EASY), 1.75 s (NORMAL) and 1.4 s (HARD), all shorter than the 3 s ragdoll, so a thrower can grab its victim and throw it before it recovers.

---

# 22. AI Decision Loop

Run decisions on a timer (decision interval from §21), not every frame. Stagger AI timers randomly so the 10 AI never all decide on the same frame.

At each decision:

1. Gather perceived opponents and magnetic objects (§18).
2. Compute own edge zone (§20).
3. Select a target (§18).
4. Choose one behavior:
   - **GRAB** (keep going) if the AI is holding a character (§19).
   - **RETREAT** if DANGER (unless a mistake is rolled); or if stability < 30 (`AI.lowStability`) and a roll against edgeCaution × 0.5 succeeds (not in the late game, §19); or WARNING while heading outward (§20) and a roll against edgeCaution succeeds.
   - **DODGE** (§23) if a dodge trigger is present and the dodge chance roll succeeds (never while holding an object).
   - **GRAB** (§19) if a ragdolled opponent qualifies (not while holding an object, and not before the attract opening delay).
   - **USE_OBJECT** (§19) if an object qualifies and a roll against `0.4 + objectUse × the difficulty multiplier` succeeds.
   - **ATTACK** if a target exists.
   - **WANDER** otherwise.
5. Write the result into steering targets. Movement and aiming are applied smoothly every frame from those targets.

---

# 23. AI Movement

Simple steering only. No navmesh or pathfinding.

| Behavior | Movement |
|---|---|
| ATTACK | On a walkway (target not on the same walkway): first cross to the entry point on the target's side — no standoffs on narrow walkways. Otherwise move to within 6–10 units of the target. Pushers (and high flankBias) first move to a point 7 units (`AI.flankDistance`) behind the target, opposite its nearest edge (for a target on a bridge: along the bridge axis). A flank point whose edge distance is < 3 (over the void or at an edge) is rejected and the AI approaches directly. Attract when in range; repulse per §19 |
| RETREAT | Sprint toward safety. On the hub: radially inward to radius 11 (`AI.retreatRadius`, was 7; still SAFE), so retreating AI spread out instead of piling up at the center. On a cardinal platform or island: toward that platform's center. On a walkway: toward the center of its nearer end platform (never straight toward a far platform, which leads off the side). Over the void: toward the nearest platform point. Shove (repulse) anyone within 3 units on the way |
| DODGE | Trigger: an opponent within 12 units is facing this AI (within 20°) and that opponent's repulse is ready. Response: sprint sideways (perpendicular to the threat) for 0.5 s; jump with 50% chance |
| USE_OBJECT | Per §19 |
| GRAB | Per §19: approach and pull a ragdolled opponent, then carry it to the nearest void and drop it, or throw it there |
| WANDER | Walk to a random point anywhere on the arena: a base platform picked by area, at least 2 inside its rim (`AI.wanderEdgeMargin`; hub points within radius 14, `AI.wanderRadius`). Re-picked (up to 6 tries) if it lies within 1 unit of an obstacle footprint (blocks, pillars, walls, island pieces, bounce pads), and whenever the AI gets stuck |
| Separation | Every frame, an AI steers away from other characters within 4 units (`AI.separationRadius`, weight `AI.separationWeight`), except its target and anyone it holds. Off on walkways and within 3 units of an edge (`AI.separationEdgeClearance`), where a sideways shove is fatal, and while carrying or dodging |
| Strafe | During ATTACK, add a sideways component that flips direction every 1–2 s; randomness increases strafing |

Jumping: AI jump when blocked (moving but horizontal speed < 1 for 0.5 s), during dodges as above, and to cross onto ramps.

Routing between platforms goes through the walkways (`Arena.nextWaypoint`): a graph of 9 platforms and 12 walkways with a next-hop table built once at load (Floyd–Warshall over center distances). On a platform, the AI walks to the walkway entry point (2 inside the rim on its axis, `AI.walkwayEntryInset`), then across once lined up (within 0.8 of the centerline); on a walkway it heads for the end closer (in the graph) to its destination. A destination over the void is first clamped to the nearest point on a platform.

---

# 24. Combat Model and Stability

There is no HP. Characters are eliminated only by falling (§29).

**Stability** (every character, shown for the player in the HUD):

| Constant | Value |
|---|---|
| Range | 0–100, starts at 100 |
| Repulse hit | −25 |
| Hit by a magnetic object moving faster than 8 u/s | −15 (at most once per 0.5 s per object) |
| Regeneration | +1 per second |
| Knockback multiplier | `1 + 0.6 × (100 − stability) / 100` (×1 at full, ×1.6 at zero; `STABILITY.extraKnockback`) |

Lower stability = the character flies further. Keep the system this simple.

- The multiplier scales only the **horizontal** part of a knockback. Scaling the upward part too would lengthen the flight time as well and square the distance.
- The factor was tuned down from 1.0 (×2 at zero) to 0.6 (user decision, 2026-09-29; the coder had tried 0.35): with ×2, back-to-back hits sent characters from the middle of the central platform off the arena, and most AI died in the first 20 s.

## 24.1 Ragdoll

A character hit by a projectile (the object hit above: a magnetic object, or a flying knocked-back or thrown character, closing at more than 8 u/s) is **ragdolled for 3 s** (`RAGDOLL.duration`), after that hit's own knockback. While ragdolled:

- It has no control: no moving, jumping, attracting or repulsing, and it drops anything it holds. It brakes on the ground like any character without control.
- It **can be attracted** (§8.1), for the whole ragdoll. It is the only time a character can be pulled.
- Its horizontal knockback is multiplied by **1.85** (`RAGDOLL.knockbackMultiplier`, stacking with stability), which about doubles the travel distance: a point-blank direct repulse from 2 units sends it 8.9 units instead of 4.4.
- Further hits still knock it back but **do not extend** the ragdoll.

---

# 25. Magnet Stats Summary

All values are in `config.ts` and defined in §8 (Attract, Magnet Power) and §9 (Repulse). Upgrades (strength, range, cooldown, speed) are **not** part of the MVP (see §44).

---

# 26. Repulse Cooldown UI

Bottom-right panel:

```text
REPULSE
READY
```

After use, count down with one decimal place (rounded up, so it never shows `0.0s`), updated every frame:

```text
REPULSE
1.4s
```

Then back to `READY`. The panel is dimmed while cooling down and brightens (with a short pulse) when ready.

---

# 27. UI (HUD)

HTML/CSS overlay, visible only in COUNTDOWN and PLAYING. Chunky rounded Roblox-like style, readable from 1280×720 up.

| Position | Content |
|---|---|
| Top-left | `PLAYER`, `STABILITY` bar (0–100), `MAGNET POWER` bar (0–100) |
| Top-center | `OPPONENTS LEFT: N` |
| Top-right | `MATCH TIME` as `mm:ss` |
| Bottom-center | `[LEFT CLICK] ATTRACT  [RIGHT CLICK] REPULSE  [SPACE] JUMP  [SHIFT] SPRINT` |
| Bottom-right | Repulse cooldown (§26) |
| Center-top | Notification feed (§29) |

Update HUD values from game state each frame, but only write to the DOM when a displayed value changes.

---

# 28. Character Nameplates

- Every character has a floating nameplate above its root, offset about 2.8 units above the feet (`CHARACTER.nameplateOffset` 1.8 above the body center).
- Each plate is a camera-facing billboard plane carrying its **own** small `AdvancedDynamicTexture`, drawn once when the character spawns, and rescaled every frame to keep a constant on-screen height (`NAMEPLATE.heightPx`). One fullscreen `linkWithMesh` GUI is **not** used: it re-uploads a screen-sized texture every frame the characters move (the game's biggest GPU cost).
- Labels: `PLAYER`, `AI-01` … `AI-10`.
- The player's nameplate is gold. AI nameplates use a white label on a background tinted with that AI's color.
- Remove the nameplate when the character is eliminated.

---

# 29. Elimination

When a character's center drops below **y = −10**:

1. Mark it eliminated immediately and remove it from the alive count.
2. Switch it to the ELIMINATED animation.
3. Spawn a small particle burst at its position.
4. Show a notification: `AI-04 ELIMINATED` (or `PLAYER ELIMINATED`). Notifications stay 2 s, with at most 4 on screen at once.
5. Remove its nameplate.
6. After **1 s**, dispose its mesh, physics body and any particle systems.
7. Check the match end conditions (§3).

Once the match has ended (GAME OVER / YOU WIN), characters that still fall are eliminated silently: no notification and no sound over the end screen.

No physics body, particle system or temporary mesh may stay alive after it is no longer needed.

---

# 30. Audio

All sounds are **synthesized at runtime with the Web Audio API** in `audio/AudioManager.ts`, using oscillators, noise buffers and gain envelopes. No audio files and no music in the MVP.

- Create/resume the `AudioContext` on the first user click (the PLAY button), because of browser autoplay rules.
- Sounds, in priority order:
  1. **Repulse:** the most recognizable sound. A low "whoomp" with a sweep down plus a noise burst.
  2. **Attract:** a quiet looping hum while held (player only; AI attract is silent or much quieter).
  3. **Metal impact:** a short clank, with volume scaled by impact speed and rate-limited to at most 8 per second.
  4. **Elimination:** a falling-pitch whistle.
  5. **Jump / land:** short blips.
  6. **Victory / defeat:** short jingles.
  7. **Footsteps:** not in the MVP.
- Sounds from AI are attenuated by distance to the player (silent beyond 30 units).
- Master volume constant in `config.ts`.

---

# 31. Visual Direction

Target:

> Roblox-inspired low-poly arcade arena.

Use:

- Simple geometry
- Rounded shapes
- Bright materials
- Minimal textures
- Large readable objects
- Chunky characters
- Colorful platforms
- Soft shadows
- Ambient lighting
- Limited post-processing

Avoid:

- Photorealism
- Complex realistic textures
- Huge environments
- Detailed interiors
- Excessive particles
- Excessive post-processing

The player should be able to understand the arena immediately.

Arena materials use a small emissive glow (`ARENA.emissiveFactor` 0.1 × their color). The central platform is a saturated blue (`#2466c4`): the hemispheric + sun lighting brightens lit top faces well above 1×, so lighter base colors wash out and blend into the sky.

---

# 32. Performance

Target:

`~60 FPS` on a normal desktop/laptop.

Optimize using:

- Instancing for repeated objects
- Static geometry for static objects
- Simple physics collision shapes
- Low-poly models
- Reasonable texture sizes
- Limited particle counts
- AI decision intervals
- Proper disposal of temporary objects
- Avoiding unnecessary per-frame allocations

Do not simulate every environment object.

Only simulate objects that matter to gameplay.

Implemented optimizations: Babylon **deep imports** (e.g. `@babylonjs/core/Meshes/mesh`, never the package root; `main.ts` adds the side-effect imports for the physics, shadow, outline, particle and ray components), which cut the main chunk from ~7.4 MB to ~1.5 MB; only large character parts cast shadows; object collision sounds listen to `COLLISION_STARTED` only; debug publishing runs at 4 Hz and cooldown-map pruning at 1 Hz; nameplates are billboards with a per-character GUI texture instead of one fullscreen linked GUI (§28); `RENDER.maxPixelRatio` 1.5 caps the render resolution on Retina/5K displays (measured 57 → 111 FPS at 2560×1440 CSS); instanced character parts (§13) and no shadow casting by the base platforms and walkways (they are the floor, with only sky below) cut draw calls from about 377 to about 150–250 per frame; pooled particle bursts and shader warm-up (§10) removed every mid-match shader compile.

**Low-end devices** (`src/game/Quality.ts`, values in `QUALITY`):

- **Startup tier:** `low` when `navigator.deviceMemory` ≤ 4 GB or `hardwareConcurrency` ≤ 4, `high` otherwise; `?quality=low|high` overrides. Low: no MSAA, pixel ratio 1, 1024 shadow map (4 MB of GPU memory instead of 16 MB). A software WebGL renderer (SwiftShader, llvmpipe) also gets the low shadow map.
- **Adaptive resolution** (every device): the median frame time of each 1 s window decides. Below 50 FPS the render scale steps down by 0.25 (never below half resolution per axis); after 5 s at ≥ 58 FPS it steps back up by 0.125, and an upscale that drops the FPS again within 3 s blocks upscaling for 30 s. Still below 30 FPS at half resolution: the shadow map is cleared once and never redrawn (no shader recompile).

---

# 33. Project Structure

```text
index.html
vite.config.ts
playwright.config.ts
package.json
tsconfig.json

src/
  main.ts                 // bootstrap engine, Havok, Game
  config.ts               // ALL tunable constants and tables (movement, magnet, AI, difficulty, colors)

  game/
    Game.ts               // owns scene, systems, render loop
    GameState.ts          // state enum + state machine
    Quality.ts            // startup quality tier + adaptive resolution (§32)
    MatchManager.ts       // spawn, alive tracking, win/lose, reset
    DebugHooks.ts         // test-only window.__MM_TEST__ (?test, §1.2)

  character/
    Character.ts          // shared by player and AI: body, visuals, input struct, stability, magnet power
    CharacterVisual.ts    // primitive rig + procedural animation (§13–14)
    GroundQuery.ts        // cached grounded-ray test against metadata.ground meshes (§12)

  player/
    PlayerController.ts   // keyboard/mouse → CharacterInput
    ThirdPersonCamera.ts

  ai/
    AIController.ts       // decision loop → CharacterInput
    AIBehavior.ts         // behaviors + steering
    AITargeting.ts        // perception, scoring, edge zones

  combat/
    MagnetSystem.ts       // attract, hold, repulse, cooldowns, effects
    KnockbackSystem.ts    // impulses, stability multiplier, control loss

  arena/
    ArenaLayout.ts        // the arena as data: platforms, walkways, static pieces (§5)
    Arena.ts              // builds static geometry; edge footprints, routing graph, edge queries
    ArenaObjects.ts       // magnetic object spawns/respawns
    BouncePads.ts         // hub-rim pads that launch bodies onto the islands (§5.4)
    ArenaTextures.ts      // applies procedural textures + hazard edge trim (§5.5)
    ArenaTexturePaint.ts  // canvas painting for those textures
    ArenaDecor.ts         // visual-only dressing, floating rocks, clouds (§5.5)

  ui/
    HUD.ts
    MainMenu.ts
    Screens.ts            // countdown, game over, victory
    Nameplates.ts
    Notifications.ts

  audio/
    AudioManager.ts

tests/
  smoke.spec.ts
  arena.spec.ts           // layout, routing between all platform pairs, clearance, walking to islands
  playtest.spec.ts        // PLAYTEST=1 only: 3 headless balance matches with a summary table
  ...                     // flow, movement, magnet, input, elimination, ai, leak specs + helpers.ts

ASSET_LICENSES.md
AGENTS.md
```

A file may be split further if it grows past about 400 lines. Do not merge these into fewer files.

---

# 34. Game State

State machine in `GameState.ts`:

```text
MENU → COUNTDOWN → PLAYING → PLAYER_ELIMINATED | VICTORY
                     ↑                  │
                     └── RESTART ───────┘      (MENU button → MENU)
```

- **MENU:** title `MAGNET MAYHEM`, difficulty buttons `EASY / NORMAL / HARD` (NORMAL preselected), `PLAY` button. The arena is visible behind the menu, with the camera slowly orbiting it. The menu card sits on the left and the orbit camera is panned sideways (`CAMERA.menuPan`) so the arena shows on the right instead of behind the card.
- **COUNTDOWN:** see §35.
- **PLAYING:** full gameplay.
- **PLAYER_ELIMINATED / VICTORY:** end screens from §3. Physics keeps running in the background, but AI decisions and input stop.

---

# 35. Match Countdown

`3` → `2` → `1` (1 s each) → `GO!` (shown for 0.5 s).

During the countdown:

- Movement, jumping and the magnet are disabled for everyone.
- Characters are visible at their spawns.
- The camera is active and follows the player (mouse look allowed).

When `GO!` appears: enable input and magnets, start the match timer, and start the AI decision timers.

The countdown text is a bold gold fill with a thick dark stroke, at about 24% from the top of the screen (above the player's head). It is hidden as soon as the state leaves PLAYING, so `GO!` never lingers over an end screen. The "CLICK TO AIM" pointer-lock hint sits at about 72% from the top, on a dark pill background, so it never covers the player.

---

# 36. Spawn System

11 fixed spawn points, 1.5 units above the platform surface (listed in `config.ts` as `SPAWN.points`):

- **7 hand-picked points** on the hub, each at least 2 units from any obstacle and at least 4 units from each other: (−0.5, 16), (0.5, −16), (−16, 0.5), (16, −0.5), (−4, −5), (4, 5), (−7, −1).
- **4 points**, one at the center of each cardinal platform: (0, ±34), (±34, 0). The islands have no spawns.

Rules:

- The player always spawns at point (−0.5, 16).
- The 10 AI are shuffled randomly across the remaining 10 points each match.
- Each AI faces the arena center at spawn.

---

# 37. Win Condition

Defined in §3. `MatchManager` tracks alive characters and checks the end conditions after every elimination.

---

# 38. Match Reset

RESTART / PLAY AGAIN / MENU must:

- Dispose all AI characters (meshes, bodies, nameplates, particles).
- Dispose all magnetic objects and recreate them at their spawn list positions.
- Reset the player: position at spawn, velocity zero, stability 100, magnet power 100, repulse cooldown ready, nothing held.
- Reset the HUD, notifications, match timer and alive count.
- Create 10 new AI with shuffled spawn points (§36).
- Go to COUNTDOWN (or MENU for the MENU button).

After 5 consecutive restarts, the mesh count, physics body count and active particle system count must be the same as after the first match started (no leaks).

---

# 39. Initial MVP

The MVP is complete when Phases 1–12 in §40 are done and every item in §45 is checked. Phase 13 (optimization) is done after that. Nothing outside §40 is part of the MVP.

---

# 40. Development Phases

Do these phases in this order. Each phase ends with the verification loop in §1.1. Items marked **[human]** need the user to confirm by playing. Ask them instead of claiming success.

## PHASE 1 — Bootstrap and Scene
- Project bootstrap (§2.1), including deleting the old Candy Isle files.
- Smoke test and `window.__MM_DEBUG__` (§1.2). Until the menu exists, the state can start directly in PLAYING.
- Engine, scene, hemispheric + directional light with shadows, sky color.
- Central platform only. A static placeholder capsule for the player. `config.ts` created.

**Acceptance:** build and smoke test pass; platform and capsule visible; no console errors.

## PHASE 2 — Physics and Player Movement
- Havok initialized. Central platform static.
- Player `Character` with a dynamic capsule (§12), WASD movement, sprint, jump, gravity (§6).
- `PlayerController` writes `CharacterInput`.
- A few test crates to push around.

**Acceptance:** the player moves, sprints and jumps; the player can walk off the edge and fall; crates react to being bumped. **[human]** movement feels responsive.

## PHASE 3 — Third-Person Camera
- Orbit camera, pointer lock, context menu disabled, camera collision ray (§2.2, §7).

**Acceptance:** the camera follows smoothly; mouse rotates it; WASD is camera-relative; the camera does not go inside the platform or pillars. **[human]** sensitivity is comfortable.

## PHASE 4 — Attract
- `MagnetSystem` attract, hold point, magnet power (§8), range indicator (§11).
- A stationary dummy `Character` (no AI yet) to test pulling characters.

**Acceptance:** left click pulls crates and the dummy with no teleporting; objects hover at the hold point; only a ragdolled character can be pulled, and it is released when its ragdoll ends; magnet power drains and regenerates.

## PHASE 5 — Repulse
- Repulse, launch of held objects, cooldown, knockback control loss, stability (§9, §12, §24).
- Repulse particles, shockwave, camera shake. A placeholder repulse sound is fine here; §30 is finished in Phase 12.

**Acceptance:** right click launches held objects and knocks back the dummy; the cooldown blocks repeated use for 2.5 s; repulsing the dummy near the edge knocks it off the platform.

## PHASE 6 — Full Arena
- All pieces from §5 (base platforms, bridges, obstacles, 16 magnetic objects with respawn).
- `Platform` footprints for edge distance (§20).
- Elimination check at y = −10 (§29 steps 1, 6).

**Acceptance:** every platform can be reached on foot or by jumping; ramps can be climbed; objects respawn 5 s after falling; a falling character is detected and disposed.

## PHASE 7 — Match Flow
- State machine (§34), main menu with difficulty buttons, countdown (§35), spawn system (§36), end screens (§3), reset (§38). Test it with the player plus dummies.
- The smoke test now clicks PLAY (§1.2).

**Acceptance:** MENU → COUNTDOWN → PLAYING works; falling off shows GAME OVER; RESTART and MENU work with no page refresh; 5 restarts do not increase mesh/body counts.

## PHASE 8 — One AI
- `AIController`, `AITargeting`, `AIBehavior` (§16–23) for a single AI (Aggressive, NORMAL).

**Acceptance:** the AI moves, targets the player, attracts, repulses, retreats from edges, dodges sometimes, can knock the player off, and can be knocked off. In a 2-minute test it does not fall off on its own more than once. **[human]** it feels like an opponent, not a turret.

## PHASE 9 — Ten AI
- Spawn all 10 with personalities (§17) and the difficulty from the menu (§21). Staggered decision timers.

**Acceptance:** all 10 move and fight; the personalities are visibly different (Object Users throw objects, Defensive AI hang back); matches end with a winner; FPS stays around 60 (check `__MM_DEBUG__.fps`). In a match with the player standing still in the center, not all AI fall off within the first 30 s.

**Balance targets** (NORMAL, idle player, `?noend`, averaged over at least 3 headless runs using `__MM_DUMP__`): first AI-vs-AI elimination usually after about 8 s; last-AI-standing match length roughly 60–180 s; at most about 2 self-inflicted falls (`by: null`) per match; no velocity explosions (elimination speeds stay under the 30 u/s caps); no AI stands still; the personalities visibly differ.

## PHASE 10 — Procedural Animation
- Primitive character rig (§13) replacing the placeholder capsule visuals, and procedural animation states (§14).

**Acceptance:** each state is visible when its trigger happens; no snapping between states; MOVE speed matches movement speed; the player is clearly distinct from the AI.

## PHASE 11 — UI
- Full HUD (§26–27), nameplates (§28), elimination notifications (§29).

**Acceptance:** every HUD value updates correctly; opponent count drops on each elimination; the timer counts in mm:ss; readable at 1280×720 and 1920×1080.

## PHASE 12 — Audio
- `AudioManager` with all synthesized sounds (§30), replacing the Phase 5 placeholder.

**Acceptance:** each sound in §30 plays at the right moment; no audio errors in the console; impact sounds are rate-limited. **[human]** repulse is the most recognizable sound.

## PHASE 13 — Optimization
- Profile with the Babylon Inspector / browser performance tools. Check draw calls, active physics bodies, AI update time, and particle counts.
- Only optimize measured bottlenecks. Use instancing for repeated props, freeze static meshes (`freezeWorldMatrix`), and avoid per-frame allocations (reuse `Vector3` temporaries).

**Acceptance:** stable ~60 FPS during a full 11-character match on a normal laptop; no memory growth over 5 restarts.

---

# 41. AI Behavior Examples

The game should naturally produce situations such as:

### Example 1

AI pulls crate.

Crate hits another AI.

Second AI falls from the platform.

### Example 2

Player repulses AI.

AI flies backward.

AI hits a barrel.

Barrel knocks another AI.

### Example 3

Two AI fight over the same metal crate.

### Example 4

AI-03 notices AI-07 near the edge.

AI-03 moves behind AI-07.

AI-03 repulses AI-07.

AI-07 falls.

### Example 5

Player is near the edge.

Defensive AI backs away and waits for a safer attack.

These emergent physics interactions are the main entertainment mechanic.

---

# 42. Design Philosophy

The core experience should communicate:

> "I have a magnet. I need to knock everyone off."

Within approximately 10 seconds of starting, the player should be able to:

- Run
- Jump
- Pull something
- Push something
- Knock an AI around

The game should naturally create funny physics moments.

Prioritize:

```text
FUN GAMEPLAY
>
PHYSICS
>
READABILITY
>
RESPONSIVE CONTROLS
>
AI BEHAVIOR
>
ASSETS
>
UI POLISH
>
EXTRA FEATURES
```

---

# 43. What NOT to Build Initially

Do not add:

- Multiplayer
- Authentication
- Database
- Server backend
- Inventory
- Shop
- Battle pass
- Quests
- Large open world
- Complex progression
- Matchmaking
- Player accounts
- Chat
- Leaderboards
- Procedural generation

unless specifically requested after the MVP is stable.

---

# 44. Future Expansion Ideas

Only after the MVP is complete, and only when the user asks:

- Moving platforms
- External CC0 GLB characters and animations (e.g. Kenney), replacing the primitive rig
- Background music and dynamic music intensity
- Magnet upgrades (+10% strength, +10% range, −10% cooldown, +10% movement speed)
- More arenas
- Special magnetic objects
- Cosmetic skins / character customization
- Different magnet types
- More AI personalities
- Boss enemies, survival mode, time attack mode
- Destructible objects
- Daily challenges
- Procedurally generated arenas

---

# 45. Acceptance Criteria (MVP Checklist)

- [ ] `npm run build` and `npm run test:smoke` pass.
- [ ] Browser loads the game without console errors.
- [ ] Main menu with difficulty selection (default NORMAL) works.
- [ ] 3-2-1-GO countdown disables input and then enables it.
- [ ] Player can move with WASD (camera-relative), jump and sprint.
- [ ] Third-person camera follows, rotates with the mouse, and does not clip into platforms or pillars.
- [ ] Player can attract and hold objects, and AI only while they are ragdolled; a held AI is released when its ragdoll ends.
- [ ] A projectile hit ragdolls a character for 2 s: no control, can be attracted, about 2× knockback.
- [ ] Magnet power drains while attracting and regenerates.
- [ ] Player can repulse objects and AI; held objects are launched.
- [ ] Repulse has a 2.5 s cooldown shown in the HUD.
- [ ] Stability drops on hits, regenerates, and increases knockback.
- [ ] Players and AI can fall from the arena; falling below y = −10 eliminates them.
- [ ] Magnetic objects respawn 5 s after falling.
- [ ] 10 AI spawn every match, with shuffled spawns.
- [ ] AI move independently, select targets, attract, repulse, dodge, and use objects.
- [ ] AI respect edge zones but occasionally make mistakes.
- [ ] AI can eliminate one another and the player; the player can eliminate AI.
- [ ] The 5 personalities behave visibly differently.
- [ ] Opponent count, timer, stability, power and cooldown HUD update correctly.
- [ ] Nameplates and elimination notifications work.
- [ ] Player elimination shows GAME OVER immediately; eliminating all AI shows YOU WIN.
- [ ] RESTART, PLAY AGAIN and MENU work without a page refresh.
- [ ] Procedural animations work with no snapping.
- [ ] Synthesized sound effects play.
- [ ] ~60 FPS during a full match.
- [ ] No mesh/body/particle growth over 5 restarts.

---

# 46. Coding-Agent Behavior

1. Inspect the existing project before changing files.
2. Do not overwrite unrelated user code. The only files that may be deleted are the old Candy Isle files listed in §2.1.
3. Implement one phase at a time and run the verification loop (§1.1) after each.
4. Explain the purpose of major changes briefly.
5. Do not claim a feature works unless it has been tested. For **[human]** criteria, ask the user.
6. Do not create fake implementations that only look functional.
7. If this document is unclear or contradicts itself on something that affects gameplay, ask the user instead of guessing.
8. Put every tunable number in `config.ts`. No magic numbers in gameplay code.
9. Use clear TypeScript types. `strict` mode on.
10. Dispose Babylon.js resources correctly (meshes, materials, bodies, particle systems, GUI controls, observers).
11. Avoid per-frame allocations in hot paths. Reuse temporary vectors.
12. Keep AI deterministic enough to debug: route all AI randomness through one seedable RNG in `config.ts`/a util, so a seed can reproduce a match.

---

# 47. Final Target

The finished first version should feel like:

> **Roblox + Gang Beasts + magnetic physics**

It should be immediately understandable, chaotic, replayable, and lightweight enough to run directly in a browser.

The most important feature is not the number of systems.

The most important feature is:

> **Does knocking an AI off the arena with a magnet feel satisfying?**

Build everything around making that interaction responsive, readable, funny, and reliable.
