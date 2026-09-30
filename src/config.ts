// Every tunable number in the game lives here (AGENTS.md §33, §46.8).

export const WORLD = {
  gravity: -20,
  eliminationY: -10,
  maxFrameDt: 0.1, // same clamp Babylon's PhysicsEngine applies to its step, so game logic and physics agree
  skyTop: "#5fb8ff",
  skyBottom: "#c9ecff",
};

export const MOVE = {
  walkSpeed: 7,
  sprintSpeed: 11,
  groundAccel: 80,
  airAccelFactor: 0.5,
  jumpVelocity: 8,
  groundRayExtra: 0.15,
  turnSpeed: 14, // visual yaw lerp factor
  knockbackControl: 0.3,
  knockbackDuration: 0.4,
  maxHorizontalSpeed: 30, // safety cap after physics impacts
};

export const OBJECTS = {
  maxSpeed: 30, // safety cap so stacked repulses cannot turn props into bullets
  restitution: 0.05, // bounciness of every prop except the spring ball
  anvil: {
    size: [1.2, 0.8, 0.8] as [number, number, number], // box collider (x = horn axis, y, z)
    mass: 10, // heavy: repulse gives it REPULSE.heavyFactor
    hitRadius: 0.6, // hit/capture radius for the magnet and object hits
    color: "#4a4f5a", // dark iron
    emissive: "#141c28",
  },
  springBall: {
    diameter: 0.9,
    mass: 0.8,
    restitution: 0.9, // very bouncy; Havok combines restitution with MAXIMUM, so it ricochets off everything
    hitRadius: 0.45,
    stripes: 8, // alternating wedges around the ball
    stripeColors: ["#d4dce6", "#e8365d"] as [string, string],
    emissive: "#2a1420",
    textureSize: 64,
  },
};

export const CHARACTER = {
  radius: 0.5,
  height: 2,
  mass: 1,
  nameplateOffset: 1.8, // above body center (≈2.8 above the feet)
  playerOutlineWidth: 0.06,
};

export const RENDER = {
  // Retina/5K screens (devicePixelRatio 2) would otherwise render 4× the pixels of a 1× screen.
  // 1.5 measured 57 → 111 FPS at 2560×1440 CSS on an M4 and still looks sharp (AGENTS.md §32).
  maxPixelRatio: 1.5,
};

export const NAMEPLATE = {
  // On-screen size in CSS pixels, kept constant at any distance (AGENTS.md §28).
  heightPx: 24,
  aiWidthPx: 64,
  playerWidthPx: 86,
  // Texture pixels per CSS pixel: sharp up to devicePixelRatio 3 when magnified.
  textureScale: 3,
  fontSizePx: 14,
  cornerRadiusPx: 8,
  borderPx: 2,
  textOutlinePx: 3,
  alpha: 0.92,
  renderingGroup: 1, // drawn after the scene with a cleared depth buffer, so never hidden behind geometry
};

export const CAMERA = {
  distance: 9,
  height: 4.5,
  sensitivity: 0.0025,
  minPitchDeg: -10,
  maxPitchDeg: 60,
  followLerp: 10,
  lookAtHeight: 1.5, // above the feet
  collisionPadding: 0.3,
  fov: 0.9,
  menuOrbitSpeed: 0.12,
  menuOrbitRadius: 62,
  menuOrbitHeight: 32,
  menuPan: 19, // menu camera pans sideways so the arena sits to the right of the (left-aligned) menu card
};

export const ATTRACT = {
  range: 10.5,
  coneDeg: 60,
  accel: 40,
  holdDistance: 2.5,
  holdHeight: 1.2, // above the feet
  captureDistance: 1.5,
  springStiffness: 60,
  springDamping: 10,
  maxHeldCharacters: 1,
  regrabLockout: 0.75, // after launching a held character, the thrower's magnet ignores it for this long
  objectRegrabLockout: 0.75, // after launching a held object, the thrower's magnet ignores it for this long
  pulledControl: 0.3, // movement control of a character being pulled
};

/** Ragdoll after a projectile hit (AGENTS.md §24.1). Only ragdolled characters can be attracted. */
export const RAGDOLL = {
  duration: 3, // further hits during a ragdoll do not extend it
  knockbackMultiplier: 1.85, // horizontal knockback while ragdolled: about 2× the travel distance (stacks with stability)
};

