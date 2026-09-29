# task.md — Magnet Mayhem progress board

Single source of truth for who is doing what. **Read this before starting any work. Claim a task before you start it. Update it when you finish.** Roadmap/spec: `AGENTS.md`.

## Rules (all agents)

1. Before starting a task, check the **Tasks** table. If it is `IN PROGRESS` by someone else, do not start it. Pick another or report back.
2. To claim: set Status to `IN PROGRESS` and Owner to your role. To finish: set `DONE` (or `BLOCKED: reason`) and add a one-line note.
3. Edit **only your own rows** with a small exact-match Edit (never rewrite the whole file). Other agents edit it at the same time.
4. Stay inside your file ownership and your port/build folder (below). If you need a change in a file someone else owns, add a row with Status `REQUEST → <owner>` instead of editing it.
5. Ambiguities in AGENTS.md that affect gameplay: add them to **Open questions for the user**. Do not guess.

## Agents, ownership, ports

| Role | Owns (may edit) | Build dir | Port |
|---|---|---|---|
| Orchestrator (main) | `task.md`, launching agents | — | — |
| Coder | `src/**` (except `src/game/DebugHooks.ts`), `index.html`, `src/ui/style.css`, `AGENTS.md` value sync, `ASSET_LICENSES.md` | `dist-dev/` | 4174 |
| Test writer | `tests/**`, `playwright.config.ts`, `src/game/DebugHooks.ts`, minimal hook-up lines in `Game.ts` | `dist/` | 4173 |
| Reviewer | read-only | — | — |
| Visual QA | read-only (scratchpad `qa/`) | scratchpad `qa/dist` | 4176 |
| Performance | read-only (scratchpad `perf/`) | scratchpad `perf/dist` | 4175 |
| Finalizer | integration fixes after all others finish | `dist/` | 4173 |

## Tasks

