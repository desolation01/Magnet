import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { HavokPhysicsWithBindings } from "@babylonjs/havok";
import type { AIWorld } from "../ai/AITargeting";
import { Arena } from "../arena/Arena";
import { ArenaDecor } from "../arena/ArenaDecor";
import { ArenaObjects } from "../arena/ArenaObjects";
import { applyArenaTextures } from "../arena/ArenaTextures";
import { BouncePads } from "../arena/BouncePads";
import { AudioManager } from "../audio/AudioManager";
import type { Character } from "../character/Character";
import { Effects, type PlayerEffectsView } from "../combat/Effects";
import { KnockbackSystem } from "../combat/KnockbackSystem";
import { MagnetSystem } from "../combat/MagnetSystem";
import { AI, COUNTDOWN, DEBUG, DEFAULT_DIFFICULTY, QUALITY, REPULSE, WORLD, type Difficulty } from "../config";
import { PlayerController } from "../player/PlayerController";
import { ThirdPersonCamera } from "../player/ThirdPersonCamera";
import { HUD } from "../ui/HUD";
import { MainMenu } from "../ui/MainMenu";
import { Nameplates } from "../ui/Nameplates";
import { Notifications } from "../ui/Notifications";
import { Screens } from "../ui/Screens";
import { Rng } from "../util/rng";
import { installDebugHooks } from "./DebugHooks";
import { GameStateMachine } from "./GameState";
import { MatchManager } from "./MatchManager";
import { AdaptiveResolution, isSoftwareRenderer, type QualitySettings } from "./Quality";

export interface DebugInfo {
  state: string;
  aliveCount: number;
  fps: number;
  meshes: number;
  bodies: number;
  particles: number;
  nameplates: number;
  /** Startup quality tier ("high" / "low") and the current adaptive render scale (1 = full). */
  quality: string;
  renderScale: number;
}

declare global {
  interface Window {
    __MM_DEBUG__: DebugInfo;
    /** Detailed snapshot for automated playtests (not used by the game itself). */
    __MM_DUMP__: () => unknown;
  }
}

/** `?noend` keeps the match running after the player is eliminated (automated AI playtests). */
const NO_END = new URLSearchParams(location.search).has("noend");

/** Owns the scene, all systems and the render loop. */
export class Game {
  readonly scene: Scene;
  private readonly sm = new GameStateMachine();
  private readonly rng = new Rng(AI.rngSeed);
  private readonly shadows: ShadowGenerator;
  private readonly arena: Arena;
  private readonly decor: ArenaDecor;
  private readonly objects: ArenaObjects;
  private readonly camera: ThirdPersonCamera;
  private readonly controller: PlayerController;
  private readonly effects: Effects;
  readonly bouncePads: BouncePads;
  private readonly magnets: MagnetSystem;
  private readonly knockback: KnockbackSystem;
  private readonly match: MatchManager;
  private readonly audio = new AudioManager();
  private readonly hud = new HUD();
  private readonly notifications = new Notifications();
  private readonly screens: Screens;
  private readonly menu: MainMenu;
  private readonly nameplates: Nameplates;
  private readonly world: AIWorld;
  private readonly quality: QualitySettings;
  private readonly resolution: AdaptiveResolution;

  private difficulty: Difficulty = DEFAULT_DIFFICULTY;
  private countdownTime = 0;
  private matchTime = 0;
  private lastGoBeep = "";
  private readonly lastFeet = new Vector3();
  private readonly effectsView: PlayerEffectsView = { position: new Vector3(), aimYaw: 0, attracting: false, alive: false };
  private pruneTimer = 0;
  private debugTimer = 0;
  private readonly eliminationLog: { name: string; time: number; by: string | null; x: number; z: number; speed: number }[] = [];
  /** Projectile hits on characters this match (playtest metric). */
  private projectileHits = 0;