export const POWER = {
  max: 100,
  drainPerSec: 25,
  regenPerSec: 20,
  restartThreshold: 20,
};

export const REPULSE = {
  range: 12,
  coneDeg: 60,
  pointBlankRadius: 2.5,
  horizontalSpeed: 18,
  characterFactor: 0.55, // direct-repulse horizontal knockback on characters (objects get the full push)
  upwardSpeed: 5,
  falloff: 0.5,
  launchSpeed: 25,
  launchLift: 0.12,
  heavyFactor: 0.5,
  cooldown: 4,
  shakeDuration: 0.15,
  shakeAmplitude: 0.15,
};

export const STABILITY = {
  max: 100,
  repulseHit: 25,
  objectHit: 15,
  objectHitSpeed: 8,
  objectHitCooldown: 0.5,
  objectHitTransfer: 0.7, // fraction of the projectile's horizontal velocity given to the victim
  objectHitLift: 3,
  throwCreditTime: 2, // an object hit within this many seconds of its launch is credited to the launcher
  regenPerSec: 1,
  /** Knockback multiplier = 1 + extraKnockback × (100 − stability) / 100. */
  extraKnockback: 0.6,
};

export const ARENA = {
  hubRadius: 20,
  platformThickness: 2,
  cardinalSize: 14, // N/S/E/W platforms (square)
  cardinalDistance: 34, // their centers sit this far out along the axes
  islandRadius: 7, // NE/SE/SW/NW diagonal islands
  islandOffset: 24, // their centers are at (±islandOffset, ±islandOffset)
  spokeWidth: 3, // hub ↔ cardinal bridges
  catwalkWidth: 2.5, // cardinal ↔ diagonal island catwalks
  bridgeThickness: 1,
  bridgeTopOffset: 0.01, // bridge tops sit this far below y = 0 so they never z-fight with the platforms they overlap
  walkwayOverlap: 0.8, // walkway meshes reach this far onto the platforms they connect (covers the rim corner where a catwalk leaves a square platform at an angle)
  raisedBlockSize: 6,
  raisedBlockHeight: 2,
  rampWidth: 3,
  rampLength: 4,
  pillarRadius: 1,
  pillarHeight: 5,
  wallHeight: 1.2,
  wallThickness: 0.5,
  guardWallLength: 8, // E/W outer-edge walls
  guardRailLength: 3, // N/S outer-corner rails
  coverWallLength: 4,
  coverWallThickness: 0.6,
  objectRespawnDelay: 5,
  emissiveFactor: 0.1, // arena materials glow with this fraction of their color (keeps them from looking washed out)
};

export const BOUNCE = {
  // Bounce pads on the hub rim (arena expansion spec §3): one per diagonal at this radius → (±12, ±12),
  // each launching whatever steps on it to the center of the diagonal island behind it.
  ringRadius: 17,
  padRadius: 1.2,
  padHeight: 0.2,
  tessellation: 24,
  topRadius: 1.0, // glowing top disc (visual only)
  obstacleClearance: 1.5, // AI wander/flank points keep this far outside the pad radius
  launchVy: 14, // vertical launch speed; the horizontal speed is solved per pad so the arc lands mid-island
  triggerHeight: 0.6, // feet (or object bottom) within this height above the pad top trigger a launch
  triggerBelow: 0.15, // ...or this far below it (a capsule or prop riding up onto the pad rim)
  cooldown: 0.6, // seconds, per body and per pad
  controlFraction: 0.3, // characters' movement control (air accel and steering speed) during the flight
  groundLock: 0.15, // grounded is ignored this long after a launch so the pad top does not end the flight at once
  flightMargin: 0.3, // the flight state lasts at most the flight time plus this (ends earlier on landing)
  arrowLength: 1.3,
  arrowHeadWidth: 0.9,
  arrowShaftWidth: 0.34,
  arrowHeadLength: 0.55,
  idleGlow: 0.75, // top emissive multiplier at rest
  pulseGlow: 2.2, // top emissive multiplier at the start of a launch pulse
  pulseDuration: 0.35,
  burstCount: 24,
  burstPower: 5,
  baseColor: "#3a3f6e",
  topColor: "#34e8c4",
  arrowColor: "#ffffff",
  burstColor: "#8affe6",
};