| # | Task | AGENTS.md | Owner | Status | Notes |
|---|---|---|---|---|---|
| 1 | Phases 1–12 base implementation | §40 | Orchestrator | DONE | All systems built; tsc passes |
| 2 | Balance tuning (first AI elim ≥ ~8 s, match 60–180 s, ≤ 2 self-falls) | §9, §20, §24, Phase 8–9 | Coder | DONE | NORMAL idle player, 4 sequential 60-fps runs: match 93/123/96/94 s (avg 101), first elim avg 6.8 s (4.4–9.5), 0 self-falls, ≥2 AI alive at 30 s in every run. Was: 55 s / 4.7 s. AI repulse rest+opening delay, attract chance, per-platform edge zones, edge guard, stability factor 0.35 |
| 3 | UI fixes: countdown readability, "CLICK TO AIM" overlap, washed-out central platform | §27, §31, §35 | Coder | DONE | gold fill + 12px ink stroke, pop starts at 0.6 opacity; #lock-hint top 72%; central #2466c4, ARENA.emissiveFactor 0.1 |
| 4 | `ASSET_LICENSES.md` | §15 | Coder | DONE | required §15 sentence + per-category notes, npm library licenses, table for future assets |
| 5 | Sync tuned values back into AGENTS.md | §33, §46.8 | Coder | DONE | AGENTS.md §1.2, §2.2, §5.1, §8.1, §9, §10–13, §19–24, §26, §29, §31–35, Phase 9 balance targets |
| 6 | Code review (ranked findings) | all | Reviewer | DONE | 14 findings; filtered list sent to Coder as tasks 7–15 |
| 7 | CRITICAL: shared particle texture disposed after first burst | §10, §29 | Coder | DONE | disposeOnStop=false; onAnimationEnd → dispose(false) after render; clear() uses dispose(false). magnet+leak specs pass |
| 8 | Repulse while holding attract (chorded mouse buttons) | §6, §9 | Coder | DONE | mousedown/mouseup per button |
| 9 | AI flank point off bridge into void | §23 | Coder | DONE | bridge targets flanked along the axis; flank points with edge distance < 3 rejected; nextWaypoint clamps void destinations onto a platform |
| 10 | Edge zones too large for outer platforms / retreat reversal | §20 | Coder | DONE | outer platforms use 1.5/3 thresholds; WARNING roll only when moving outward and not crossing platforms; per-frame edge guard + bridge centerline; §20 updated |
| 11 | Camera ray fastCheck returns far hit (clips pillars) | §7 | Coder | DONE | fastCheck=false |
| 12 | Sliding after match end + eliminations on end screens | §3, §34 | Coder | DONE | grounded characters without control brake (not while pulled/held); notification+sound only while PLAYING |
| 13 | Wander point inside obstacles → stuck | §23 | Coder | DONE | Arena.isObstructed rejects block/pillar points; stuck-jump re-picks the wander point |
| 14 | Hot-path allocations / CONTINUED collision events | §32, §46.11 | Coder | DONE | only COLLISION_STARTED plays impacts; __MM_DEBUG__ 4 Hz (+ on elimination/state change); prune 1 Hz; audio ring buffer; reused effects view object |
| 15 | maxFrameDt vs Havok step clamp mismatch | §12 | Coder | DONE | WORLD.maxFrameDt = 0.1 (Babylon PhysicsEngine clamp) |
| 16 | Test debug API `window.__MM_TEST__` (`?test`) | §1.2 | Test writer | DONE | src/game/DebugHooks.ts; installed via 1 import + 1 call at end of Game constructor; inert without `?test` (smoke asserts it). |
| 17 | Playwright suite: flow, movement, magnet, elimination, AI, leak, smoke | §45 | Test writer | DONE | 25 tests: 21 pass, 4 fail on real bugs (#7 texture ×3: leak, particle texture, burst self-dispose; #24 re-capture ×1). `npm test` = full (Metal GL, 2 workers, ~3 min); `npm run test:smoke` = smoke; `MM_GL=swiftshader` fallback. |
| 18 | Visual/UI audit at 1280×720 + 1920×1080 | §3, §10–14, §26–31 | Visual QA | DONE | 12 items; particle fix (#7) verified in current src; defects → rows 25–34 |
| 19 | Performance profile, leak table, bundle import plan | Phase 13, §32, §38 | Performance | DONE | headless Chromium on an Apple M4 with Metal (not a normal laptop): 11 alive for 65 s gives avg 59.9 FPS, min 53 (a single 83 ms hitch), p5 60; CPU ~3.3 ms/frame; uncapped 201–565 FPS. Leak test: PASS (identical meshes 203, bodies 46, particles 1, nameplates 11 across 20 restarts plus 2 MENU cycles; heap levels off at ~26 MB). Requests → 36–38 |
| 20 | Apply QA + perf findings | Phase 13 | Coder | DONE | QA/perf findings applied as rows 25–38. Skipped: optional edgeInfo out-param; nit #10 (last notification hidden with HUD on end screens) |
| 21 | Bundle size: deep imports instead of package roots | Phase 13 | Coder | DONE | all src on deep imports (+5 side-effect imports in main.ts); main chunk 1.47 MB; full suite 31/31 pass |
| 22 | Final integration: build, full Playwright suite, playtest, §45 checklist | §1.1, §45 | Finalizer | DONE | Build OK (tsc 0 errors, main 1.47 MB); full suite 31/31 ×4 (2 runs on the 0.35 build, 2 on the 0.6 build), smoke passes; 5 sequential GPU playtests (extraKnockback 0.6); §45 = 21 PASS, 1 FAIL (held-AI 0.5 s vs 1.5 s), 4 HUMAN; defects → rows 40–42 |
| 23 | Human checks: movement feel, sensitivity, repulse sound, fun | §40 [human] | User | TODO | asked at the end |
| 24 | Held object re-captured by the thrower right after repulse-launch while attract is still held | §5, §9, §19 | Coder | DONE | Fixed: ATTRACT.objectRegrabLockout 0.75 s (launcher's magnet ignores the launched object); magnet spec passes. Original report: MagnetSystem.update step 2 re-pulls/captures the launched object next frame (objects have no regrab lockout, unlike characters' `regrabLockUntil`). Repro: `tests/magnet.spec.ts` "repulse launches a held crate while attract is still held". Crate goes −30 u/s then is back at the hold point in ~5 frames. Likely also affects AI object combos (AIController.useObject/attack keep attract on toward the target; untested). Becomes player-visible once #8 (chorded buttons) is fixed. |
| 25 | CRITICAL: real mouse input dead after mousedown change (canvas never gets mousedown) | §6, §8, §9 | Coder | DONE | pointerdown/pointerup/pointermove with `e.buttons` diff; camera rotation moved to pointermove too. Verified with page.mouse + stubbed pointer lock: lock click no action, LMB attracts, LMB+RMB chord repulses, plain RMB repulses |
| 26 | Attract cone invisible + attract particle stream too faint | §10, §11 | Coder | DONE | sector #ffd23f at ≤0.15 alpha; attract particles 0.25–0.45, brighter, emit box ±3.5 |
| 27 | Bridge z-fighting stripes | §31 | Coder | DONE | bridge tops 0.01 below y=0 (ARENA.bridgeTopOffset) |
| 28 | End-screen title white on white card | §3 | Coder | DONE | #end-title gold (win) / red (lose) |
| 29 | Menu card hides the central arena | §34 | Coder | DONE | menu card left-aligned; menu camera pans (CAMERA.menuPan 13) so the arena shows on the right |
| 30 | Countdown covers player head | §35 | Coder | DONE | #countdown top 24% |
| 31 | "GO!" lingers over GAME OVER if match ends < 0.5 s after GO | §35 | Coder | DONE | hideCountdown() on PLAYER_ELIMINATED/VICTORY/MENU |
| 32 | Player outline faint at distance | §13 | Coder | DONE | CHARACTER.playerOutlineWidth 0.06 |
| 33 | Cooldown shows "0.0s" for one frame | §26 | Coder | DONE | ceil to 0.1 |
| 34 | Low-contrast "CLICK TO AIM" hint | §27 | Coder | DONE | dark pill background |
| 35 | Real-mouse input test (tests/input.spec.ts, page.mouse, no __MM_TEST__ input) | §6, §45 | Test writer | DONE | 6 tests (pointer lock stubbed via init script): 1 pass (e: W + mouse-look), 5 fail (a,b,c1,c2,d) for the right reason: canvas gets pointerdown/up but 0 mousedown/mouseup (Babylon preventDefaults pointerdown), and a chorded right press emits no pointerdown at all → needs pointermove `buttons` diff (#25). Full suite: 26 pass / 5 fail (only these). |
| 36 | Perf: only torso/head/legL/legR cast shadows (CharacterVisual.ts ~142–144 `addShadowCaster` loop) | Phase 13, §32 | Coder | DONE | SHADOW_CASTERS = torsoMesh/head/legL/legR only |
| 37 | Perf: ground check tests a cached list of `metadata.ground` meshes (bounding sphere, then `mesh.intersects(ray, true)`) instead of `scene.pickWithRay` over ~200 meshes (Character.ts ~166–172) | Phase 13, §32, §46.11 | Coder | DONE | new src/character/GroundQuery.ts: cached ground-mesh list (dirty on mesh add/remove), world bounding-sphere reject, then ray.intersectsMesh(fast); movement+magnet specs pass |
| 38 | Deep-import mapping for #21 (tested build: main chunk 7.36 MB → 1.47 MB, gzip 1.58 MB → 345 KB, menu ready 449 → 233 ms, no console errors, same rendering) | Phase 13 | Coder | DONE | applied via #21 |
| 39 | Cleanup: remove dist-dev/, add dist-dev to .gitignore | §33 | Finalizer | DONE | .gitignore = node_modules, dist, dist-dev, test-results, playwright-report |
| 40 | AI stand still > 2 s (§16): 2–5 cases per match, max 5.1 s. Cause A: USE_OBJECT within 5 u of its object does not move while the opening attract delay (1.5–3.5 s) runs. Cause B: low-stability RETREAT (stability < 40) in SAFE on the central platform steers to its own position once inside retreatRadius 5, so moveDir = 0; on EASY reactionDelay 500 ms > decisionInterval 400 ms resets the pending ATTACK. | §16, §23 | Coder | IN PROGRESS | Suggested fix: strafe/circle when a retreat or use-object steer target is reached |
| 41 | Held character released after 0.5 s (`ATTRACT.characterPullTime` 0.5 = pull + hold), spec §8.1.4 / §45 says 1.5 s | §8.1 | User | DONE | User: keep 0.5 s; Coder documents it in AGENTS.md §8.1/§45 |
| 42 | HARD match length 40.8 s (< 60 s target); NORMAL 62.9/100.3/71 s (avg 78) with extraKnockback 0.6 | Phase 9 | User | DONE | User: leave HARD as is |
| 43 | Final re-verification after other-session changes: build, full suite (update tests that assume old values, e.g. 2 s cooldown), smoke | §1.1, §45 | Finalizer | BLOCKED: src changing under row 44 (arena expansion, 15:01–15:04) | waits until other sessions editing the project are idle |
| 44 | ARENA EXPANSION stage 1: layout data, bigger geometry, generic edge/routing, AI changes, hub terrain, spawns | spec §1, §2 (hub), §7, §8 | Orchestrator | DONE | commit 4f5da36; build + smoke pass; fix: idle AI on walkways step off along the axis (was strafing off sideways) |
| 45 | Arena tests: helpers/specs to new coords, DebugHooks arena/route, arena.spec, playtest.spec | spec §9 | Test writer | DONE | __MM_TEST__.arena()/edgeInfo()/isObstructed()/route(); helpers SITES/VOID_*/findObject/freeSpots/clearPlatformObjects; all specs on new coords, no hard-coded object indices; new arena.spec (6) + playtest.spec (PLAYTEST=1). 38 pass / 1 skipped on main d9bbbc4, 38/1 on arena-integ 9592a7e; balance → row 53 |
| 53 | Balance on the 1.5× arena: 3 playtests (4f5da36, NORMAL, idle player, `?noend`) never finished in 240 s (2/4/5 left); first AI elim 9.7/30.7/17.7 s; 0 self-falls; max elim speed 11. Odd pattern: nearly every AI elim is behavior RETREAT at exactly 11.0 u/s (sprint) with last ground point deep in the hub (r 6–11), often 3 at once by one attacker (AI-04 17.7–17.9 s, AI-10 23.9–24.1 s): check retreat steering while airborne/knocked and clustering at retreatRadius. Repro: `PLAYTEST=1 npx playwright test tests/playtest.spec.ts` | Phase 9, spec §8 | Test writer | REQUEST → Orchestrator | for row 52 balance loop |
| 46 | Stage 2: island themes (NE crystal, SE scrap, SW grove, NW tower + stairs) | spec §2 | Coder A | IN PROGRESS | worktree; also does row 50 |
| 47 | Stage 3: bounce pads + boing sound | spec §3 | Coder B | DONE | branch commit 7444fdf; all 4 pads land within 0.2 of island center; merge WAITS for the ragdoll session to commit (touches Character.ts/Game.ts) |
| 48 | Stage 4: anvil + spring ball, 24 object spawns | spec §4 | Coder C | DONE | f360849 merged into main (d9bbbc4) |
| 49 | Stage 5: procedural textures + hazard edge trim | spec §5 | Coder D | IN PROGRESS | worktree from main d9bbbc4, port 4184 |
| 50 | Stage 6: island dressing (undersides, tufts, floating rocks, clouds move) | spec §6 | Coder A | IN PROGRESS | with row 46, port 4181 |
| 51 | Review of stages 1–6 | all | Reviewer | TODO | after 46–50 |
| 52 | Stage 7: integrate, full suite, balance playtests, 5K perf, AGENTS.md sync | spec §8, §9, §11 | Finalizer | TODO | after 51 |

## §45 MVP checklist (Finalizer fills with evidence)

| Item | Status | Evidence |
|---|---|---|
| `npm run build` and `npm run test:smoke` pass | PASS | tsc 0 errors; main chunk 1,468.10 kB (gzip 350.57), Havok wasm 2,094.56 kB (gzip 669); smoke.spec passes (final build: 11 alive, 60 fps, 203 meshes, 46 bodies) |
| No console errors on load | PASS | 0 console/page errors in 4 full-suite runs (31/31 each), 5 playtests, screenshot and probe scripts |
| Main menu + difficulty (default NORMAL) | PASS | flow.spec "difficulty selection sticks across matches" (default NORMAL asserted); scratchpad/final/1280x720-1-menu.png |
| 3-2-1-GO disables then enables input | PASS | flow.spec "menu → countdown 3-2-1-GO! with input disabled → PLAYING" (sequence 3,2,1,GO!; no movement/attract during countdown); final/*-2-countdown.png |
| WASD camera-relative, jump, sprint | PASS (feel HUMAN) | movement.spec ×3 (jump peak y 1→2.58, sprint > walk); input.spec (e) W moves along camera forward (>0.9) |
| Camera follows, rotates, no clipping | HUMAN | input.spec (e) mouse turns the camera; follow visible in all play screenshots; no automated clipping test (fastCheck=false fix #11 in code) |
| Attract + hold objects and AI; held AI released after 0.5 s (user decision, was 1.5 s) | PASS | magnet.spec attract/hold; release measured 150–480 ms (≤ 0.5 s pull+hold cap); regrab lockout 1017 ms |
| Magnet power drains and regenerates | PASS | magnet.spec "magnet power drains while attracting, empties, and regenerates"; input.spec (a) |
| Repulse objects and AI; held objects launched | PASS | magnet.spec "repulse pushes an AI and a crate away…", "repulse launches a held crate" ×2; input.spec (b), (c1), (c2) |
| 2 s repulse cooldown in HUD | PASS | magnet.spec: HUD 2.0s → 0.1s → READY, wall-clock 2.00 s; final/*-5-repulse-cooldown.png |
| Stability drops, regenerates, increases knockback | PASS | measured 100 → 75.5 on a repulse hit, then +1/s (current §24 value); multiplier `1 + 0.6 × (100 − s)/100` in Character.ts:137, 0.6 confirmed in built bundle (by code, not measured) |
| Falling below y = −10 eliminates | PASS | elimination.spec "just above the plane is not eliminated; below it is", "an AI that falls off… cleaned up" |
| Objects respawn 5 s after falling | PASS | elimination.spec "magnetic objects that fall off are disposed and respawn" |
| 10 AI spawn with shuffled spawns | PASS | flow.spec 10 AI + aliveCount 11; measured restart: player fixed at (−0.5, 10), 8/10 AI on a different spawn in match 2, 10 distinct points |
| AI move, target, attract, repulse, dodge, use objects | PASS | ai.spec (all 10 travel 11–45 u, all attract + repulse, behaviors USE_OBJECT/ATTACK/DODGE/WANDER/RETREAT, 45 target pairs). Note: 2–5 AI stand still > 2 s per match (§16), see row 40 |
| AI respect edges but sometimes make mistakes | PASS | 5 playtests: 0–1 self-falls per match (NORMAL 1/0/0, EASY 0, HARD 0) |
| AI eliminate each other and the player; player can eliminate AI | PASS | playtests: AI-vs-AI eliminations every match, idle player knocked off at 7.2–30.6 s; magnet.spec "repulse can knock an AI off a platform, which eliminates it" |
| 5 personalities visibly different | HUMAN | behavior samples: Object User USE_OBJECT 24 (EASY) / 17 (HARD) vs 0–5 for the others; Pusher 0 USE_OBJECT |
| HUD values update correctly | PASS | elimination.spec "opponents-left counts down"; flow.spec match timer leaves 00:00; magnet.spec cooldown HUD; power bar drop visible in final/*-4-attract-hold.png |
| Nameplates + elimination notifications | PASS | elimination.spec "…eliminated, counted, announced and cleaned up"; 11 nameplates at start (smoke debug); screenshots |
| GAME OVER immediately / YOU WIN | PASS | flow.spec "player elimination → GAME OVER", "eliminating all AI → YOU WIN"; elimination.spec "player falling… GAME OVER"; final/*-6-gameover.png, *-7-victory.png |
| RESTART, PLAY AGAIN, MENU without refresh | PASS | flow.spec "…RESTART without reload", "…YOU WIN → PLAY AGAIN, then MENU" |
| Procedural animations, no snapping | HUMAN | knockback flail and raised magnet arm visible in final/*-5-repulse-b.png; snapping not checkable in stills |
| Synthesized sounds play | HUMAN | no audio errors in any run; headless runs cannot judge sound |
| ~60 FPS during a full match | PASS (M4 headless Metal; laptop HUMAN) | rAF-measured: NORMAL avg 60/60/60 (min 60/60/59), EASY avg 59.9 (min 54), HARD avg 59.0 (min 43, 3 s < 55) |
| No mesh/body/particle growth over 5 restarts | PASS | leak.spec: restart 5 = meshes 203, bodies 46, particle systems 1, nameplates 11 (= first match) |

## Open questions for the user

- 2026-09-29: another session is implementing a "ragdoll" mechanic (uncommitted edits in Character, CharacterVisual, MagnetSystem, KnockbackSystem, AITargeting, AIController, Game, config). User: **wait for it to commit, then integrate the arena work on top**; arena balance playtests are re-run after that.

_(none open)_

### Answered by the user (2026-09-29)
- Magnet changes made from other sessions (1 s pull+hold, 3 s regrab lockout, attract range 10.5, repulse cooldown 4 s, stability regen 1/s, direct-repulse character factor 0.55) → **keep**; current `config.ts` + AGENTS.md are the source of truth (supersedes the earlier 0.5 s hold decision).
- Held character time → **keep 0.5 s** pull+hold (`ATTRACT.characterPullTime`); spec updated.
- HARD match length (~41 s in one run) → **leave as is**.
- Stability knockback multiplier → **×1.6 at zero stability** (`STABILITY.extraKnockback = 0.6`; spec ×2, coder had 0.35).
- AI repulse rest (3–6 s extra) and opening delay (5–9 s) → **keep**.
- Outer-platform edge zones 1.5/3 + outward-only WARNING retreat → **keep**.
- Attract pull gives elimination credit to the puller → **yes**; first elimination ~6.8 s is **fine**.

## Log

- 2026-09-29: Board created. Coder, Test writer, Visual QA, Performance running; Reviewer done.
- 2026-09-29: Test writer done — 25 tests, 21 pass; 4 failures = bugs #7 and #24 (sent to Coder). §3 victory text "Opponents Eliminated" confirmed correct per AGENTS.md.
- 2026-09-29: Visual QA done. CRITICAL #25 (mouse input) found; Effects fix verified. QA agent's own task.md edit was blocked by the permission system — orchestrator recorded its rows. Test writer resumed for #35.
- 2026-09-29: Performance done — 59.9 FPS avg with 11 alive (M4, headless Metal), no growth over 5 restarts + 2 menu cycles (§45 perf items PASS on this machine; laptop check = human). Optimizations → rows 36–38 (Coder, after #25).
- 2026-09-29: Test writer #35 done — tests/input.spec.ts (real mouse): 1 pass / 5 fail pending #25. Full suite 26 pass / 5 fail (only input tests); #7 and #24 verified fixed.
- 2026-09-29: Coder done (31/31 tests). User answered open questions; extraKnockback set to 0.6 by orchestrator. Finalizer launched (row 22).
- 2026-09-29: Finalizer done — 31/31 ×4, 5 GPU playtests with extraKnockback 0.6 (NORMAL avg 78 s to last AI, HARD 40.8 s), §45 filled (21 PASS / 1 FAIL / 4 HUMAN). Open: rows 40–42 + held-character time question.
- 2026-09-29: Finalizer done — build clean, 31/31 tests ×4 runs, §45 = 22 PASS / 4 HUMAN after user kept 0.5 s hold. Coder resumed for row 40 (AI standing still) + AGENTS.md hold-time doc.
- 2026-09-29: Coder agent terminated (network error). Found config/AGENTS.md changed by other sessions (9 peers on this project); user said keep them. Row 43 added for re-verification.
- 2026-09-29: Row 43 paused by Finalizer: another session (row 44, arena expansion stage 1) is editing src. Pre-change results: build OK, 32/32 then 31/32 (test timing flake in elimination.spec fixed by polling). Re-run after row 44 settles.
- 15:35 mai-71: RAGDOLL.duration 2 → 3 s (user request). tsc OK; magnet.spec reads RAGDOLL.duration, so no test edits. Tests not run: port 4173 is in use by another session.
