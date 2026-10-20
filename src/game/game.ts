import { ToraAudio } from "@/game/audio";
import { drawTextShadow, textWidth } from "@/game/font";
import { bestScore, qualifies } from "@/game/scores";
import { bakeSprites, type SpriteName } from "@/game/sprites";

/** Logical NES-style resolution. CSS scales it by integers so pixels stay sharp. */
export const VIEW_W = 320;
export const VIEW_H = 240;

const BRIDGE0 = 2800;
const BRIDGE_GAP = 3400;

export type Mode = "title" | "play" | "pause" | "over";

export type HudState = {
  mode: Mode;
  score: number;
  best: number;
  lives: number;
  qualifies: boolean;
  muted: boolean;
};

type Kind = "pt" | "cargo" | "tanker" | "plane" | "aa" | "fuel" | "bridge";
type Hold = "left" | "right" | "up" | "down" | "fire";

type Ent = {
  alive: boolean;
  kind: Kind;
  x: number;
  y: number;
  vy: number;
  w: number;
  h: number;
  t: number;
  cool: number;
  score: number;
  phase: number;
  bridgeId: number;
};

type Shot = { alive: boolean; x: number; y: number; vx: number; vy: number; friendly: boolean };
type Bit = { alive: boolean; x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string };
type Pop = { alive: boolean; x: number; y: number; text: string; life: number; max: number };
type Boom = { alive: boolean; x: number; y: number; t: number; max: number };
type Island = { cy: number; hy: number; cx: number; hw: number };

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  getX: () => number;
  getY: () => number;
  getMode: () => Mode;
  getScore: () => number;
  getLives: () => number;
  getFuel: () => number;
  setKeys: (codes: string[]) => void;
  setSteer: (v: number) => void;
  setFuel: (n: number) => void;
  addScore: (n: number) => void;
  endRun: () => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
    __tora?: ControlsProbe;
  }
}