export const SPAWN = {
  // 7 hand-picked hub points (≥2 u from obstacles, ≥4 u apart) + 4 cardinal platform centers.
  // Index 0 is always the player's spawn.
  points: [
    [-0.5, 16], [0.5, -16], [-16, 0.5], [16, -0.5], [-4, -5], [4, 5], [-7, -1],
    [0, -34], [0, 34], [34, 0], [-34, 0],
  ] as [number, number][],
  height: 1.5,
};

/** Island themes (static pieces placed in ArenaLayout.ts) and visual-only dressing (ArenaDecor.ts). */
export const DECOR = {
  themes: {
    crystal: { radius: 1.1, height: 3, capHeight: 1.4, color: "#6fd6f5" }, // NE: hex-prism collider + pointed cap
    scrap: { height: 1.5, color: "#9c6b4e" }, // SE: two scrap-pile box colliders
    trunk: { radius: 0.4, height: 2.5, color: "#7a5230" }, // SW: tree trunks
    tower: { size: 3, distance: 4.3, stepRise: 1, stepDepth: 1.2, color: "#c9b596" }, // NW: tower center this far out from the island center
  },
  underside: {
    seed: 11,
    depthMin: 6, // smallest platform
    depthMax: 10, // hub
    depthJitter: 0.6,
    gap: 0.02, // rock tops sit this far below the platform bottom
    inset: 0.97, // rock top rim as a fraction of the platform footprint
    tipRadius: 0.14, // bottom point as a fraction of the top radius
    taperPower: 1.6,
    rings: 4, // vertical subdivisions
    circleSides: 14,
    hubSides: 22,
    rectSides: 16, // multiple of 4, so the square's corners get a vertex
    radialJitter: 0.13,
    verticalJitter: 0.35,
    tipWander: 1.2,
    colors: ["#8b6a4c", "#7d7f86", "#6f553e", "#969a9f", "#80624a"],
    bottomDarken: 0.45, // faces near the tip are darkened by up to this fraction
  },
  grass: {
    seed: 21,
    perIsland: 16,
    perCardinal: 12,
    blades: 4,
    bladeRadius: 0.09,
    bladeHeightMin: 0.28,
    bladeHeightMax: 0.5,
    spread: 0.16,
    tilt: 0.35,
    scaleMin: 0.8,
    scaleMax: 1.3,
    islandMinRadius: 1.5,
    rimInset: 0.45, // tufts stay this far inside a platform rim
    cardinalBand: 1.4, // cardinal tufts sit in this band along the rim
    walkwayMargin: 1.3, // kept clear on each side of a walkway's line
    obstacleMargin: 0.4,
    color: "#4fb342",
  },
  crystals: {
    seed: 31,
    count: 8,
    rimMin: 5.2,
    rimMax: 6.1,
    arcHalf: 1.9, // radians either side of the outward direction
    scaleMin: 0.6,
    scaleMax: 1.1,
    shardRadius: 0.2,
    shardHeight: 0.8,
    tipHeight: 0.35,
    color: "#9be8ff",
    emissive: 0.35,
  },
  scrapBits: {
    seed: 41,
    pipes: 6,
    bolts: 14,
    onPile: 0.4, // fraction of the bits dropped on the pile tops
    pipeRadius: 0.12,
    pipeLength: 1.4,
    boltRadius: 0.17,
    boltHeight: 0.14,
    scatterMin: 1.5,
    scatterMax: 6,
    plates: 5,
    plateWidth: 1.1,
    plateDepth: 0.8,
    plateThickness: 0.08,
    plateTilt: 0.35,
    pipeColor: "#8f959e",
    boltColor: "#b5b9bf",
    plateColor: "#b0743f",
  },
  canopy: {
    seed: 51,
    radius: 1.35,
    blobs: 3,
    heightScale: 0.8,
    lift: 0.75, // canopy center above the trunk top
    scaleMin: 0.9,
    scaleMax: 1.15,
    color: "#3e9c47",
  },
  flag: {
    poleHeight: 2.4,
    poleRadius: 0.07,
    width: 1.2,
    height: 0.7,
    inset: 0.6, // pole stands this far inside the tower's outer wall
    waveSpeed: 2.2,
    waveAmp: 0.3,
    color: "#e8332f",
    poleColor: "#e6e6e6",
  },
  floatingRocks: {
    seed: 61,
    count: 12,
    radiusMin: 55,
    radiusMax: 95,
    yMin: -20,
    yMax: 10,
    scaleMin: 1.6,
    scaleMax: 4.5,
    bobAmp: 0.8,
    bobSpeed: 0.45,
    spinSpeed: 0.05,
    rockColor: "#8a7560",
    grassColor: "#5cbf4a",
  },
  clouds: {
    seed: 7,
    count: 18,
    parts: 3,
    radiusMin: 60,
    radiusMax: 110,
    yMin: -38,
    yMax: -20,
    partSizeMin: 7,
    partSizeMax: 13,
    partSpacing: 4.5,
    flatten: 0.45,
    color: "#ffffff",
    emissive: "#bfccd9",
  },
};