  constructor(private readonly engine: Engine, canvas: HTMLCanvasElement, havok: HavokPhysicsWithBindings, quality: QualitySettings) {
    const scene = new Scene(engine);
    this.scene = scene;
    // A software rasterizer is the slowest "GPU" there is: use the low-tier shadow map on it too.
    this.quality = isSoftwareRenderer(engine) ? { ...quality, tier: "low", shadowMapSize: QUALITY.low.shadowMapSize } : quality;
    // Shadows off without changing any shader (scene.shadowsEnabled = false would recompile every
    // material mid-match): the shadow map is cleared once and never drawn again.
    this.resolution = new AdaptiveResolution(engine, () => {
      const map = this.shadows.getShadowMap();
      if (!map) return;
      map.renderList = [];
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      map.resetRefreshCounter();
    });
    scene.clearColor = Color4.FromHexString(`${WORLD.skyTop}ff`);
    scene.ambientColor = new Color3(0.3, 0.3, 0.35);
    scene.enablePhysics(new Vector3(0, WORLD.gravity, 0), new HavokPlugin(true, havok));
    scene.skipPointerMovePicking = true;

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.45, 0.5, 0.65);
    const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, -0.3), scene);
    sun.position = new Vector3(30, 60, 20);
    sun.intensity = 0.85;
    this.shadows = new ShadowGenerator(this.quality.shadowMapSize, sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
    this.shadows.bias = 0.002;
    this.shadows.darkness = 0.35;

    this.arena = new Arena(scene, this.shadows);
    applyArenaTextures(scene, this.arena);
    this.objects = new ArenaObjects(scene, this.shadows);
    this.objects.onImpact = (p, speed) => this.audio.impact(p, speed);
    this.objects.reset();
    this.decor = new ArenaDecor(scene, this.shadows);

    this.camera = new ThirdPersonCamera(scene);
    this.controller = new PlayerController(canvas, this.camera);
    this.controller.onUserGesture = () => this.audio.unlock();
    this.controller.onLockChange = (locked) => this.hud.setLockHint(!locked && this.sm.is("COUNTDOWN", "PLAYING"));

    this.effects = new Effects(scene);
    this.effects.warmUp();
    this.bouncePads = new BouncePads(scene, this.arena, this.effects, this.audio);
    this.magnets = new MagnetSystem(this.effects, {
      onRepulse: (user, pos) => {
        this.audio.repulse(user.isPlayer ? null : pos);
        if (user.isPlayer) this.camera.shake(REPULSE.shakeDuration, REPULSE.shakeAmplitude);
      },
      onAttractChange: (user, active) => {
        if (user.isPlayer) this.audio.setAttractHum(active);
        else if (active) this.audio.aiAttract(user.position);
      },
    });
    this.knockback = new KnockbackSystem({
      onImpact: (victim, pos, speed) => {
        this.projectileHits++;
        this.audio.impact(victim.isPlayer ? null : pos, speed);
        if (victim.isPlayer) {
          this.audio.playerHit();
          this.camera.shake(0.12, 0.1);
        }
      },
    });

    this.match = new MatchManager(scene, this.shadows, this.rng, this.effects, {
      onEliminated: (c) => this.onEliminated(c),
    });
    this.world = { arena: this.arena, characters: this.match.characters, objects: this.objects.objects, time: 0, rng: this.rng };

    this.nameplates = new Nameplates(scene);
    this.menu = new MainMenu((d) => {
      this.audio.unlock();
      this.difficulty = d;
      this.startMatch();
    });
    this.screens = new Screens(
      () => {
        this.audio.unlock();
        this.startMatch();
      },
      () => this.toMenu(),
    );

    this.sm.onChange((next) => this.onStateChange(next));
    this.onStateChange("MENU");

    scene.onBeforeAnimationsObservable.add(() => this.update());
    scene.onBeforeRenderObservable.add(() => this.updateCamera());
    this.publishDebug();
    window.__MM_DUMP__ = () => ({
      time: +this.matchTime.toFixed(1),
      bounce: { launches: this.bouncePads.launches, pads: this.bouncePads.pads },
      eliminations: this.eliminationLog,
      projectileHits: this.projectileHits,
      ai: this.match.controllers.map((ctrl) => ({
        name: ctrl.self.name,
        personality: ctrl.personality.name,
        alive: ctrl.self.alive,
        behavior: ctrl.behavior,
        zone: ctrl.zone,
        target: ctrl.target?.name ?? null,
        x: +ctrl.self.position.x.toFixed(1),
        y: +ctrl.self.position.y.toFixed(1),
        z: +ctrl.self.position.z.toFixed(1),
        power: Math.round(ctrl.self.power),
        stability: Math.round(ctrl.self.stability),
        stats: ctrl.stats,
      })),
    });
    // Test-only API (window.__MM_TEST__), active only with `?test` in the URL.
    installDebugHooks({
      scene, arena: this.arena, match: this.match, objects: this.objects, controller: this.controller,
      getState: () => this.sm.state, getDifficulty: () => this.difficulty,
    });
  }

  // ------------------------------------------------------------ state flow

  private startMatch(): void {
    this.cleanupMatch();
    this.objects.reset();
    this.world.objects = this.objects.objects;
    this.rng.reseed(AI.rngSeed + Math.floor(Math.random() * 100000));
    this.match.spawn(this.difficulty, this.world);
    for (const c of this.match.characters) this.nameplates.add(c);
    const player = this.match.player!;
    this.camera.snapTo(player.position.subtract(new Vector3(0, 1, 0)), player.facingYaw);
    this.countdownTime = 0;
    this.matchTime = 0;
    this.eliminationLog.length = 0;
    this.projectileHits = 0;
    this.lastGoBeep = "";
    this.hud.reset();
    this.controller.clear();
    this.sm.set("COUNTDOWN");
  }

  private cleanupMatch(): void {
    this.audio.stopAll();
    this.nameplates.clear();
    this.notifications.clear();
    this.effects.clear();
    this.bouncePads.reset();
    this.match.clear();
    this.screens.hideEnd();
    this.screens.hideCountdown();
  }

  private toMenu(): void {
    this.cleanupMatch();
    this.objects.reset();
    this.world.objects = this.objects.objects;
    this.sm.set("MENU");
  }

  private onStateChange(next: string): void {
    const inMatch = next === "COUNTDOWN" || next === "PLAYING";
    this.menu.setVisible(next === "MENU");
    this.hud.setVisible(inMatch);
    this.controller.active = inMatch;
    this.hud.setLockHint(inMatch && !this.controller.locked);
    if (next === "PLAYING") {
      this.match.setControlEnabled(true);
    } else {
      this.match.setControlEnabled(false);
    }
    if (next === "COUNTDOWN") this.controller.requestLock();
    if (next === "PLAYER_ELIMINATED" || next === "VICTORY" || next === "MENU") {
      this.screens.hideCountdown(); // "GO!" must not linger over an end screen
      this.controller.releaseLock();
      this.audio.stopAll();
    }
    this.publishDebug();
  }

  private onEliminated(c: Character): void {
    const v = c.getVelocity(new Vector3());
    this.eliminationLog.push({
      name: c.name, time: +this.matchTime.toFixed(1), by: c.lastHitBy?.name ?? null,
      x: +c.position.x.toFixed(1), z: +c.position.z.toFixed(1), speed: +Math.hypot(v.x, v.z).toFixed(1),
      gx: +c.lastGroundPos.x.toFixed(1), gz: +c.lastGroundPos.z.toFixed(1),
      behavior: this.match.controllers.find((a) => a.self === c)?.behavior ?? "-",
      hit: c.lastHitKind,
    } as never);
    this.nameplates.remove(c);
    this.publishDebug(); // alive count changed: publish now rather than at the next throttled refresh
    this.magnets.releaseAll(c, this.match.characters, this.objects.objects);
    if (c.isPlayer) this.audio.setAttractHum(false);

    // After the match has ended, stragglers can still fall: no notifications or sounds over the end screens.
    if (!this.sm.is("PLAYING")) return;
    this.notifications.push(`${c.name} ELIMINATED`, c.isPlayer);
    this.audio.elimination(c.isPlayer ? null : c.position);
    if (NO_END && this.match.aliveCount > 1) return;
    if (!this.match.player?.alive) {
      this.sm.set("PLAYER_ELIMINATED");
      this.screens.showGameOver(this.match.aiAlive);
      this.audio.defeat();
    } else if (this.match.aiAlive === 0) {
      this.sm.set("VICTORY");
      this.screens.showVictory(10, this.matchTime);
      this.audio.victory();
    }
  }

  // ------------------------------------------------------------ frame update

  private update(): void {
    this.resolution.update(this.engine.getDeltaTime());
    const dt = Math.min(this.engine.getDeltaTime() / 1000, WORLD.maxFrameDt);
    if (dt <= 0) return;
    this.decor.update(dt);
    const state = this.sm.state;
    const player = this.match.player;

    if (state === "COUNTDOWN") {
      this.countdownTime += dt;
      const label = this.screens.setCountdown(this.countdownTime);
      if (label !== this.lastGoBeep) {
        this.lastGoBeep = label;
        if (label) this.audio.countdown(label === "GO!");
      }
      if (this.countdownTime >= COUNTDOWN.stepSeconds * 3) this.sm.set("PLAYING");
    } else if (state === "PLAYING") {
      this.matchTime += dt;
      const label = this.screens.setCountdown(this.countdownTime + this.matchTime);
      if (!label) this.screens.hideCountdown();
    }

    this.world.time = this.matchTime;
    const inMatch = state === "COUNTDOWN" || state === "PLAYING";

    if (player && inMatch) this.controller.apply(player);
    if (state === "PLAYING") for (const ai of this.match.controllers) ai.update(dt, this.world);

    for (const c of this.match.characters) c.update(dt);
    this.bouncePads.update(dt, this.match.characters, this.objects.objects);
    if (player && player.alive) {
      if (player.jumpedThisFrame) this.audio.jump();
      if (player.landedThisFrame) this.audio.land();
    }

    this.magnets.update(dt, this.matchTime, this.match.characters, this.objects.objects);
    this.knockback.update(this.matchTime, this.match.characters, this.objects.objects);
    this.objects.update(dt);
    this.match.update(dt);
    this.pruneTimer -= dt;
    if (this.pruneTimer <= 0) {
      this.pruneTimer = DEBUG.pruneInterval;
      this.knockback.prune(this.matchTime, this.match.characters);
    }

    if (player && inMatch) this.hud.update(player, this.match.aiAlive, this.matchTime);
    this.notifications.update(dt);
    this.debugTimer -= dt;
    if (this.debugTimer <= 0) {
      this.debugTimer = DEBUG.publishInterval;
      this.publishDebug();
    }
  }

  private updateCamera(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, WORLD.maxFrameDt);
    const player = this.match.player;
    if (this.sm.is("MENU") || !player) {
      this.camera.orbitMenu(dt);
    } else {
      if (player.alive || player.position.y > WORLD.eliminationY - 5) {
        this.lastFeet.set(player.position.x, player.position.y - 1, player.position.z);
      }
      this.camera.follow(this.lastFeet, dt);
      this.audio.setListener(this.lastFeet);
    }
    this.nameplates.update(this.camera.camera);
    let view: PlayerEffectsView | null = null;
    if (player && this.sm.is("COUNTDOWN", "PLAYING")) {
      view = this.effectsView;
      view.position = player.position;
      view.aimYaw = player.input.aimYaw;
      view.attracting = player.attracting;
      view.alive = player.alive;
    }
    this.effects.update(dt, view);
  }

  private publishDebug(): void {
    const physics = this.scene.getPhysicsEngine() as unknown as { getBodies?: () => unknown[] } | null;
    window.__MM_DEBUG__ = {
      state: this.sm.state,
      aliveCount: this.match?.aliveCount ?? 0,
      fps: Math.round(this.engine.getFps()),
      meshes: this.scene.meshes.length,
      bodies: physics?.getBodies?.().length ?? 0,
      particles: this.scene.particleSystems.length,
      nameplates: this.nameplates?.count ?? 0,
      quality: this.quality?.tier ?? "high",
      renderScale: this.resolution?.scale ?? 1,
    };
  }
}
