# Arena Expansion — Design

Date: 2026-09-29
Status: approved in chat, awaiting spec review

## Goal

Make the Magnet Mayhem arena bigger and richer, with surface texture, more varied terrain and more props, while it still plays as the same fast, readable knock-off game.

**Success criteria**
- About 1.5× the current footprint (from 60×60 to about 82×82), with new areas that are worth fighting over.
- Matches still last roughly 60–180 s (Phase 9 balance targets, NORMAL, idle player, `?noend`, at least 3 headless runs), with at most about 2 self-inflicted falls per match.
- Still about 60 FPS on the dev machine (M4, 2560×1440 CSS, DPR 2 capped to 1.5).
- Still no external asset files (AGENTS.md §15). All textures are generated at runtime.
- Edges stay obvious at a glance.

**Out of scope:** moving platforms, destructible objects, external textures or models, new game modes.

## 1. Layout

Coordinates follow the existing convention (N = −Z, E = +X). The top surface of every base platform is at y = 0, and elimination stays at y = −10.

```
            (NW)──────[ N ]──────(NE)          ── ring catwalk, 2.5 wide
              \         |         /            |  spoke bridge, 3 wide
               \        |        /             ( ) diagonal island, circle r 7
    [ W ]──────────( HUB r20 )──────────[ E ]  [ ] cardinal platform, 14×14
               /        |        \             pads on the hub rim face each diagonal island
              /         |         \
            (SW)──────[ S ]──────(SE)
```

| Piece | Shape | Size | Center |
|---|---|---|---|
| Hub | cylinder | r 20, thickness 2 | (0, −1, 0) |
| Cardinal platforms N/S/E/W | box | 14 × 2 × 14 | distance 34 on each axis |
| Diagonal islands NE/SE/SW/NW | cylinder | r 7, thickness 2 | (±24, ±24) |
| Spoke bridges (4) | box | 3 wide, 1 thick | hub rim (r 20) → cardinal inner edge (27), along the axes |
| Ring catwalks (8) | box, rotated | 2.5 wide, 1 thick | each cardinal ↔ its two neighbouring diagonal islands, along the line between their centers, clipped to both footprints (about 11.4 long) |

- Every bridge and catwalk overlaps both platforms by 0.5 at each end. Its top sits `ARENA.bridgeTopOffset` below y = 0, as today.
- Diagonal islands are reached **only** through ring catwalks or bounce pads (§3). They are the remote, risky areas.

All sizes live in `config.ts` (`ARENA`). The layout itself (which platforms exist and which pairs a walkway links) is data in a new `src/arena/ArenaLayout.ts`.

## 2. Gameplay terrain (static physics)

The hub has point symmetry: (x, z) and (−x, −z) mirror each other.