export const COUNTDOWN = {
  stepSeconds: 1,
  goSeconds: 0.5,
};

export const ELIMINATION = {
  disposeDelay: 1,
  notificationSeconds: 2,
  maxNotifications: 4,
};

export const PARTICLES = {
  attractMax: 50,
  repulseMax: 80,
  eliminationMax: 40,
  attractMinSize: 0.25,
  attractMaxSize: 0.45,
};

export const AI = {
  perceptionRadius: 26,
  targetHoldTime: 1.5,
  safeEdge: 7, // central platform thresholds (§20)
  dangerEdge: 3,
  outerSafeEdge: 3.5, // cardinal platforms and islands are too small for the hub thresholds
  outerDangerEdge: 1.5,
  warningOutwardSpeed: 0.5, // WARNING only triggers a retreat roll when moving outward faster than this
  attackMinDist: 6,
  attackMaxDist: 10,
  flankDistance: 7, // flankers stand this far behind the target (opposite its nearest edge)
  repulseHeldRange: 12,
  repulseCloseRange: 8,
  // Kill combos (user request 2026-09-30): throw an object to ragdoll an opponent, then grab the ragdolled
  // opponent and drop or throw it off the arena.
  objectSearchRadius: 20,
  objectDetour: 8, // a combo object may be up to this much farther away than the target
  objectComboChanceBase: 0.4, // chance to start an object combo = base + objectUse × difficulty.objectUseMultiplier
  objectApproachDist: 3.5, // walk this close to the object while pulling it
  objectComboTimeout: 6,
  objectComboCooldown: 2,
  throwRange: 7, // with a held object, walk to within this of the target before launching it
  maxLeadTime: 1, // throws aim at the target's intercept point, at most this many seconds ahead
  // Edge-line throws: with a held object, stand on the far side of the target from its nearest void so the hit
  // drives it off. Only worth the walk when the void is within throwKillReach × target stability multiplier
  // (+ throwLineSlack); otherwise the AI throws from where it is (the ragdoll alone sets up a grab).
  throwKillReach: 9, // an object hit sends a full-stability character about this far
  throwLineSlack: 6,
  throwStandoff: 6, // throw spot distance behind the target
  throwLineDeg: 30, // lined up when the AI → target direction is within this of the target → void direction
  // Finisher: an AI with repulse ready repulses a ragdolled opponent (not held by anyone) into a void this close to it
  finishReach: 8, // × the target's stability multiplier (a point-blank repulse on a ragdoll sends it ~8.9)
  finishStandoff: 2.5, // line-up spot distance behind the target
  finishFireDist: 4, // repulse once this close and lined up
  flankBonus: 0.4, // added to every personality's flankBias for direct repulses (pushes targets toward an edge)
  throwLowPower: 40, // below this magnet power, launch as soon as the target is within repulseHeldRange
  throwAimErrorScale: 0.4, // × difficulty aim error when launching a held object (throws lead the target)
  grabSearchRadius: 22, // ragdolled opponents within this are grabbed (highest priority after safety)
  grabApproachDist: 3.5, // walk this close to a ragdolled opponent while pulling it
  grabApproachSpeed: 9, // for "can I reach it before its ragdoll ends": estimated closing speed
  grabMinRagdollLeft: 0.6, // ...plus at least this much ragdoll time left
  throwVoidRange: 18, // holding a character with repulse ready: throw it if the void is this close in the drop direction
  carryStandoff: 1, // carry a grabbed character until this far from the void, facing it, then drop it
  carryEdgeGuardDistance: 0.6, // edge guard distance while carrying (normal: edgeGuardDistance)
  dropOverhang: 0.6, // drop the carried character once its center is this far out over the void
  dropDirSamples: 16, // directions scanned for the nearest reachable void
  dropScanStep: 0.75,
  dropScanMax: 24,
  dropDirRefresh: 0.25, // seconds between drop-direction scans while carrying
  dodgeThreatRange: 12,
  dodgeFacingDeg: 20,
  dodgeDuration: 0.5,
  dodgeJumpChance: 0.5,
  stuckTime: 0.5,
  wanderRadius: 14, // wander points on the hub stay within this radius
  wanderEdgeMargin: 2, // wander points stay this far inside a platform rim
  strafeFlipMin: 1,
  strafeFlipMax: 2,
  idleMaxSeconds: 2,
  minMoveInput: 0.2, // below this steering length, the AI circles sideways instead of standing still (§16)
  idleStrafe: 0.45, // strength of that sideways circling (also used while circling an object it is pulling)
  aimTurnRateDeg: 300, // AI aim turns at most this fast (deg/s); AI never snaps its aim
  fireAlignDeg: 15, // AI only repulses when its aim is within this of where it wants to aim
  repulseChanceBase: 0.3, // per-decision chance to commit to a repulse = base + aggression × scale
  repulseChanceAggression: 0.5,
  attractChanceBase: 0.3, // per ATTACK engagement: chance to use attract = base + aggression × scale
  attractChanceAggression: 0.5,
  // Repulse pacing: after firing, an AI waits cooldown + rest before it may repulse again.
  // rest = range(repulseRestMin, repulseRestMax) × (repulseRestAggressionBase − aggression) × difficulty.repulseRestMultiplier
  repulseRestMin: 1.5,
  repulseRestMax: 3,
  repulseRestAggressionBase: 1.4,
  openingRepulseMin: 5, // no AI repulses before a random time in [min, max] after GO!
  openingRepulseMax: 9,
  openingAttractMin: 1.5, // no AI attracts before a random time in [min, max] after GO!
  openingAttractMax: 3.5,
  edgeGuardDistance: 1.5, // AI never steers outward this close to an edge (unless it rolled a mistake)
  bridgeCenterGain: 0.8,
  wanderObstacleMargin: 1, // wander points are re-picked if within this of a raised block or pillar
  wanderPickTries: 6, // on a bridge, AI steering is pulled back toward the bridge centerline
  ragdollTargetBonus: 0.6, // target score bonus for a ragdolled opponent (it can be grabbed and thrown)
  lowStability: 30, // below this, cautious AIs retreat to recover
  retreatRadius: 7, // RETREAT on the hub moves radially inward to this radius
  walkwayEntryInset: 2, // routing waypoints sit this far inside a platform, in line with the walkway
  walkwayAlignLateral: 0.8, // closer than this to a walkway's centerline counts as lined up with it
  walkwayCorridorExtend: 2.5, // edge distance is raised near walkway ends (this far along the axis)
  walkwayCorridorShrink: 0.3, // ...within the walkway width minus this
  // Late game (user decision 2026-09-29): on the 1.5× arena the last few AI stalled in the hub center.
  // Once at most lateGameAliveAI AI remain, they push harder: more flanking (pushes targets toward an edge),
  // more repulse commitment, shorter rests and a stronger preference for targets near an edge.
  lateGameAliveAI: 5,
  lateGameFlankBonus: 0.5, // added to flankBias
  lateGameRepulseChanceBonus: 0.3, // added to the per-decision repulse commitment chance
  lateGameRestMultiplier: 0.4, // × repulse rest
  lateGameEdgeWeight: 2, // × the "target near an edge" score bonus
  walkwayEntryWindow: 1.5, // lined up and within this of the entry point (or past it) counts as entering the walkway
  rngSeed: 1337,
};

