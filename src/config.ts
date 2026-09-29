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
  characterPullTime: 1, // max continuous pull + hold of one character by the same attacker
  regrabLockout: 3, // after that, the attacker's magnet ignores that character for this long
  objectRegrabLockout: 0.75, // after launching a held object, the thrower's magnet ignores it for this long
  pulledControl: 0.3, // movement control of a character being pulled
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
  walkwayOverlap: 0.5, // walkway meshes reach this far onto the platforms they connect
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
  objectSearchRadius: 10,
  objectComboTimeout: 4,
  objectComboCooldown: 3,
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
  repulseRestMin: 3,
  repulseRestMax: 6,
  repulseRestAggressionBase: 1.4,
  openingRepulseMin: 5, // no AI repulses before a random time in [min, max] after GO!
  openingRepulseMax: 9,
  openingAttractMin: 1.5, // no AI attracts before a random time in [min, max] after GO!
  openingAttractMax: 3.5,
  edgeGuardDistance: 1.5, // AI never steers outward this close to an edge (unless it rolled a mistake)
  bridgeCenterGain: 0.8,
  wanderObstacleMargin: 1, // wander points are re-picked if within this of a raised block or pillar
  wanderPickTries: 6, // on a bridge, AI steering is pulled back toward the bridge centerline
  lowStability: 30, // below this, cautious AIs retreat to recover
  retreatRadius: 7, // RETREAT on the hub moves radially inward to this radius
  walkwayEntryInset: 2, // routing waypoints sit this far inside a platform, in line with the walkway
  walkwayAlignLateral: 0.8, // closer than this to a walkway's centerline counts as lined up with it
  walkwayCorridorExtend: 2.5, // edge distance is raised near walkway ends (this far along the axis)
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

export interface DifficultySettings {
  decisionInterval: number;
  reactionDelay: number;
  aimErrorDeg: number;
  edgeMultiplier: number;
  mistakeChance: number;
  dodgeChance: number;
  objectUseMultiplier: number;
  repulseRestMultiplier: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultySettings> = {
  EASY: { decisionInterval: 0.4, reactionDelay: 0.5, aimErrorDeg: 20, edgeMultiplier: 0.7, mistakeChance: 0.15, dodgeChance: 0.1, objectUseMultiplier: 0.5, repulseRestMultiplier: 1.5 },
  NORMAL: { decisionInterval: 0.3, reactionDelay: 0.3, aimErrorDeg: 10, edgeMultiplier: 1.0, mistakeChance: 0.07, dodgeChance: 0.3, objectUseMultiplier: 1.0, repulseRestMultiplier: 1.0 },
  HARD: { decisionInterval: 0.2, reactionDelay: 0.15, aimErrorDeg: 4, edgeMultiplier: 1.3, mistakeChance: 0.02, dodgeChance: 0.6, objectUseMultiplier: 1.5, repulseRestMultiplier: 0.7 },
};

export const DEFAULT_DIFFICULTY: Difficulty = "NORMAL";

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