| Piece | Size | Center (x, z) | Notes |
|---|---|---|---|
| Raised block A | 6 × 2 × 6 | (9, −4) | ramp A on its west side, rising from x = 2 to x = 6 (ramp center (4, −4)) |
| Raised block B | 6 × 2 × 6 | (−9, 4) | ramp B on its east side, rising from x = −2 to x = −6 (ramp center (−4, 4)) |
| Pillars ×4 | cylinder r 1, h 5 | (11, 7), (−11, −7), (4, 14), (−4, −14) | |
| Cover walls ×2 | 0.6 × 1.2 × 4, along z | (14, 3.5), (−14, −3.5) | low: jumpable, stops rolling props |
| Guard walls E/W | 0.5 × 1.2 × 8 | (±40.5, 0) | outer edge of E and W (today's low walls, scaled up) |
| Guard rails N/S | 0.5 × 1.2 × 3, two per platform | outer corners of N and S | middle left open |

Diagonal island themes:

| Island | Terrain (static) | Dressing (visual) |
|---|---|---|
| NE, crystal garden | 1 large hexagonal crystal (hex-prism collider, h 3) | small crystal clusters near the rim |
| SE, scrapyard | 2 scrap piles (box colliders, about 1.5 high) | loose bolts and pipes |
| SW, grove | 3 trees: trunk colliders (cylinder r 0.4, h 2.5) | low-poly canopies (no collider) |
| NW, lookout tower | 3 × 3 × 3 tower with 3 box steps (1 unit each) on its hub-facing side | flag on top |

- Each of these static pieces is registered as an obstacle, so AI wander and flank points avoid it (`Arena.isObstructed`).
- **Positions are checked by a test (§9):** spawns ≥ 2 from any obstacle and ≥ 4 apart, objects not inside any collider, and pads keep a 1.5-unit clear zone. If the test fails, positions are nudged in config.

## 3. Bounce pads

- Four pads on the hub rim, one on each diagonal at radius 17: (±12, ±12). Each faces the island behind it.
- **Shape:** a static cylinder, r 1.2 and h 0.2. It counts as ground and camera-blocking, with a glowing top and an arrow texture pointing at the target island.
- **Trigger:** each frame, a live character whose feet are inside the pad radius and within 0.6 above the pad top is launched. Magnetic objects are launched the same way. Each body has a per-pad cooldown of 0.6 s.
- **Launch:**
  - The body's velocity is **set** to `(ĥx · v_h, v_y, ĥz · v_h)`, where ĥ is the horizontal unit vector from the pad to the target island's center.
  - `v_y = 14`, which gives a flight time of `t = 2·v_y / |g| = 1.4 s`.
  - `v_h = D / t`, where D is the horizontal distance from the pad to the island center (about 17, so v_h ≈ 12.1). It is computed once at load time, so every launch lands mid-island.
- **Characters in flight:** movement control drops to 30% for the flight time, reusing the knockback control timer. A launch is **not** a hit: no stability loss and no elimination credit. Any earlier hit credit is kept as-is.
- **Feedback:** a small particle burst, a synthesized "boing" in `AudioManager`, and the pad top pulses.
- **AI:** pads count as obstacles for wander and flank points and are never a steering destination. AI can still be knocked onto one, or run over one by accident. That is intended, and it is tracked in the playtests (§8).

New file `src/arena/BouncePads.ts`, with its values in `config.ts` (`BOUNCE`).

## 4. Magnetic props

The count goes from 16 to **24**. The fixed spawn list stays in `ArenaObjects.ts`:

| Kind | Count | Shape / size | Mass | Notes |
|---|---|---|---|---|
| Crate | 8 | box 1 | 2 | existing |
| Barrel | 5 | cylinder 0.8 × 1.2 | 1.5 | existing |
| Ball | 4 | sphere 1 | 1 | existing |
| Large block | 2 | box 2 | 6 | existing, heavy |
| **Anvil** (new) | 2 | box collider 1.2 × 0.8 × 0.8 (anvil-shaped visual) | 10 | heavy (repulse gives 50%), dark iron look |
| **Spring ball** (new) | 3 | sphere 0.9 | 0.8 | restitution 0.9, striped; ricochets |

Distribution:

| Area | Props |
|---|---|
| Hub | 10 |
| Cardinal platforms | 2 each (8) |
| SE scrapyard | 3 |
| NE, SW, NW islands | 1 each |

Respawn (5 s), the speed cap (`OBJECTS.maxSpeed`) and hit rules are unchanged. New kinds only add rows to `KIND_SPECS`.

## 5. Procedural textures

New file `src/arena/ArenaTextures.ts`:
- Each texture is drawn **once** on a 256×256 canvas (`DynamicTexture`), in **grayscale**, with wrap on.
- Materials keep today's colors. The texture only multiplies them (StandardMaterial `diffuseTexture` × `diffuseColor`), so the palette and readability do not change.

| Surface | Texture | Tiling |
|---|---|---|
| Hub top | stone tiles with grout lines | 1 tile ≈ 2 units |
| Cardinal tops | large court plates with a subtle bevel | 1 plate ≈ 3.5 units |
| Diagonal island tops | turf noise, speckled | about 3 units |
| Bridges and catwalks | wood planks running across the walkway | 1 plank ≈ 0.5 units |
| Platform sides | rock strata | about 4 units |
| Blocks, walls, tower | panel / brick | about 2 units |
| Magnetic props | riveted metal plate | 1 per face |

- **Edge trim:** a flat hazard-stripe band (yellow and black, 0.5 wide) runs around every base-platform rim, 2 cm above the top so it never z-fights.
  - It is visual only: not pickable, no collider, no ground tag.
  - Circle rims use a ring ribbon, box rims use four strips.
  - The band is cut where a bridge or catwalk meets the rim, so the entrances read as safe.
- The total is 7 textures of 256×256 plus 1 stripe texture. All of them are shared and disposed in `Arena.dispose()`.

## 6. Island dressing (visual only)

New file `src/arena/ArenaDecor.ts`. Nothing here has physics, a `ground` tag, `cameraBlock`, or is pickable. Nothing here casts shadows except the tree canopies.

- **Rocky undersides:** an inverted, flat-shaded low-poly rock under every base platform, 6–10 deep, with slightly jittered vertices and brown/grey colors. One mesh per platform (9).
- **Grass tufts:** small cone clusters on the islands and cardinal edges, one thin-instanced mesh.
- **Crystals, bolts, pipes, canopies, flag:** thin instances per kind.
- **Floating rocks:** about 12 thin instances at r 55–95, y −20…+10. Their matrices bob slowly each frame (12 matrix writes, no allocation).
- **Clouds:** the existing `Game.buildClouds` moves into `ArenaDecor`, pushed out to r 60–110 to match the bigger arena.

## 7. AI and edge awareness

**`Platform` becomes generic.**
- Kinds: `hub | cardinal | island | bridge`.
- Bridges store a center, a unit axis (any direction), a half-length and a half-width. Edge distance on a bridge uses local coordinates along and across its axis.
- `edgeInfo`, `outwardDir` and `clampToPlatform` work for circles, rectangles and rotated walkways.
- `inBridgeCorridor` becomes generic: the point lies in any bridge's footprint extended 2.5 along its axis (width minus 0.3).

**Zones.**
- Hub: central thresholds (7 / 3).
- Cardinal platforms and islands: outer thresholds. `AI.outerSafeEdge` becomes 3.5 (it only fit 10×10 before); `outerDangerEdge` stays 1.5.
- Bridges: always WARNING.

**Routing (`Arena.nextWaypoint`).**
- A graph with 9 platform nodes and 12 walkway edges. A next-hop table is built once at load with Dijkstra, using the distances between centers.
- Every walkway has an entry point 1.5 inside each end platform, on its axis.
- On platform P, heading to T: go to the entry point of `nextHop[P][T]`. Once aligned with the walkway (sideways offset < 0.8 and near the entry), head to the far entry point.
- On a walkway: go to the end whose platform is closer to T in the graph.
- A target over the void is clamped to a platform first, as today.

**Per-frame edge guard.** On a walkway, the sideways part of the steering (across the walkway's own axis) is replaced by a pull back to its centerline. This replaces the "bridges lie on the x/z axes" code in `AIController.guardEdges`.

**Retreat.**
- Hub: radially inward to `AI.retreatRadius` (5 → 7).
- Other platform in DANGER: toward its center.
- On a walkway: toward the center of the nearer end platform. It never heads for (0, 0), which would lead off a catwalk sideways.
- Nothing below: toward the nearest platform point.

**Scale-ups.**

| Setting | Now | New |
|---|---|---|
| `AI.perceptionRadius` | 20 | 26 |
| `AI.wanderRadius` | 10 | 14 |
| `AI.retreatRadius` | 5 | 7 |

Other AI numbers only change if the balance runs require it.

## 8. Spawns and balance

Spawns (`SPAWN.points`), 7 on the hub and 4 on the cardinal centers:
- **Hub:** (−0.5, 16) for the player, (0.5, −16), (−16, 0.5), (16, −0.5), (−4, −5), (4, 5), (−7, −1)
- **Cardinals:** (0, −34), (0, 34), (34, 0), (−34, 0)

The menu orbit camera radius and the shadow settings are rechecked for the bigger footprint. Only large arena pieces and characters cast shadows.

**Balance loop.**
- Add `tests/playtest.spec.ts`, which runs only when `PLAYTEST=1` is set. It runs 3 matches (NORMAL, idle player, `?noend`) and prints the `__MM_DUMP__` summaries:
  - time of the first elimination
  - match length
  - number of `by: null` falls
  - maximum elimination speed
  - number of pad launches
- Adjust config until the Phase 9 targets hold again.

## 9. Testing

- `npm run build` and `npm run test:smoke` after each implementation stage.
- Existing specs move to the new coordinates. `tests/helpers.ts` gets named test sites (for example, the E cardinal center) and object lookup by kind instead of hard-coded indices. Hub and cardinal tests keep their intent.
- New `tests/arena.spec.ts`:
  1. **Routing:** from each platform's center to every other one, following `nextWaypoint` reaches the target within 8 hops, and every segment midpoint lies over a platform or walkway.
  2. **Clearance:** spawns are ≥ 2 from obstacles and ≥ 4 apart, objects spawn inside a platform and not inside a collider, and pads have 1.5 units clear.
  3. **Bounce pads:** a player teleported onto each pad lands, alive and grounded, on its target island within 2.5 s. A crate on a pad is launched too.
  4. **Reach on foot:** walking the player along a route (input override) from the hub to a diagonal island arrives without falling.
- `leak.spec.ts` (5 restarts, no growth) must still pass. Decor and textures are built once per arena, not per match.
- **Performance:** headed Chromium at 2560×1440, DPR 2, a full 11-character match, reading `__MM_DEBUG__.fps`, draw calls and active meshes. If draw calls blow the budget, static meshes that share a material get merged.
- **[human]:** the look (texture scale, hazard trim, dressing density), whether the pads are fun, and whether the arena reads well at a glance.

## 10. Files

| File | Change |
|---|---|
| `src/arena/ArenaLayout.ts` | new: platforms, walkways, terrain, pads, island themes as data |
| `src/arena/Arena.ts` | builds from layout; generic edge/routing queries; stays under 400 lines |
| `src/arena/ArenaTextures.ts` | new: procedural textures and edge trim |
| `src/arena/ArenaDecor.ts` | new: undersides, tufts, crystals, trees, floating rocks, clouds |
| `src/arena/BouncePads.ts` | new |
| `src/arena/ArenaObjects.ts` | new kinds, 24 spawns |
| `src/ai/AIController.ts`, `AITargeting.ts`, `AIBehavior.ts` | generic bridges, retreat, zones for islands |
| `src/audio/AudioManager.ts` | bounce sound |
| `src/game/Game.ts` | wires pads and decor; clouds removed |
| `src/game/DebugHooks.ts` | exposes routing and pad data for tests |
| `src/config.ts` | `ARENA`, `SPAWN`, `BOUNCE`, `DECOR`, `TEXTURES`, `AI` updates |
| `tests/*` | coordinates updated; `arena.spec.ts` and `playtest.spec.ts` added |
| `AGENTS.md` | §4, §5, §8.1 / §11 / §22 synced to the current config (attract range 10.5, pull 1 s / regrab 3 s, lowStability 30), §15, §18, §20, §23, §33, §36, §45 |

## 11. Implementation stages

Each stage ends with the build, the smoke test and the relevant specs passing.

1. Layout data, bigger geometry, generic edge info and routing, updated tests. The AI plays correctly on the new map.
2. Hub terrain and island themes.
3. Bounce pads.
4. New magnetic props and 24 spawns.
5. Procedural textures and edge trim.
6. Island dressing.
7. Balance playtests, performance check, AGENTS.md update.