export type PersonalityName = "Aggressive" | "Defensive" | "Pusher" | "Object User" | "Chaotic";

export interface Personality {
  name: PersonalityName;
  aggression: number;
  edgeCaution: number;
  objectUse: number;
  randomness: number;
  flankBias: number;
}

export const PERSONALITIES: Record<PersonalityName, Personality> = {
  Aggressive: { name: "Aggressive", aggression: 0.9, edgeCaution: 0.3, objectUse: 0.2, randomness: 0.2, flankBias: 0.2 },
  Defensive: { name: "Defensive", aggression: 0.3, edgeCaution: 0.9, objectUse: 0.3, randomness: 0.1, flankBias: 0.1 },
  Pusher: { name: "Pusher", aggression: 0.6, edgeCaution: 0.6, objectUse: 0.1, randomness: 0.1, flankBias: 0.9 },
  "Object User": { name: "Object User", aggression: 0.5, edgeCaution: 0.6, objectUse: 0.9, randomness: 0.1, flankBias: 0.2 },
  Chaotic: { name: "Chaotic", aggression: 0.6, edgeCaution: 0.2, objectUse: 0.4, randomness: 0.9, flankBias: 0.3 },
};

export const AI_ROSTER: PersonalityName[] = [
  "Aggressive", "Defensive", "Pusher", "Object User", "Chaotic",
  "Aggressive", "Defensive", "Pusher", "Object User", "Chaotic",
];