function u32(n: number): number {
  let x = (Math.imul(n | 0, 0x9e3779b1) ^ (n >>> 16)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0x85ebca6b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function rand01(n: number): number {
  return u32(n) / 4294967296;
}

/** River center. Smooth, bounded, always leaves a bank on both sides of 320px. */
function centerAt(y: number): number {
  return 160 + Math.sin(y * 0.0042) * 54 + Math.sin(y * 0.00165 + 2.1) * 22;
}

function halfAt(y: number): number {
  const d = Math.min(1, Math.max(0, y) / 30000);
  const wob = Math.sin(y * 0.008) * 6 + Math.sin(y * 0.021) * 3;
  return Math.max(42, 104 - d * 52 + wob);
}

function nearestBridge(y: number): number {
  const n = Math.max(0, Math.round((y - BRIDGE0) / BRIDGE_GAP));
  return BRIDGE0 + n * BRIDGE_GAP;
}

function blankEnt(): Ent {
  return { alive: false, kind: "pt", x: 0, y: 0, vy: 0, w: 8, h: 8, t: 0, cool: 0, score: 0, phase: 0, bridgeId: 0 };
}

/**
 * Top-down strafe, not a chase-cam yaw craft.
 * A / Left decreases screen X. D / Right increases it.
 * W speeds the river (and noses the plane up-screen). S slows it.
 */
export class ToraGame {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly audio = new ToraAudio();
  private readonly sprites: Record<SpriteName, HTMLCanvasElement>;
  private readonly reduce: boolean;
  private readonly onHud: (h: HudState) => void;
  private readonly onRestart: () => void;
  private readonly keys = new Set<string>();
  private injected: Set<string> | null = null;
  private steerOverride: number | null = null;
  private touch = { left: false, right: false, up: false, down: false, fire: false };
  private readonly ents: Ent[] = [];
  private readonly shots: Shot[] = [];
  private readonly bits: Bit[] = [];
  private readonly pops: Pop[] = [];
  private readonly booms: Boom[] = [];
  private readonly islandCache = new Map<number, Island | null>();
  private readonly bridgeLeft = new Map<number, number>();
  private entN = 0;
  private shotN = 0;
  private bitN = 0;
  private popN = 0;
  private boomN = 0;
  private mode: Mode = "title";
  private camY = 0;
  private time = 0;
  private last = 0;
  private acc = 0;
  private raf = 0;
  private dead = false;
  private score = 0;
  private record = 0;
  private lives = 3;
  private fuel = 100;
  private scrollSpeed = 80;
  private throttle = 0.4;
  private intro = 0;
  private invuln = 0;
  private dying = 0;
  private cool = 0;
  private muzzle = 0;
  private trauma = 0;
  private flash = 0;
  private hitstop = 0;
  private hint = "";
  private hintT = 0;
  private hintedFuel = false;
  private hintedBridge = false;
  private hintedLow = false;
  private refueling = false;
  private fuelSnd = 0;
  private fuelWarn = 0;
  private cursor = 360;
  private nextFuelY = 520;
  private nextPlaneY = 1100;
  private nextBridgeIndex = 0;
  private prevWorldY = 0;
  private bank = 0;
  private muted = false;
  private autoFire = 0;
  private player = { x: 160, sy: 190, hide: false };
  private probeRef: ControlsProbe;

  constructor(canvas: HTMLCanvasElement, hooks: { onHud: (h: HudState) => void; onRestart: () => void }) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.onHud = hooks.onHud;
    this.onRestart = hooks.onRestart;
    this.sprites = bakeSprites();
    this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.muted = localStorage.getItem("tora-tora-mute") === "1";
    this.audio.setMuted(this.muted);
    for (let i = 0; i < 64; i++) this.ents.push(blankEnt());
    for (let i = 0; i < 40; i++) this.shots.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, friendly: true });
    for (let i = 0; i < 80; i++) {
      this.bits.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: "#e2a02a" });
    }
    for (let i = 0; i < 16; i++) this.pops.push({ alive: false, x: 0, y: 0, text: "", life: 0, max: 1 });
    for (let i = 0; i < 16; i++) this.booms.push({ alive: false, x: 0, y: 0, t: 0, max: 1 });
    this.record = bestScore();
    this.probeRef = {
      // Top-down strafe: there is no yaw. A/D are proven via getX (left decreases X).
      getYaw: () => 0,
      getSpeed: () => this.scrollSpeed,
      getX: () => this.player.x,
      getY: () => this.player.sy,
      getMode: () => this.mode,
      getScore: () => Math.floor(this.score),
      getLives: () => this.lives,
      getFuel: () => this.fuel,
      setKeys: (codes) => {
        this.injected = new Set(codes);
      },
      setSteer: (v) => {
        this.steerOverride = v;
      },
      setFuel: (n) => {
        this.fuel = n;
      },
      addScore: (n) => this.addScore(n),
      endRun: () => {
        this.score = Math.max(this.score, 1500);
        this.lives = 0;
        this.dying = 0;
        this.finish();
      },
    };
    window.__controlsTest = this.probeRef;
    window.__tora = this.probeRef;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVis);
    this.emit();
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
    if (window.__controlsTest === this.probeRef) {
      delete window.__controlsTest;
      delete window.__tora;
    }
    this.audio.dispose();
  }

  /** Call from a click/tap/key handler so iOS unlocks audio in the gesture stack. */
  begin(): void {
    if (this.mode === "pause") return;
    this.audio.unlock();
    this.resetWorld();
    this.mode = "play";
    this.lives = 3;
    this.score = 0;
    this.fuel = 100;
    this.record = bestScore();
    this.intro = 1.05;
    this.invuln = 1.5;
    this.dying = 0;
    this.player.hide = false;
    this.player.sy = 192;
    this.player.x = centerAt(this.playerWorldY());
    this.prevWorldY = this.playerWorldY();
    this.scrollSpeed = 80;
    this.hintedFuel = false;
    this.hintedBridge = false;
    this.hintedLow = false;
    this.hint = "";
    this.audio.startMusic();
    this.emit();
  }

  pause(): void {
    if (this.mode !== "play" || this.dying > 0) return;
    this.mode = "pause";
    this.audio.pauseMusic();
    this.emit();
  }

  resume(): void {
    if (this.mode !== "pause") return;
    this.audio.unlock();
    this.mode = "play";
    this.audio.resumeMusic();
    this.emit();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    try {
      localStorage.setItem("tora-tora-mute", this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.emit();
  }

  setHold(action: Hold, down: boolean): void {
    this.touch[action] = down;
  }

  private resetWorld(): void {
    this.camY = 0;
    this.cursor = 360;
    this.nextFuelY = 520;
    this.nextPlaneY = 1100;
    this.nextBridgeIndex = 0;
    this.entN = 0;
    this.shotN = 0;
    this.bitN = 0;
    this.popN = 0;
    this.boomN = 0;
    this.throttle = 0.42;
    this.trauma = 0;
    this.flash = 0;
    this.hitstop = 0;
    this.cool = 0;
    this.bank = 0;
    this.refueling = false;
    this.islandCache.clear();
    this.bridgeLeft.clear();
    for (const e of this.ents) e.alive = false;
    for (const s of this.shots) s.alive = false;
    for (const b of this.bits) b.alive = false;
    for (const p of this.pops) p.alive = false;
    for (const b of this.booms) b.alive = false;
  }

  private emit(): void {
    this.onHud({
      mode: this.mode,
      score: Math.floor(this.score),
      best: this.record,
      lives: this.lives,
      qualifies: this.mode === "over" && qualifies(Math.floor(this.score)),
      muted: this.muted,
    });
  }

  private finish(): void {
    if (this.mode === "over") return;
    this.mode = "over";
    this.player.hide = true;
    this.audio.stopMusic();
    this.emit();
  }

  private frame = (t: number): void => {
    if (this.dead) return;
    const now = t / 1000;
    const dt = this.last === 0 ? 1 / 60 : Math.min(0.1, now - this.last);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= 1 / 60 && steps < 5) {
      this.update(1 / 60);
      this.acc -= 1 / 60;
      steps++;
    }
    this.audio.tick();
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private held(code: string): boolean {
    if (this.injected) return this.injected.has(code);
    return this.keys.has(code);
  }

  private playerWorldY(): number {
    return this.camY + (VIEW_H - this.player.sy);
  }

  private screenY(worldY: number): number {
    return this.camY + VIEW_H - worldY;
  }

  private diff(): number {
    return Math.min(1, Math.max(0, this.camY) / 32000);
  }

  private update(dt: number): void {
    this.time += dt;
    if (this.mode === "play" && this.invuln > 0) this.invuln -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hint = "";
    }
    if (this.muzzle > 0) this.muzzle -= dt;

    if (this.hitstop > 0 && this.mode === "play") {
      this.hitstop -= dt;
      this.updateFx(dt);
      this.sweep();
      return;
    }

    if (this.dying > 0) {
      this.dying -= dt;
      this.updateFx(dt);
      this.sweep();
      if (this.dying <= 0) {
        if (this.lives <= 0) this.finish();
        else this.respawn();
      }
      return;
    }

    if (this.mode === "pause" || this.mode === "over") return;

    const playing = this.mode === "play";
    const demo = this.mode === "title";
    let ix = 0;
    let iy = 0;
    let fire = false;

    if (playing) {
      const useTouch = this.injected === null;
      if (this.held("KeyA") || this.held("ArrowLeft") || (useTouch && this.touch.left)) ix -= 1;
      if (this.held("KeyD") || this.held("ArrowRight") || (useTouch && this.touch.right)) ix += 1;
      if (this.held("KeyW") || this.held("ArrowUp") || (useTouch && this.touch.up)) iy -= 1;
      if (this.held("KeyS") || this.held("ArrowDown") || (useTouch && this.touch.down)) iy += 1;
      fire = this.held("Space") || (useTouch && this.touch.fire);
      if (this.steerOverride !== null) ix = -this.steerOverride;
    } else if (demo) {
      const target = centerAt(this.playerWorldY());
      ix = Math.max(-1, Math.min(1, (target - this.player.x) * 0.05));
      this.autoFire -= dt;
      fire = this.autoFire <= 0;
    }

    // ix < 0 is left. Bank the nose toward the turn without rotating pixels.
    this.bank += (-ix - this.bank) * Math.min(1, dt * 12);
    this.player.x += ix * 158 * dt;
    this.player.sy += iy * 76 * dt;
    this.player.x = Math.max(14, Math.min(VIEW_W - 14, this.player.x));
    this.player.sy = Math.max(158, Math.min(214, this.player.sy));

    const targetT = iy < 0 ? 1 : iy > 0 ? 0.02 : demo ? 0.34 : 0.42;
    this.throttle += (targetT - this.throttle) * (1 - Math.exp(-4 * dt));
    const d = this.diff();
    this.scrollSpeed = Math.min(172, (72 + d * 70) * (0.68 + this.throttle * 0.55));
    if (demo) this.scrollSpeed *= 0.8;
    this.camY += this.scrollSpeed * dt;
    if (playing && this.intro > 0) this.intro -= dt;

    this.cool -= dt;
    if (fire && this.cool <= 0) {
      this.cool = 0.11;
      if (demo) this.autoFire = 0.32;
      this.spawnShot(this.player.x + this.bank * -2, this.playerWorldY() + 10, 0, 360, true);
      this.muzzle = 0.045;
      if (playing) this.audio.shoot();
    }

    this.ensureSpawns();
    this.updateEnts(dt, playing);
    this.updateShots(dt);

    if (playing) {
      this.refueling = false;
      this.collide(dt);
      if (this.dying === 0 && this.intro <= 0) {
        if (!this.refueling) this.fuel -= (2.25 + this.throttle * 2.1) * dt;
        if (this.fuel <= 0) {
          this.fuel = 0;
          this.kill(true);
        } else if (this.fuel < 22 && !this.refueling) {
          this.fuelWarn -= dt;
          if (this.fuelWarn <= 0) {
            this.audio.lowFuel(Math.max(0, this.fuel) / 22);
            this.fuelWarn = 0.48;
            if (!this.hintedLow) {
              this.hintedLow = true;
              this.showHint("LOW FUEL");
            }
          }
        }
        if (this.refueling) {
          this.fuelSnd -= dt;
          if (this.fuelSnd <= 0) {
            this.audio.fuel();
            this.fuelSnd = 0.16;
          }
        }
      }
      this.prevWorldY = this.playerWorldY();
      if (!this.hintedFuel && this.nearKind("fuel", 240)) {
        this.hintedFuel = true;
        this.showHint("FLY OVER FUEL");
      }
      const nextY = BRIDGE0 + this.nextBridgeIndex * BRIDGE_GAP;
      const py = this.playerWorldY();
      if (!this.hintedBridge && nextY - py < 520 && nextY > py) {
        this.hintedBridge = true;
        this.showHint("SHOOT BRIDGE");
      }
    }

    this.updateFx(dt);
    this.sweep();
    if (this.bridgeLeft.size > 8) {
      for (const id of this.bridgeLeft.keys()) if (id < this.camY - 80) this.bridgeLeft.delete(id);
    }
  }

  private respawn(): void {
    this.camY = Math.max(0, this.camY - 130);
    this.invuln = 2.15;
    this.fuel = Math.max(this.fuel, 64);
    this.player.hide = false;
    this.player.sy = 196;
    const y = this.playerWorldY();
    let x = centerAt(y);
    if (!this.inWater(x, y)) x = centerAt(y) + halfAt(y) * 0.55;
    if (!this.inWater(x, y)) x = centerAt(y) - halfAt(y) * 0.55;
    this.player.x = Math.max(14, Math.min(VIEW_W - 14, x));
    this.prevWorldY = y;
    for (let i = 0; i < this.entN; i++) {
      const e = this.ents[i]!;
      if (e.kind !== "bridge" && Math.abs(e.y - y) < 150) e.alive = false;
    }
    for (let i = 0; i < this.shotN; i++) if (!this.shots[i]!.friendly) this.shots[i]!.alive = false;
    this.showHint("READY");
  }

  private kill(fromFuel = false): void {
    if (this.mode !== "play" || this.dying > 0) return;
    if (this.invuln > 0 && !fromFuel) return;
    this.lives -= 1;
    this.dying = this.lives > 0 ? 0.72 : 1.05;
    this.player.hide = true;
    this.boom(this.player.x, this.playerWorldY(), true);
    this.audio.crash();
    this.trauma = 1;
    this.hitstop = this.reduce ? 0 : 0.06;
    this.flash = this.reduce ? 0 : 0.85;
  }

  private showHint(text: string): void {
    this.hint = text;
    this.hintT = 2.1;
  }

  private addScore(n: number): void {
    if (this.mode !== "play" || n <= 0) return;
    const prev = Math.floor(this.score / 10000);
    this.score += n;
    const next = Math.floor(this.score / 10000);
    if (next > prev) {
      this.lives = Math.min(9, this.lives + (next - prev));
      this.audio.oneUp();
      this.popup(this.player.x - 8, this.playerWorldY() + 16, "1UP");
    }
  }

  private ensureSpawns(): void {
    const horizon = this.camY + VIEW_H + 36;
    const d = this.diff();
    let guard = 0;
    while (this.cursor < horizon && guard++ < 8) {
      const y = this.cursor;
      const salt = Math.floor(y);
      if (Math.abs(y - nearestBridge(y)) > 110) {
        const boats = this.count("pt") + this.count("cargo") + this.count("tanker");
        if (boats < 6) {
          const r = rand01(salt * 5 + 3);
          const kind: Kind = r < 0.52 ? "pt" : r < 0.78 ? "cargo" : "tanker";
          const x = this.waterX(y, salt * 9 + 4);
          if (x !== null) this.spawnBoat(kind, x, y);
        }
        if (this.camY > 650 && this.count("aa") < 2 + Math.floor(d * 2) && rand01(salt * 7 + 1) > 0.72) {
          const side = rand01(salt + 8) > 0.5 ? 1 : -1;
          const c = centerAt(y);
          const h = halfAt(y);
          const x = side > 0 ? Math.min(VIEW_W - 12, c + h + 7) : Math.max(12, c - h - 7);
          this.spawnAA(x, y);
        }
      }
      this.cursor += 250 - d * 140;
    }
    guard = 0;
    while (this.nextFuelY < horizon && guard++ < 4) {
      let y = this.nextFuelY;
      if (Math.abs(y - nearestBridge(y)) < 160) y += 260;
      const x = this.waterX(y, Math.floor(y) * 3 + 17);
      if (x !== null) this.spawnFuel(x, y);
      this.nextFuelY += 2000 - d * 250;
    }
    guard = 0;
    while (this.nextPlaneY < horizon && guard++ < 4) {
      if (this.count("plane") < 2) {
        const x = centerAt(this.nextPlaneY) + (rand01(Math.floor(this.nextPlaneY)) - 0.5) * 50;
        this.spawnPlane(x, this.nextPlaneY);
      }
      this.nextPlaneY += 1500 - d * 980;
    }
    guard = 0;
    while (BRIDGE0 + this.nextBridgeIndex * BRIDGE_GAP < horizon && guard++ < 3) {
      const y = BRIDGE0 + this.nextBridgeIndex * BRIDGE_GAP;
      this.spawnBridge(y);
      this.nextBridgeIndex++;
    }
  }

  private spawnBoat(kind: Kind, x: number, y: number): void {
    const e = this.acquire();
    if (!e) return;
    const spr = this.sprites[kind];
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.w = spr.width;
    e.h = spr.height;
    e.vy = kind === "pt" ? -16 : kind === "cargo" ? -6 : -4;
    e.score = kind === "pt" ? 40 : kind === "cargo" ? 70 : 80;
    e.phase = rand01(Math.floor(y) * 11 + x) * 6;
    e.cool = 0;
    e.t = 0;
    e.bridgeId = 0;
  }

  private spawnPlane(x: number, y: number): void {
    const e = this.acquire();
    if (!e) return;
    const spr = this.sprites.plane;
    e.kind = "plane";
    e.x = x;
    e.y = y;
    e.w = spr.width;
    e.h = spr.height;
    e.vy = -90 - this.diff() * 40;
    e.score = 100;
    e.phase = 0;
    e.cool = 0;
    e.t = 0;
    e.bridgeId = 0;
  }

  private spawnAA(x: number, y: number): void {
    const e = this.acquire();
    if (!e) return;
    const spr = this.sprites.aa;
    e.kind = "aa";
    e.x = x;
    e.y = y;
    e.w = spr.width;
    e.h = spr.height;
    e.vy = 0;
    e.score = 80;
    e.phase = 0;
    e.cool = 0.4 + rand01(Math.floor(y + x)) * 1.2;
    e.t = 0;
    e.bridgeId = 0;
  }

  private spawnFuel(x: number, y: number): void {
    const e = this.acquire();
    if (!e) return;
    const spr = this.sprites.fuel;
    e.kind = "fuel";
    e.x = x;
    e.y = y;
    e.w = spr.width;
    e.h = spr.height * 3;
    e.vy = 0;
    e.score = 50;
    e.phase = 0;
    e.cool = 0;
    e.t = 0;
    e.bridgeId = 0;
  }

  private spawnBridge(y: number): void {
    const c = centerAt(y);
    const h = halfAt(y);
    const left = c - h;
    const width = h * 2;
    const n = Math.max(3, Math.round(width / 26));
    const seg = width / n;
    const base = Math.floor(500 / n);
    const extra = 500 - base * n;
    const id = y;
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const e = this.acquire();
      if (!e) break;
      e.kind = "bridge";
      e.x = left + seg * (i + 0.5);
      e.y = y;
      e.w = seg + 1;
      e.h = this.sprites.bridge.height;
      e.vy = 0;
      e.score = base + (i === n - 1 ? extra : 0);
      e.phase = i;
      e.cool = 0;
      e.t = 0;
      e.bridgeId = id;
      spawned++;
    }
    if (spawned > 0) this.bridgeLeft.set(id, spawned);
  }

  private updateEnts(dt: number, playing: boolean): void {
    const d = this.diff();
    for (let i = 0; i < this.entN; i++) {
      const e = this.ents[i]!;
      if (!e.alive) continue;
      e.t += dt;
      if (e.kind === "plane") {
        const dx = this.player.x - e.x;
        e.x += Math.max(-64, Math.min(64, dx * 1.35)) * dt;
        e.y += e.vy * dt;
      } else if (e.kind === "pt" || e.kind === "cargo" || e.kind === "tanker") {
        e.y += e.vy * dt;
        e.x += Math.sin(this.time * 1.35 + e.phase) * (e.kind === "pt" ? 20 : 8) * dt;
        if (!this.inWater(e.x, e.y)) e.x += Math.sign(centerAt(e.y) - e.x) * 46 * dt;
      } else if (e.kind === "aa") {
        e.cool -= dt;
        const sy = this.screenY(e.y);
        if (playing && this.intro <= 0 && e.cool <= 0 && sy > 8 && sy < VIEW_H - 8) {
          e.cool = 2.35 - d * 1.15;
          const dir = Math.sign(this.player.x - e.x) || 1;
          this.spawnShot(e.x, e.y - 4, dir * 26, -155, false);
        }
      }
      if (e.y < this.camY - 48) e.alive = false;
    }
  }

  private updateShots(dt: number): void {
    for (let i = 0; i < this.shotN; i++) {
      const s = this.shots[i]!;
      if (!s.alive) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y < this.camY - 24 || s.y > this.camY + VIEW_H + 70 || s.x < -12 || s.x > VIEW_W + 12) {
        s.alive = false;
        continue;
      }
      if (!s.friendly) continue;
      for (let j = 0; j < this.entN; j++) {
        const e = this.ents[j]!;
        if (!e.alive) continue;
        if (Math.abs(s.x - e.x) * 2 < 6 + e.w && Math.abs(s.y - e.y) * 2 < 10 + e.h) {
          s.alive = false;
          this.destroyEnt(e);
          break;
        }
      }
    }
  }

  private collide(dt: number): void {
    if (this.dying > 0) return;
    const x = this.player.x;
    const y = this.playerWorldY();
    const safe = this.invuln > 0 || this.intro > 0;
    if (!safe) {
      if (!this.inWater(x, y) || !this.inWater(x, y + 4)) {
        this.kill();
        return;
      }
    }
    for (let i = 0; i < this.entN; i++) {
      const e = this.ents[i]!;
      if (!e.alive) continue;
      const hit = Math.abs(x - e.x) * 2 < 10 + e.w && Math.abs(y - e.y) * 2 < 12 + e.h;
      const crossed =
        e.kind === "bridge" &&
        Math.abs(x - e.x) * 2 < 10 + e.w &&
        this.prevWorldY < e.y &&
        y + 6 >= e.y;
      if (!hit && !crossed) continue;
      if (e.kind === "fuel") {
        const before = this.fuel;
        this.fuel = Math.min(100, this.fuel + 140 * dt);
        if (this.fuel > before) this.refueling = true;
        continue;
      }
      if (e.kind === "bridge" || !safe) {
        this.kill();
        return;
      }
    }
    if (safe) return;
    for (let i = 0; i < this.shotN; i++) {
      const s = this.shots[i]!;
      if (!s.alive || s.friendly) continue;
      if (Math.abs(s.x - x) < 8 && Math.abs(s.y - y) < 10) {
        s.alive = false;
        this.kill();
        return;
      }
    }
  }

  private destroyEnt(e: Ent): void {
    if (!e.alive) return;
    e.alive = false;
    const playing = this.mode === "play";
    this.boom(e.x, e.y, e.kind === "bridge" || e.kind === "tanker" || e.kind === "cargo");
    if (!playing) return;
    this.addScore(e.score);
    this.popup(e.x - 8, e.y, `+${e.score}`);
    this.audio.explosion(e.kind === "bridge");
    this.trauma = Math.min(1, this.trauma + (e.kind === "bridge" ? 0.4 : 0.2));
    this.hitstop = this.reduce ? 0 : e.kind === "bridge" ? 0.04 : 0.018;
    if (e.kind === "bridge") {
      const left = (this.bridgeLeft.get(e.bridgeId) ?? 1) - 1;
      this.bridgeLeft.set(e.bridgeId, left);
      if (left <= 0) {
        this.audio.fanfare();
        this.showHint("CHANNEL CLEAR");
        this.trauma = Math.min(1, this.trauma + 0.35);
      }
    }
  }

  private updateFx(dt: number): void {
    for (let i = 0; i < this.bitN; i++) {
      const b = this.bits[i]!;
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) b.alive = false;
    }
    for (let i = 0; i < this.boomN; i++) {
      const b = this.booms[i]!;
      if (!b.alive) continue;
      b.t += dt;
      if (b.t >= b.max) b.alive = false;
    }
    for (let i = 0; i < this.popN; i++) {
      const p = this.pops[i]!;
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  private count(kind: Kind): number {
    let n = 0;
    for (let i = 0; i < this.entN; i++) if (this.ents[i]!.alive && this.ents[i]!.kind === kind) n++;
    return n;
  }

  private nearKind(kind: Kind, range: number): boolean {
    const y = this.playerWorldY();
    for (let i = 0; i < this.entN; i++) {
      const e = this.ents[i]!;
      if (e.alive && e.kind === kind && e.y > y && e.y - y < range) return true;
    }
    return false;
  }

  private islandAt(i: number): Island | null {
    const cached = this.islandCache.get(i);
    if (cached !== undefined) return cached;
    let result: Island | null = null;
    if (i >= 1) {
      const cy = i * 860 + 340;
      if (Math.abs(cy - nearestBridge(cy)) > 210 && rand01(i * 13 + 7) > 0.42) {
        const hy = 30 + rand01(i * 17 + 3) * 28;
        const hw = 13 + rand01(i * 19 + 5) * 10;
        const c = centerAt(cy);
        const span = Math.max(0, halfAt(cy) - hw - 18);
        const cx = c + (rand01(i * 23 + 9) - 0.5) * span;
        result = { cy, hy, hw, cx };
      }
    }
    this.islandCache.set(i, result);
    if (this.islandCache.size > 28) {
      const keep = Math.floor(this.camY / 860) - 3;
      for (const k of this.islandCache.keys()) if (k < keep) this.islandCache.delete(k);
    }
    return result;
  }

  private islandNear(y: number): Island | null {
    const i = Math.floor(y / 860);
    for (const k of [i - 1, i, i + 1]) {
      const isl = this.islandAt(k);
      if (isl && Math.abs(y - isl.cy) <= isl.hy) return isl;
    }
    return null;
  }

  private onIsland(x: number, y: number): boolean {
    const isl = this.islandNear(y);
    if (!isl) return false;
    const ny = (y - isl.cy) / isl.hy;
    const nx = (x - isl.cx) / isl.hw;
    return nx * nx + ny * ny <= 1;
  }

  private inWater(x: number, y: number): boolean {
    const c = centerAt(y);
    const h = halfAt(y);
    if (x < c - h + 1 || x > c + h - 1) return false;
    return !this.onIsland(x, y);
  }

  private waterX(y: number, salt: number): number | null {
    const c = centerAt(y);
    const h = halfAt(y);
    const margin = 8;
    const spans: [number, number][] = [];
    const isl = this.islandNear(y);
    if (isl && Math.abs(y - isl.cy) < isl.hy * 0.88) {
      const ny = (y - isl.cy) / isl.hy;
      const halfI = isl.hw * Math.sqrt(Math.max(0, 1 - ny * ny)) + 6;
      spans.push([c - h + margin, isl.cx - halfI], [isl.cx + halfI, c + h - margin]);
    } else {
      spans.push([c - h + margin, c + h - margin]);
    }
    const usable = spans.filter((s) => s[1] - s[0] > 10);
    if (!usable.length) return null;
    const sp = usable[u32(salt) % usable.length]!;
    return sp[0] + rand01(salt + 99) * (sp[1] - sp[0]);
  }

  private acquire(): Ent | null {
    if (this.entN >= this.ents.length) return null;
    const e = this.ents[this.entN++]!;
    e.alive = true;
    return e;
  }

  private spawnShot(x: number, y: number, vx: number, vy: number, friendly: boolean): void {
    if (this.shotN >= this.shots.length) return;
    const s = this.shots[this.shotN++]!;
    s.alive = true;
    s.x = x;
    s.y = y;
    s.vx = vx;
    s.vy = vy;
    s.friendly = friendly;
  }

  private boom(x: number, y: number, big: boolean): void {
    if (this.boomN < this.booms.length) {
      const b = this.booms[this.boomN++]!;
      b.alive = true;
      b.x = x;
      b.y = y;
      b.t = 0;
      b.max = big ? 0.42 : 0.3;
    }
    const n = big ? 12 : 7;
    for (let i = 0; i < n; i++) {
      if (this.bitN >= this.bits.length) break;
      const p = this.bits[this.bitN++]!;
      const ang = (i / n) * Math.PI * 2;
      const sp = 18 + (i % 4) * 14;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.max = 0.28 + (i % 3) * 0.08;
      p.life = p.max;
      p.size = 2;
      p.color = i % 3 === 0 ? "#f4f1e6" : i % 3 === 1 ? "#e2a02a" : "#c4472a";
    }
  }

  private popup(x: number, y: number, text: string): void {
    if (this.popN >= this.pops.length) return;
    const p = this.pops[this.popN++]!;
    p.alive = true;
    p.text = text;
    p.max = 0.7;
    p.life = 0.7;
    p.x = Math.max(2, Math.min(VIEW_W - textWidth(text, 1) - 2, x));
    p.y = y;
  }

  private sweep(): void {
    this.entN = compact(this.ents, this.entN);
    this.shotN = compact(this.shots, this.shotN);
    this.bitN = compact(this.bits, this.bitN);
    this.popN = compact(this.pops, this.popN);
    this.boomN = compact(this.booms, this.boomN);
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#07140f";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const mag = this.reduce ? 0 : this.trauma * this.trauma;
    const ox = Math.round(Math.sin(this.time * 53) * 6 * mag);
    const oy = Math.round(Math.cos(this.time * 41) * 4 * mag);
    ctx.save();
    ctx.translate(ox, oy);
    this.drawTerrain(ctx);
    this.drawProps(ctx);
    this.drawEnts(ctx);
    this.drawBooms(ctx);
    this.drawBits(ctx);
    this.drawShots(ctx);
    this.drawPlayer(ctx);
    this.drawPops(ctx);
    ctx.restore();
    if (this.flash > 0 && !this.reduce) {
      ctx.fillStyle = `rgba(244,241,230,${Math.min(0.4, this.flash * 0.35)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (this.mode === "pause" || this.mode === "over") {
      ctx.fillStyle = "rgba(8,12,10,0.52)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    this.drawHud(ctx);
  }

  private drawTerrain(ctx: CanvasRenderingContext2D): void {
    const cam = this.camY;
    for (let sy = 0; sy < VIEW_H; sy += 2) {
      const wy = cam + (VIEW_H - sy) - 1;
      const c = centerAt(wy);
      const h = halfAt(wy);
      const L = c - h;
      const R = c + h;
      ctx.fillStyle = ((Math.floor(wy) >> 4) & 1) === 0 ? "#10281a" : "#173422";
      ctx.fillRect(0, sy, VIEW_W, 2);
      if (L > 12) {
        ctx.fillStyle = "#0c1c12";
        const speck = 4 + (u32(Math.floor(wy / 2)) % Math.max(1, Math.floor(L - 8)));
        ctx.fillRect(speck, sy, 5, 2);
      }
      if (R < VIEW_W - 12) {
        ctx.fillStyle = "#0c1c12";
        ctx.fillRect(R + 8 + (u32(Math.floor(wy / 2) + 3) % 18), sy, 5, 2);
      }
      ctx.fillStyle = "#8a7048";
      ctx.fillRect(L - 4, sy, 4, 2);
      ctx.fillRect(R, sy, 4, 2);
      ctx.fillStyle = "#d7c48a";
      ctx.fillRect(L - 2, sy, 2, 2);
      ctx.fillRect(R, sy, 2, 2);
      ctx.fillStyle = ((Math.floor(wy) >> 2) & 1) === 0 ? "#0e335c" : "#1a5690";
      ctx.fillRect(L, sy, Math.max(0, R - L), 2);
      if (((Math.floor(wy) + Math.floor(this.time * 14)) & 7) === 0) {
        ctx.fillStyle = "#4a92c4";
        ctx.fillRect(L + 2, sy, 2, 2);
        ctx.fillRect(R - 4, sy, 2, 2);
      }
      const isl = this.islandNear(wy);
      if (!isl) continue;
      const ny = (wy - isl.cy) / isl.hy;
      const half = isl.hw * Math.sqrt(Math.max(0, 1 - ny * ny));
      if (half < 0.6) continue;
      const x0 = isl.cx - half;
      const x1 = isl.cx + half;
      ctx.fillStyle = "#d7c48a";
      ctx.fillRect(x0 - 2, sy, x1 - x0 + 4, 2);
      ctx.fillStyle = Math.abs(ny) > 0.7 ? "#1d4a28" : "#102818";
      ctx.fillRect(x0, sy, x1 - x0, 2);
    }
  }

  private drawProps(ctx: CanvasRenderingContext2D): void {
    const palm = this.sprites.palm;
    const y0 = Math.floor(this.camY / 30) * 30;
    for (let y = y0; y < this.camY + VIEW_H + 16; y += 30) {
      if (rand01(y * 3 + 11) > 0.58) continue;
      const side = rand01(y * 5 + 2) > 0.5 ? 1 : -1;
      const c = centerAt(y);
      const h = halfAt(y);
      const px = side > 0 ? c + h + 1 : c - h - palm.width - 1;
      const py = this.screenY(y) - palm.height + 4;
      if (py > -20 && py < VIEW_H && px > -8 && px < VIEW_W - 2) ctx.drawImage(palm, Math.round(px), Math.round(py));
    }
    const i0 = Math.floor(this.camY / 860) - 1;
    for (let i = i0; i <= i0 + 4; i++) {
      const isl = this.islandAt(i);
      if (!isl) continue;
      const py = this.screenY(isl.cy) - palm.height + 6;
      if (py > -20 && py < VIEW_H) ctx.drawImage(palm, Math.round(isl.cx - palm.width / 2), Math.round(py));
    }
  }

  private drawEnts(ctx: CanvasRenderingContext2D): void {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.entN; i++) {
        const e = this.ents[i]!;
        if (!e.alive) continue;
        const plane = e.kind === "plane";
        if (plane !== (pass === 1)) continue;
        const sy = this.screenY(e.y);
        if (sy < -40 || sy > VIEW_H + 40) continue;
        if (e.kind === "bridge") {
          const spr = this.sprites.bridge;
          const dw = Math.ceil(e.w);
          let x = Math.round(e.x - e.w / 2);
          const y = Math.round(sy - spr.height / 2);
          for (let dx = 0; dx < dw; dx += spr.width) {
            const slice = Math.min(spr.width, dw - dx);
            ctx.drawImage(spr, 0, 0, slice, spr.height, x + dx, y, slice, spr.height);
          }
          continue;
        }
        if (e.kind === "fuel") {
          const spr = this.sprites.fuel;
          const top = Math.round(sy - e.h / 2);
          const left = Math.round(e.x - spr.width / 2);
          for (let dy = 0; dy < e.h; dy += spr.height) {
            const slice = Math.min(spr.height, e.h - dy);
            ctx.drawImage(spr, 0, 0, spr.width, slice, left, top + dy, spr.width, slice);
          }
          if (Math.floor(this.time * 6) % 2 === 0) {
            ctx.fillStyle = "#e2a02a";
            ctx.fillRect(Math.round(e.x - 1), top + 2, 2, 2);
          }
          continue;
        }
        const spr = this.sprites[e.kind];
        ctx.drawImage(spr, Math.round(e.x - spr.width / 2), Math.round(sy - spr.height / 2));
        if (e.kind === "pt" || e.kind === "cargo" || e.kind === "tanker") {
          ctx.fillStyle = "#4a92c4";
          const flick = 3 + ((Math.floor(this.time * 10 + e.x) & 1) as number);
          ctx.fillRect(Math.round(e.x - 1), Math.round(sy + spr.height / 2 - 1), 2, flick);
        }
      }
    }
  }

  private drawBooms(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.boomN; i++) {
      const b = this.booms[i]!;
      if (!b.alive) continue;
      const f = Math.min(3, Math.floor((b.t / b.max) * 4));
      const spr = this.sprites[("boom" + f) as SpriteName];
      ctx.drawImage(spr, Math.round(b.x - spr.width / 2), Math.round(this.screenY(b.y) - spr.height / 2));
    }
  }

  private drawBits(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.bitN; i++) {
      const b = this.bits[i]!;
      if (!b.alive) continue;
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(b.x), Math.round(this.screenY(b.y)), b.size, b.size);
      ctx.globalAlpha = 1;
    }
  }

  private drawShots(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.shotN; i++) {
      const s = this.shots[i]!;
      if (!s.alive) continue;
      const sy = this.screenY(s.y);
      if (s.friendly) {
        ctx.fillStyle = "#f4f1e6";
        ctx.fillRect(Math.round(s.x - 1), Math.round(sy - 5), 2, 2);
        ctx.fillStyle = "#e2a02a";
        ctx.fillRect(Math.round(s.x - 1), Math.round(sy - 3), 2, 5);
      } else {
        ctx.fillStyle = "#c4472a";
        ctx.fillRect(Math.round(s.x - 1), Math.round(sy - 1), 3, 3);
      }
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    if (this.player.hide) return;
    if (this.invuln > 0 && Math.floor(this.time * 16) % 2 === 0) return;
    const spr = this.sprites.player;
    const x = this.player.x;
    const y = this.player.sy;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(Math.round(x - 6), Math.round(y + 7), 12, 3);
    this.drawShear(ctx, spr, x, y, this.bank);
    if (this.muzzle > 0) {
      ctx.fillStyle = "#f4f1e6";
      ctx.fillRect(Math.round(x - 1), Math.round(y - spr.height / 2 - 5), 2, 4);
    }
    ctx.fillStyle = Math.floor(this.time * 24) % 2 === 0 ? "#d7c48a" : "#4a92c4";
    ctx.fillRect(Math.round(x - 1), Math.round(y + spr.height / 2 - 2), 2, 2);
  }

  private drawShear(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, bank: number): void {
    const w = img.width;
    const h = img.height;
    const left = Math.round(x - w / 2);
    const top = Math.round(y - h / 2);
    if (Math.abs(bank) < 0.08) {
      ctx.drawImage(img, left, top);
      return;
    }
    for (let row = 0; row < h; row++) {
      const dx = Math.round((row - h / 2) * bank * 0.45);
      ctx.drawImage(img, 0, row, w, 1, left + dx, top + row, w, 1);
    }
  }

  private drawPops(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.popN; i++) {
      const p = this.pops[i]!;
      if (!p.alive) continue;
      const rise = (1 - p.life / p.max) * 14;
      drawTextShadow(ctx, p.text, p.x, this.screenY(p.y) - rise, "#e2a02a", 1);
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    if (this.mode === "title") return;
    const score = String(Math.floor(this.score)).padStart(6, "0");
    const hi = String(Math.floor(Math.max(this.record, this.score))).padStart(6, "0");
    drawTextShadow(ctx, `HI ${hi}`, 6, 5, "#e6e0cc", 2);
    drawTextShadow(ctx, `SC ${score}`, 6, 22, "#e2a02a", 2);
    const life = this.sprites.life;
    for (let i = 0; i < Math.min(9, this.lives); i++) ctx.drawImage(life, VIEW_W - 12 - i * 10, 6);
    const fuel = Math.max(0, Math.min(1, this.fuel / 100));
    const low = this.fuel < 22 && Math.floor(this.time * 8) % 2 === 0;
    ctx.fillStyle = "#07140f";
    ctx.fillRect(6, VIEW_H - 16, 86, 10);
    ctx.strokeStyle = "#2a3328";
    ctx.strokeRect(6.5, VIEW_H - 15.5, 85, 9);
    ctx.fillStyle = low ? "#c4472a" : "#e2a02a";
    ctx.fillRect(8, VIEW_H - 14, Math.round(82 * fuel), 6);
    drawTextShadow(ctx, low ? "LOW" : "FUEL", 96, VIEW_H - 17, low ? "#c4472a" : "#e6e0cc", 1);
    if (this.mode === "play" && this.intro > 0.05 && Math.floor(this.intro * 8) % 2 === 0) {
      const t = "READY";
      drawTextShadow(ctx, t, (VIEW_W - textWidth(t, 2)) / 2, 96, "#e6e0cc", 2);
    }
    if (this.hint) {
      drawTextShadow(ctx, this.hint, (VIEW_W - textWidth(this.hint, 2)) / 2, 72, "#e2a02a", 2);
    }
    if (this.mode === "over") {
      const t = "GAME OVER";
      drawTextShadow(ctx, t, (VIEW_W - textWidth(t, 2)) / 2, 104, "#c4472a", 2);
    }
    if (this.mode === "pause") {
      const t = "PAUSED";
      drawTextShadow(ctx, t, (VIEW_W - textWidth(t, 2)) / 2, 104, "#e6e0cc", 2);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat && (e.code === "KeyP" || e.code === "Escape" || e.code === "Enter" || e.code === "KeyM")) return;
    if ((e.code === "Space" || e.code === "Enter") && this.mode === "title" && !e.repeat) {
      e.preventDefault();
      this.begin();
    } else if ((e.code === "KeyP" || e.code === "Escape") && this.mode === "play") {
      e.preventDefault();
      this.pause();
    } else if ((e.code === "KeyP" || e.code === "Escape" || e.code === "Enter") && this.mode === "pause") {
      e.preventDefault();
      this.resume();
    } else if (e.code === "Enter" && this.mode === "over") {
      e.preventDefault();
      this.onRestart();
    } else if (e.code === "KeyM") {
      this.toggleMute();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.touch.left = false;
    this.touch.right = false;
    this.touch.up = false;
    this.touch.down = false;
    this.touch.fire = false;
  };

  private onVis = (): void => {
    if (document.hidden) {
      if (this.mode === "play") this.pause();
    } else {
      this.audio.resumeCtx();
    }
  };
}

function compact<T extends { alive: boolean }>(list: T[], n: number): number {
  let i = 0;
  while (i < n) {
    if (!list[i]!.alive) {
      n--;
      const tmp = list[i]!;
      list[i] = list[n]!;
      list[n] = tmp;
    } else i++;
  }
  return n;
}