export type Difficulty = "EASY" | "NORMAL" | "HARD";

/**
 * Magnet perks (multipliers). The player always has NO_PERKS; AI get their difficulty's `aiPerks`
 * (user decision 2026-09-30: AI may cheat so they can finish kills).
 */
export interface MagnetPerks {
  cooldown: number; // × repulse cooldown
  launch: number; // × launch speed of held objects/characters
  pull: number; // × attract pull acceleration
}

export const NO_PERKS: MagnetPerks = { cooldown: 1, launch: 1, pull: 1 };

export interface DifficultySettings {
  decisionInterval: number;
  reactionDelay: number;
  aimErrorDeg: number;
  edgeMultiplier: number;
  mistakeChance: number;
  dodgeChance: number;
  objectUseMultiplier: number;
  repulseRestMultiplier: number;
  aiPerks: MagnetPerks;
}

export const DIFFICULTY: Record<Difficulty, DifficultySettings> = {
  EASY: { decisionInterval: 0.4, reactionDelay: 0.5, aimErrorDeg: 20, edgeMultiplier: 0.7, mistakeChance: 0.15, dodgeChance: 0.1, objectUseMultiplier: 0.5, repulseRestMultiplier: 1.5,
    aiPerks: { cooldown: 1, launch: 1, pull: 1 } },
  NORMAL: { decisionInterval: 0.3, reactionDelay: 0.3, aimErrorDeg: 10, edgeMultiplier: 1.0, mistakeChance: 0.07, dodgeChance: 0.3, objectUseMultiplier: 1.0, repulseRestMultiplier: 1.0,
    aiPerks: { cooldown: 0.7, launch: 1.15, pull: 1.4 } },
  HARD: { decisionInterval: 0.2, reactionDelay: 0.15, aimErrorDeg: 4, edgeMultiplier: 1.3, mistakeChance: 0.02, dodgeChance: 0.6, objectUseMultiplier: 1.5, repulseRestMultiplier: 0.7,
    aiPerks: { cooldown: 0.55, launch: 1.25, pull: 1.7 } },
};

export const DEFAULT_DIFFICULTY: Difficulty = "NORMAL";

/**
 * Procedural arena textures (arena expansion spec §5). Every texture is drawn once at runtime in grayscale
 * and multiplies the material color. `period` is the world size of one texture repeat, `cells` how many
 * tiles/plates/planks/bricks it holds per side. Brightness values are 0–1 multipliers.
 */
export const TEXTURES = {
  size: 256, // canvas size (px) of every texture
  seed: 7919, // RNG seed: textures look the same on every load
  anisotropy: 8, // sharper tiles at grazing angles
  keepBrightness: true, // scale each texture so its mean is 1: the average color matches the untextured look
  tiles: { period: 4, cells: 2, face: [0.9, 1] as [number, number], grout: 0.74, groutPx: 3, noise: 0.05 }, // hub: stone tiles ≈ 2 u
  plates: { period: 7, cells: 2, face: [0.93, 1] as [number, number], seam: 0.66, seamPx: 2, bevelPx: 5, bevel: 0.08, noise: 0.03 }, // cardinal tops ≈ 3.5 u
  turf: { period: 6, blotch: [0.84, 1] as [number, number], blotchCells: 8, speckle: 0.14, speckleDensity: 0.12 }, // island tops
  planks: { period: 2, cells: 4, face: [0.84, 1] as [number, number], seam: 0.55, seamPx: 3, grain: 0.06, joints: 0 }, // walkways: plank ≈ 0.5 u, running across; joints = end joints per repeat (0 = one board)
  rock: { period: 4, bands: 5, band: [0.72, 1] as [number, number], wobble: 6, noise: 0.07 }, // platform sides
  bricks: { period: 2, rows: 4, perRow: 2, face: [0.86, 1] as [number, number], mortar: 0.76, mortarPx: 4, noise: 0.04 }, // blocks, walls, pillars, tower
  metal: { face: 0.96, border: 0.74, borderPx: 14, rivet: 0.7, rivetPx: 9, rivetInset: 26, rivetsPerSide: 3, brushed: 0.05 }, // magnetic props, 1 per face
  /** Surface tag (mesh.metadata.surface) → texture. Tags not listed keep their own look. `side`: texture for side/bottom faces. */
  surfaces: {
    hub: { top: "tiles", side: "rock" },
    cardinal: { top: "plates", side: "rock" },
    island: { top: "turf", side: "rock" },
    walkway: { top: "planks" },
    ramp: { top: "planks" },
    block: { top: "bricks" },
    wall: { top: "bricks" },
    pillar: { top: "bricks" },
    tower: { top: "bricks" },
  } as Record<string, { top: "tiles" | "plates" | "turf" | "planks" | "rock" | "bricks"; side?: "tiles" | "plates" | "turf" | "planks" | "rock" | "bricks" }>,
  /** Hazard stripe band around every base-platform rim, cut at walkway entrances. */
  trim: {
    width: 0.5,
    lift: 0.02, // above the platform top (y = 0) so it never z-fights
    stripePeriod: 1, // world length of one yellow + black stripe pair along the rim
    colors: ["#ffcc1a", "#26262b"] as [string, string],
    entranceMargin: 0.3, // gap beyond each walkway's half width
    segment: 0.5, // max arc length of one ring segment on circular rims
    textureSize: 64,
  },
};

export const COLORS = {
  player: "#ffc928",
  playerOutline: "#ffffff",
  ai: [
    "#ff4d4d", "#4d7dff", "#3ecf5a", "#b35cff", "#ff8a1f",
    "#1fd1d1", "#ff5cc8", "#8fd13a", "#6d5cff", "#ff6f4d",
  ],
  skin: "#ffd9b3",
  pants: "#3a3f5c",
  magnetRed: "#e8332f",
  magnetSilver: "#d9dde3",
  magnetBody: "#c8262a",
  centralPlatform: "#2466c4", // darker than it renders: hemi + sun push lit top faces well above 1×
  cardinalPlatforms: ["#ff9f5a", "#9f7aff", "#5ae0a0", "#ffd65a"], // N, S, E, W
  islandPlatforms: ["#7ad7f0", "#c7a27a", "#7cc96a", "#e39ad0"], // NE, SE, SW, NW
  bridge: "#f2f2f2",
  catwalk: "#d9c9a8",
  coverWall: "#8a8fb3",
  raisedBlock: "#ff7aa8",
  ramp: "#ffb3cc",
  pillar: "#ffe6a0",
  wall: "#8a8fb3",
  metal: "#a9b4c2",
  metalEmissive: "#1c2a3a",
  rangeIndicator: "#ffd23f", // warm yellow: contrasts with the blue floor at ≤0.15 opacity
};

export const AUDIO = {
  masterVolume: 0.5,
  aiMaxDistance: 30,
  maxImpactsPerSecond: 8,
  impactMinSpeed: 4,
};

export const DEBUG = {
  publishInterval: 0.25, // seconds between window.__MM_DEBUG__ refreshes (state changes publish immediately)
  pruneInterval: 1, // seconds between pruning stale per-character hit/regrab cooldown entries
};

export const HUD = {
  cooldownDecimals: 1,
};
