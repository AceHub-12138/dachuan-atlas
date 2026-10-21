import {
  MODULES,
  MODULE_BY_ID,
  MODULE_DECORATIONS,
  SYSTEMS,
  SYSTEM_BY_ID,
} from '../data/atlas';
import type {
  AtlasModule,
  AtlasSystem,
  ModuleDecoration,
  ModuleId,
  SystemId,
} from '../data/atlas';
import {
  clamp,
  easeOutCubic,
  lerp,
  mulberry32,
  pointAtSamples,
  rgba,
  sampleCubic,
  smoothstep,
} from './math';
import type { Point } from './math';

export type ViewLevel = 'universe' | 'nexus';
export type MotionMode = 'full' | 'low' | 'static';

export type SceneNodeKind = 'system' | 'module';

export interface SceneHover {
  key: string;
  kind: SceneNodeKind;
  id: SystemId | ModuleId;
  title: string;
  latin: string;
  description: string;
  meta: string;
  available: boolean;
  color: string;
  anchor: Point;
}

export interface SceneSelection {
  kind: SceneNodeKind;
  id: SystemId | ModuleId;
}

export interface SceneMetrics {
  fps: number;
  frameMs: number;
  p95FrameMs: number;
  width: number;
  height: number;
  dpr: number;
  motion: MotionMode;
  stars: number;
  rafActive: boolean;
  focused: boolean;
}

export interface AtlasSceneOptions {
  canvas: HTMLCanvasElement;
  onHover?: (hover: SceneHover | null) => void;
  onSelect?: (selection: SceneSelection) => void;
  onBackgroundClick?: () => void;
  onMetrics?: (metrics: SceneMetrics) => void;
  initialMotion?: MotionMode;
}

interface Star {
  x: number;
  y: number;
  layer: number;
  size: number;
  alpha: number;
  phase: number;
  twinkle: number;
  drift: number;
  color: string;
  flare: boolean;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  length: number;
}

interface Relation {
  id: string;
  fromKey: string;
  toKey: string;
  points: Point[];
  fromColor: string;
  toColor: string;
  phase: number;
  width: number;
  cross?: boolean;
}

interface HitArea {
  kind: SceneNodeKind;
  id: SystemId | ModuleId;
  circle: { x: number; y: number; r: number };
  rect: { x: number; y: number; width: number; height: number };
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface DustMote {
  x: number;
  y: number;
  size: number;
  alpha: number;
  phase: number;
  depth: number;
  color: string;
}

const MODULE_INDEX_BY_ID = Object.fromEntries(
  MODULES.map((module, index) => [module.id, index]),
) as Record<ModuleId, number>;
const DECORATION_BY_MODULE = Object.fromEntries(
  MODULE_DECORATIONS.map((decoration) => [decoration.moduleId, decoration]),
) as Record<ModuleId, ModuleDecoration>;

const TAU = Math.PI * 2;
const CORE = { x: 0, y: 18 };
const UNIVERSE_CAMERA: Camera = { x: -8, y: 76, zoom: 0.99 };
const NEXUS_CAMERA: Camera = { x: 430, y: -150, zoom: 1.2 };
const NEXUS_FOCUS_CAMERA: Camera = { x: 506, y: -142, zoom: 1.12 };
const NEXUS_POSITION = SYSTEM_BY_ID.nexus.position;
const CORE_RADIUS = 71;

const FONT_SANS =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const FONT_MONO = '"IBM Plex Mono", "SFMono-Regular", "Cascadia Code", Consolas, monospace';

const alphaForInteractive = (motion: MotionMode) => (motion === 'low' ? 0.72 : 1);

export class AtlasScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly options: AtlasSceneOptions;
  private readonly resizeObserver: ResizeObserver;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private baseScale = 1;

  private view: ViewLevel = 'universe';
  private selectedSystem: SystemId | null = null;
  private activeModule: ModuleId | null = null;
  private motion: MotionMode = 'full';

  private camera: Camera = { ...UNIVERSE_CAMERA };
  private cameraTarget: Camera = { ...UNIVERSE_CAMERA };
  private viewMix = 0;
  private viewMixTarget = 0;

  private pointer = { x: 0, y: 0 };
  private pointerSmooth = { x: 0, y: 0 };
  private hoverKey: string | null = null;
  private hoverLevels = new Map<string, number>();
  private hitAreas: HitArea[] = [];

  private stars: Star[] = [];
  private dust: DustMote[] = [];
  private meteors: Meteor[] = [];
  private nextMeteorAt = 0;
  private relations: Relation[] = [];

  private cameraSpeed = 0;
  private cameraDirX = 0;
  private cameraDirY = 1;

  private glowCache = new Map<string, HTMLCanvasElement>();
  private labelScrim: HTMLCanvasElement | null = null;
  private lastTime = 0;
  private clock = 0;
  private raf = 0;
  private lowPowerTimer = 0;
  private pendingFrame = false;
  private loopRunning = false;
  private destroyed = false;
  private visible = true;
  private focused = true;

  private frameCount = 0;
  private metricsWindowStart = 0;
  private drawTimes: number[] = [];
  private lastMetricsAt = 0;

  private boundPointerMove: (event: PointerEvent) => void;
  private boundPointerLeave: () => void;
  private boundClick: (event: MouseEvent) => void;
  private boundWindowBlur: () => void;
  private boundWindowFocus: () => void;
  private boundVisibility: () => void;
  private boundFontsReady: () => void;

  constructor(options: AtlasSceneOptions) {
    this.options = options;
    this.canvas = options.canvas;
    const context = this.canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    });
    if (!context) {
      throw new Error('当前浏览器无法初始化 Canvas 2D。');
    }
    this.context = context;
    this.motion = options.initialMotion ?? 'full';

    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerLeave = () => this.handlePointerLeave();
    this.boundClick = (event) => this.handleClick(event);
    this.boundWindowBlur = () => this.handleWindowBlur();
    this.boundWindowFocus = () => this.handleWindowFocus();
    this.boundVisibility = () => this.handleVisibility();
    this.boundFontsReady = () => {
      this.buildStars();
      this.requestRender();
    };

    this.canvas.addEventListener('pointermove', this.boundPointerMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.boundPointerLeave, { passive: true });
    this.canvas.addEventListener('click', this.boundClick);
    window.addEventListener('blur', this.boundWindowBlur);
    window.addEventListener('focus', this.boundWindowFocus);
    document.addEventListener('visibilitychange', this.boundVisibility);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);

    this.buildRelations();
    this.resize();
    this.startLoop();

    document.fonts?.ready.then(() => {
      if (!this.destroyed) this.boundFontsReady();
    });
  }

  setView(view: ViewLevel) {
    if (this.view === view) return;
    this.view = view;
    this.setHover(null);
    this.viewMixTarget = view === 'nexus' ? 1 : 0;
    this.syncCameraTarget();
    if (this.motion === 'static') {
      this.snapToTargets();
      this.requestRender();
    } else {
      this.startLoop();
    }
  }

  setSelectedSystem(id: SystemId | null) {
    if (this.selectedSystem === id) return;
    this.selectedSystem = id;
    if (this.motion === 'static') this.requestRender();
    else this.startLoop();
  }

  setActiveModule(id: ModuleId | null) {
    if (this.activeModule === id) return;
    this.activeModule = id;
    this.setHover(null);
    this.syncCameraTarget();
    if (this.motion === 'static') {
      this.snapToTargets();
      this.requestRender();
    } else {
      this.startLoop();
    }
  }

  setMotion(mode: MotionMode) {
    if (this.motion === mode) return;
    this.motion = mode;
    if (mode === 'static') {
      this.snapToTargets();
      this.stopLoop();
      this.requestRender();
    } else {
      this.startLoop();
    }
    this.publishIdleMetrics();
  }

  setHover(hover: SceneHover | null, notify = true) {
    const nextKey = hover?.key ?? null;
    if (this.hoverKey === nextKey) {
      if (notify && this.options.onHover) this.options.onHover(hover);
      return;
    }
    this.hoverKey = nextKey;
    if (this.motion === 'static') {
      for (const system of SYSTEMS) {
        this.hoverLevels.set(`system:${system.id}`, hover?.key === `system:${system.id}` ? 1 : 0);
      }
      for (const module of MODULES) {
        this.hoverLevels.set(`module:${module.id}`, hover?.key === `module:${module.id}` ? 1 : 0);
      }
      this.requestRender();
    } else {
      this.startLoop();
    }
    if (!hover) this.canvas.style.cursor = 'default';
    if (notify) this.options.onHover?.(hover);
  }

  getMetrics(): SceneMetrics {
    return {
      fps: 0,
      frameMs: 0,
      p95FrameMs: 0,
      width: Math.round(this.width),
      height: Math.round(this.height),
      dpr: Number(this.dpr.toFixed(2)),
      motion: this.motion,
      stars: this.stars.length,
      rafActive: this.loopRunning,
      focused: this.focused && this.visible,
    };
  }

  destroy() {
    this.destroyed = true;
    this.stopLoop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener('pointerleave', this.boundPointerLeave);
    this.canvas.removeEventListener('click', this.boundClick);
    window.removeEventListener('blur', this.boundWindowBlur);
    window.removeEventListener('focus', this.boundWindowFocus);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    this.glowCache.clear();
    this.stars = [];
    this.dust = [];
    this.meteors = [];
    this.labelScrim = null;
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, rect.width);
    const nextHeight = Math.max(1, rect.height);
    const sizeChanged =
      Math.abs(nextWidth - this.width) > 0.5 || Math.abs(nextHeight - this.height) > 0.5;
    if (!sizeChanged) return;

    this.width = nextWidth;
    this.height = nextHeight;

    const nativeDpr = window.devicePixelRatio || 1;
    const dprCap = Math.max(1, 4096 / Math.max(this.width, this.height));
    this.dpr = Math.min(nativeDpr, 1.75, dprCap);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.baseScale = clamp(Math.min(this.width / 1920, this.height / 1080), 0.56, 2.2);

    this.buildStars();
    if (this.motion === 'static') this.requestRender();
    else this.startLoop();
  }

  private buildStars() {
    const rng = mulberry32(0x0dac4a11);
    const count = clamp(Math.round((this.width * this.height) / 5600), 220, 760);
    const colors = ['#f6f2e9', '#dbe6ee', '#b8cbda', '#f0d0b1', '#a9c3d2'];
    const stars: Star[] = [];

    for (let index = 0; index < count; index += 1) {
      const layerRoll = rng();
      const layer = layerRoll < 0.54 ? 0 : layerRoll < 0.84 ? 1 : 2;
      const sizeBase = layer === 0 ? 0.32 : layer === 1 ? 0.58 : 0.92;
      const sizeSpread = layer === 0 ? 0.62 : layer === 1 ? 0.9 : 1.2;
      const star: Star = {
        x: rng() * this.width,
        y: rng() * this.height,
        layer,
        size: sizeBase + rng() * sizeSpread,
        alpha: (layer === 0 ? 0.18 : layer === 1 ? 0.3 : 0.44) + rng() * 0.38,
        phase: rng() * TAU,
        twinkle: 0.16 + rng() * 0.5,
        drift: (layer === 0 ? 0.02 : layer === 1 ? 0.045 : 0.08) * (0.6 + rng() * 0.8),
        color: colors[Math.floor(rng() * colors.length)],
        flare: layer === 2 && rng() > 0.74,
      };
      stars.push(star);

      // A sparse far layer above the main field gives the sky more depth.
      if (index % 23 === 0) {
        stars.push({
          ...star,
          x: rng() * this.width,
          y: rng() * this.height,
          layer: 0,
          size: star.size * 0.65,
          alpha: star.alpha * 0.45,
          flare: false,
        });
      }
    }

    this.stars = stars;

    // A handful of very soft foreground dust clouds. They travel faster than
    // the star layers during camera moves, which sells depth without adding
    // per-frame particles.
    const dustCount = clamp(Math.round((this.width * this.height) / 250000), 5, 11);
    const dust: DustMote[] = [];
    for (let index = 0; index < dustCount; index += 1) {
      dust.push({
        x: rng() * this.width,
        y: rng() * this.height,
        size: 34 + rng() * 108,
        alpha: 0.02 + rng() * 0.034,
        phase: rng() * TAU,
        depth: 0.75 + rng() * 0.8,
        color: rng() > 0.52 ? '#8FB6C4' : '#C9A98A',
      });
    }
    this.dust = dust;
    this.nextMeteorAt = this.clock + 4.5 + Math.random() * 5;
  }

  private buildRelations() {
    const makeRelation = (
      id: string,
      fromKey: string,
      toKey: string,
      from: Point,
      to: Point,
      bow: number,
      fromColor: string,
      toColor: string,
      phase: number,
      width = 0.85,
      cross = false,
    ): Relation => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const normal = { x: -dy / length, y: dx / length };
      const direction = { x: dx / length, y: dy / length };
      const start = {
        x: from.x + direction.x * 34,
        y: from.y + direction.y * 34,
      };
      const end = {
        x: to.x - direction.x * 12,
        y: to.y - direction.y * 12,
      };
      const controlA = {
        x: from.x + dx * 0.31 + normal.x * bow * 0.55,
        y: from.y + dy * 0.31 + normal.y * bow * 0.55,
      };
      const controlB = {
        x: from.x + dx * 0.7 + normal.x * bow * 0.9,
        y: from.y + dy * 0.7 + normal.y * bow * 0.9,
      };
      return {
        id,
        fromKey,
        toKey,
        points: sampleCubic(start, controlA, controlB, end, 68),
        fromColor,
        toColor,
        phase,
        width,
        cross,
      };
    };

    const universeRelations: Relation[] = [
      makeRelation('core-crm', 'core', 'system:crm', CORE, SYSTEM_BY_ID.crm.position, -80, '#EE7D2C', SYSTEM_BY_ID.crm.color, 0.12),
      makeRelation('core-nexus', 'core', 'system:nexus', CORE, SYSTEM_BY_ID.nexus.position, 92, '#EE7D2C', SYSTEM_BY_ID.nexus.color, 0.44),
      makeRelation('core-electron', 'core', 'system:electron', CORE, SYSTEM_BY_ID.electron.position, -66, '#EE7D2C', SYSTEM_BY_ID.electron.color, 0.7),
      makeRelation('crm-nexus', 'system:crm', 'system:nexus', SYSTEM_BY_ID.crm.position, SYSTEM_BY_ID.nexus.position, -220, SYSTEM_BY_ID.crm.color, SYSTEM_BY_ID.nexus.color, 0.2, 0.55, true),
      makeRelation('nexus-electron', 'system:nexus', 'system:electron', SYSTEM_BY_ID.nexus.position, SYSTEM_BY_ID.electron.position, 68, SYSTEM_BY_ID.nexus.color, SYSTEM_BY_ID.electron.color, 0.58, 0.55, true),
    ];

    const nexusRelations: Relation[] = MODULES.map((module, index) =>
      makeRelation(
        `hub-${module.id}`,
        'hub',
        `module:${module.id}`,
        NEXUS_POSITION,
        {
          x: NEXUS_POSITION.x + module.offset.x,
          y: NEXUS_POSITION.y + module.offset.y,
        },
        index % 2 === 0 ? 44 : -44,
        '#EE7D2C',
        module.color,
        0.18 + index * 0.17,
        0.9,
      ),
    );

    // The current level selects its relation set at draw time.
    this.relations = [...universeRelations, ...nexusRelations];
  }

  private syncCameraTarget() {
    if (this.view === 'universe') {
      this.cameraTarget = { ...UNIVERSE_CAMERA };
      return;
    }
    this.cameraTarget = this.activeModule ? { ...NEXUS_FOCUS_CAMERA } : { ...NEXUS_CAMERA };
  }

  private snapToTargets() {
    this.syncCameraTarget();
    this.camera = { ...this.cameraTarget };
    this.viewMix = this.viewMixTarget;
    this.pointerSmooth = { ...this.pointer };
  }

  private startLoop() {
    if (this.destroyed || this.motion === 'static') {
      this.requestRender();
      return;
    }
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.lastTime = performance.now();
    this.metricsWindowStart = this.lastTime;
    this.raf = requestAnimationFrame(this.tick);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.lowPowerTimer) window.clearTimeout(this.lowPowerTimer);
    this.lowPowerTimer = 0;
    this.raf = 0;
    this.loopRunning = false;
  }

  private requestRender() {
    if (this.destroyed || this.pendingFrame || this.loopRunning) return;
    this.pendingFrame = true;
    this.raf = requestAnimationFrame((now) => {
      this.pendingFrame = false;
      this.lastTime = now;
      this.render(now);
    });
  }

  private readonly tick = (now: number) => {
    if (this.destroyed || this.motion === 'static' || !this.visible) {
      this.loopRunning = false;
      return;
    }

    const elapsed = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.update(elapsed, now);
    this.render(now);

    const lowPower = !this.focused;
    if (lowPower) {
      this.lowPowerTimer = window.setTimeout(() => {
        this.lowPowerTimer = 0;
        if (!this.destroyed && this.motion !== 'static' && this.visible) {
          this.raf = requestAnimationFrame(this.tick);
        }
      }, 48);
    } else {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private update(dt: number, now: number) {
    const speed = this.motion === 'low' ? 0.46 : 1;
    this.clock += dt * speed;

    const idle = !this.focused ? 0.3 : 1;
    const previousX = this.camera.x;
    const previousY = this.camera.y;
    const cameraEase = 1 - Math.exp(-dt * 2.75 * idle);
    this.camera.x = lerp(this.camera.x, this.cameraTarget.x, cameraEase);
    this.camera.y = lerp(this.camera.y, this.cameraTarget.y, cameraEase);
    this.camera.zoom = lerp(this.camera.zoom, this.cameraTarget.zoom, cameraEase);
    if (Math.abs(this.camera.x - this.cameraTarget.x) < 0.02) this.camera.x = this.cameraTarget.x;
    if (Math.abs(this.camera.y - this.cameraTarget.y) < 0.02) this.camera.y = this.cameraTarget.y;
    if (Math.abs(this.camera.zoom - this.cameraTarget.zoom) < 0.0002) {
      this.camera.zoom = this.cameraTarget.zoom;
    }

    // Camera velocity drives the faint star streaks during a level change.
    const cameraDx = this.camera.x - previousX;
    const cameraDy = this.camera.y - previousY;
    const rawSpeed = Math.hypot(cameraDx, cameraDy) / Math.max(0.001, dt);
    this.cameraSpeed = lerp(this.cameraSpeed, rawSpeed, 1 - Math.exp(-dt * 5.4));
    if (rawSpeed > 0.8) {
      const dirEase = 1 - Math.exp(-dt * 7);
      this.cameraDirX = lerp(this.cameraDirX, -cameraDx / rawSpeed, dirEase);
      this.cameraDirY = lerp(this.cameraDirY, -cameraDy / rawSpeed, dirEase);
    }

    const mixEase = 1 - Math.exp(-dt * 2.55 * idle);
    this.viewMix = lerp(this.viewMix, this.viewMixTarget, mixEase);
    if (Math.abs(this.viewMix - this.viewMixTarget) < 0.0005) {
      this.viewMix = this.viewMixTarget;
    }

    const pointerEase = 1 - Math.exp(-dt * 2.5);
    this.pointerSmooth.x = lerp(this.pointerSmooth.x, this.pointer.x, pointerEase);
    this.pointerSmooth.y = lerp(this.pointerSmooth.y, this.pointer.y, pointerEase);

    const hoverRate = this.motion === 'low' ? 5.2 : 8.5;
    for (const system of SYSTEMS) {
      const key = `system:${system.id}`;
      const target = this.hoverKey === key ? 1 : 0;
      const current = this.hoverLevels.get(key) ?? 0;
      this.hoverLevels.set(key, lerp(current, target, 1 - Math.exp(-dt * hoverRate)));
    }
    for (const module of MODULES) {
      const key = `module:${module.id}`;
      const target = this.hoverKey === key ? 1 : 0;
      const current = this.hoverLevels.get(key) ?? 0;
      this.hoverLevels.set(key, lerp(current, target, 1 - Math.exp(-dt * hoverRate)));
    }

    if (this.motion === 'full' && now > this.nextMeteorAt && this.meteors.length < 2) {
      this.spawnMeteor();
      this.nextMeteorAt = now + 5600 + Math.random() * 4600;
    }

    this.meteors = this.meteors.filter((meteor) => (now - meteor.born) / 1000 < meteor.life);

    if (this.options.onMetrics && now - this.lastMetricsAt > 1000) {
      this.lastMetricsAt = now;
      this.emitMetrics(now);
    }
  }


  private publishIdleMetrics() {
    if (!this.options.onMetrics) return;
    const sorted = [...this.drawTimes].sort((a, b) => a - b);
    const average =
      this.drawTimes.length > 0
        ? this.drawTimes.reduce((sum, value) => sum + value, 0) / this.drawTimes.length
        : 0;
    this.options.onMetrics({
      fps: 0,
      frameMs: Number(average.toFixed(2)),
      p95FrameMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2)),
      width: Math.round(this.width),
      height: Math.round(this.height),
      dpr: Number(this.dpr.toFixed(2)),
      motion: this.motion,
      stars: this.stars.length,
      rafActive: this.loopRunning,
      focused: this.focused && this.visible,
    });
  }

  private emitMetrics(now: number) {
    if (!this.options.onMetrics) return;
    const frameWindow = Math.max(1, now - this.metricsWindowStart);
    const fps = (this.frameCount * 1000) / frameWindow;
    const sorted = [...this.drawTimes].sort((a, b) => a - b);
    const average =
      this.drawTimes.length > 0
        ? this.drawTimes.reduce((sum, value) => sum + value, 0) / this.drawTimes.length
        : 0;
    const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;

    this.options.onMetrics({
      fps: Number(fps.toFixed(1)),
      frameMs: Number(average.toFixed(2)),
      p95FrameMs: Number(p95.toFixed(2)),
      width: Math.round(this.width),
      height: Math.round(this.height),
      dpr: Number(this.dpr.toFixed(2)),
      motion: this.motion,
      stars: this.stars.length,
      rafActive: this.loopRunning,
      focused: this.focused && this.visible,
    });

    this.frameCount = 0;
    this.drawTimes = [];
    this.metricsWindowStart = now;
  }

  private spawnMeteor() {
    const fromLeft = Math.random() > 0.46;
    const travelX = this.width * (0.42 + Math.random() * 0.3);
    this.meteors.push({
      x: fromLeft ? this.width * (0.36 + Math.random() * 0.42) : this.width * (0.66 + Math.random() * 0.22),
      y: this.height * (0.1 + Math.random() * 0.24),
      vx: fromLeft ? -200 - Math.random() * 140 : -285 - Math.random() * 135,
      vy: 78 + Math.random() * 46,
      born: performance.now(),
      life: 1.55 + Math.random() * 0.55,
      length: Math.max(160, travelX * (0.26 + Math.random() * 0.12)),
    });
  }

  private handlePointerMove(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.pointer.x = (x / Math.max(1, this.width) - 0.5) * 2;
    this.pointer.y = (y / Math.max(1, this.height) - 0.5) * 2;

    if (this.motion === 'static') {
      this.pointerSmooth.x = this.pointer.x;
      this.pointerSmooth.y = this.pointer.y;
    }

    const transitionsSettled = Math.abs(this.viewMix - this.viewMixTarget) < 0.06;

    if (!transitionsSettled) {
      if (this.hoverKey) this.setHover(null);
      return;
    }

    const hit = this.findHit(x, y);
    const nextHover = hit ? this.makeHover(hit) : null;
    if (nextHover?.key !== this.hoverKey) this.setHover(nextHover);
    else if (!hit && this.hoverKey) this.setHover(null);

    this.canvas.style.cursor = hit ? 'pointer' : 'default';
    if (this.motion === 'static') this.requestRender();
  }

  private handlePointerLeave() {
    this.pointer.x = 0;
    this.pointer.y = 0;
    this.canvas.style.cursor = 'default';
    if (this.hoverKey) this.setHover(null);
    if (this.motion === 'static') this.requestRender();
  }

  private handleClick(event: MouseEvent) {
    if (Math.abs(this.viewMix - this.viewMixTarget) > 0.08) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.findHit(event.clientX - rect.left, event.clientY - rect.top);
    if (!hit) {
      this.options.onBackgroundClick?.();
      return;
    }
    this.options.onSelect?.({ kind: hit.kind, id: hit.id });
  }

  private findHit(x: number, y: number): HitArea | null {
    for (let index = this.hitAreas.length - 1; index >= 0; index -= 1) {
      const area = this.hitAreas[index];
      const inCircle = Math.hypot(x - area.circle.x, y - area.circle.y) <= area.circle.r;
      const inRect =
        x >= area.rect.x &&
        x <= area.rect.x + area.rect.width &&
        y >= area.rect.y &&
        y <= area.rect.y + area.rect.height;
      if (inCircle || inRect) return area;
    }
    return null;
  }

  private makeHover(hit: HitArea): SceneHover {
    const anchor = { x: hit.circle.x, y: hit.circle.y };
    if (hit.kind === 'system') {
      const system = SYSTEM_BY_ID[hit.id as SystemId];
      return {
        key: `system:${system.id}`,
        kind: 'system',
        id: system.id,
        title: system.name,
        latin: system.latin,
        description: system.description,
        meta: system.available ? 'P0 可进入 · 点击进入模块星系' : '模拟星系 · 点击选中查看',
        available: system.available,
        color: system.color,
        anchor,
      };
    }
    const module = MODULE_BY_ID[hit.id as ModuleId];
    const isActive = this.activeModule === module.id;
    return {
      key: `module:${module.id}`,
      kind: 'module',
      id: module.id,
      title: module.name,
      latin: module.latin,
      description: module.description,
      meta: isActive
        ? '详情已展开 · 点击空白处收起'
        : module.available
          ? '点击查看模块详情'
          : 'P0 占位模块 · 详情暂未开放',
      available: module.available,
      color: module.color,
      anchor,
    };
  }

  private handleWindowBlur() {
    this.focused = false;
  }

  private handleWindowFocus() {
    this.focused = true;
    if (this.motion !== 'static') this.startLoop();
  }

  private handleVisibility() {
    this.visible = document.visibilityState === 'visible';
    if (!this.visible) {
      this.stopLoop();
    } else if (this.motion !== 'static') {
      this.startLoop();
    } else {
      this.requestRender();
    }
  }

  private get scale() {
    return this.baseScale * this.camera.zoom;
  }

  private worldToScreen(point: Point): Point {
    const scale = this.scale;
    return {
      x: this.width / 2 + (point.x - this.camera.x) * scale,
      y: this.height / 2 + (point.y - this.camera.y) * scale,
    };
  }

  private setWorldTransform() {
    const scale = this.scale;
    this.context.setTransform(
      this.dpr * scale,
      0,
      0,
      this.dpr * scale,
      this.dpr * (this.width / 2 - this.camera.x * scale),
      this.dpr * (this.height / 2 - this.camera.y * scale),
    );
  }

  private setScreenTransform() {
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private render(now: number) {
    if (!this.width || !this.height) return;
    const drawStart = performance.now();
    this.context.clearRect(0, 0, this.width, this.height);
    this.setScreenTransform();
    this.drawStarfield();
    this.drawMeteors(now);

    this.setWorldTransform();
    // The departed universe fades earlier than the NEXUS system itself. Keeping
    // the target body alive while the hub opens prevents the old cross-fade dip
    // and lets the camera zoom read as one continuous approach.
    const departureAlpha = 1 - smoothstep(0.02, 0.44, this.viewMix);
    const nexusSystemAlpha = 1 - smoothstep(0.52, 0.95, this.viewMix);
    const nexusAlpha = smoothstep(0.1, 0.78, this.viewMix);

    if (departureAlpha > 0.003 || nexusSystemAlpha > 0.003) {
      this.drawUniverse(departureAlpha, nexusSystemAlpha);
    }
    if (nexusAlpha > 0.003) this.drawNexus(nexusAlpha);
    this.drawArrival();

    this.updateHitAreas(departureAlpha, nexusAlpha);
    this.setScreenTransform();
    this.drawAtmosphere();

    this.context.globalAlpha = 1;
    this.context.globalCompositeOperation = 'source-over';

    const drawMs = performance.now() - drawStart;
    this.frameCount += 1;
    this.drawTimes.push(drawMs);
    if (this.drawTimes.length > 140) this.drawTimes.shift();
  }

  private drawStarfield() {
    const ctx = this.context;
    const motionScale = this.motion === 'full' ? 1 : 0.26;
    const parallaxX = this.pointerSmooth.x;
    const parallaxY = this.pointerSmooth.y;
    const panX = this.camera.x - UNIVERSE_CAMERA.x;
    const panY = this.camera.y - UNIVERSE_CAMERA.y;
    const zoomRatio = this.camera.zoom / UNIVERSE_CAMERA.zoom;
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const streak =
      this.motion === 'full' ? clamp(this.cameraSpeed / 1150, 0, 1) : 0;
    const streakLength = streak * 25;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Soft foreground dust travels furthest with the camera. It is deliberately
    // blurry so it reads as depth of field, not as another particle layer.
    for (const mote of this.dust) {
      const expand = 1 + (zoomRatio - 1) * (0.6 + mote.depth * 1.35);
      const baseX =
        centerX +
        (mote.x - centerX) * expand -
        panX * mote.depth * 0.66 +
        parallaxX * (3 + mote.depth * 8);
      const baseY =
        centerY +
        (mote.y - centerY) * expand -
        panY * mote.depth * 0.66 +
        parallaxY * (2 + mote.depth * 6);
      const x = ((baseX % (this.width + 160)) + this.width + 160) % (this.width + 160) - 80;
      const y = ((baseY % (this.height + 160)) + this.height + 160) % (this.height + 160) - 80;
      const shimmer =
        this.motion === 'static'
          ? 1
          : 0.86 + 0.14 * Math.sin(this.clock * 0.16 + mote.phase);
      this.drawGlowSprite(
        ctx,
        mote.color,
        x,
        y,
        mote.size * (1 + (zoomRatio - 1) * 0.4),
        mote.alpha * shimmer * alphaForInteractive(this.motion),
        true,
      );
    }

    for (const star of this.stars) {
      const depth = star.layer;
      const depthWeight = depth === 0 ? 0.2 : depth === 1 ? 0.55 : 1;
      const expand = 1 + (zoomRatio - 1) * (0.35 + depthWeight * 1.3);
      const baseX =
        centerX +
        (star.x - centerX) * expand -
        panX * depthWeight * 0.24 +
        parallaxX * (2.5 + depth * 4.6);
      const baseY =
        centerY +
        (star.y - centerY) * expand -
        panY * depthWeight * 0.24 +
        parallaxY * (1.8 + depth * 3.7);
      const driftX = this.clock * star.drift * 14 * motionScale;
      const x =
        (((baseX + driftX) % (this.width + 40)) + this.width + 40) % (this.width + 40) - 20;
      const y =
        ((baseY % (this.height + 40)) + this.height + 40) % (this.height + 40) - 20;

      const twinkleAmount =
        this.motion === 'static' ? 0 : (depth === 2 ? 0.2 : 0.12) * motionScale;
      const twinkle =
        1 -
        twinkleAmount +
        twinkleAmount * (0.5 + 0.5 * Math.sin(this.clock * star.twinkle + star.phase));
      const alpha = star.alpha * twinkle * alphaForInteractive(this.motion);
      if (alpha <= 0.01) continue;

      const size = star.size * (1 + (depth === 2 ? 0.12 : 0));

      if (streak > 0.02 && depth > 0) {
        const length = streakLength * depthWeight * (0.7 + star.size * 0.22);
        ctx.globalAlpha = alpha * 0.34;
        ctx.strokeStyle = star.color;
        ctx.lineWidth = Math.max(0.45, size * 0.62);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + this.cameraDirX * length, y + this.cameraDirY * length);
        ctx.stroke();
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = star.color;
      if (star.size > 1.35 && depth === 2) {
        this.drawGlowSprite(ctx, '#c8dbe8', x, y, size * 9, 0.16, true);
      }
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.35, size), 0, TAU);
      ctx.fill();

      if (star.flare && this.motion !== 'static') {
        ctx.globalAlpha = alpha * 0.42;
        ctx.strokeStyle = star.color;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x - 4.6, y);
        ctx.lineTo(x + 4.6, y);
        ctx.moveTo(x, y - 4.1);
        ctx.lineTo(x, y + 4.1);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawMeteors(now: number) {
    if (this.motion !== 'full' || this.meteors.length === 0) return;
    const ctx = this.context;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';

    for (const meteor of this.meteors) {
      const age = (now - meteor.born) / 1000;
      const progress = clamp(age / meteor.life, 0, 1);
      if (progress >= 1) continue;
      const x = meteor.x + meteor.vx * age;
      const y = meteor.y + meteor.vy * age;
      const opacity = Math.sin(progress * Math.PI) * 0.84;
      const directionLength = Math.hypot(meteor.vx, meteor.vy) || 1;
      const tailX = x - (meteor.vx / directionLength) * meteor.length;
      const tailY = y - (meteor.vy / directionLength) * meteor.length;

      // Two passes give the tail a bright inner filament and a soft, tapered
      // envelope. It is background decoration only, never a data signal.
      const gradient = ctx.createLinearGradient(tailX, tailY, x, y);
      gradient.addColorStop(0, 'rgba(255, 225, 195, 0)');
      gradient.addColorStop(0.45, `rgba(255, 225, 198, ${opacity * 0.09})`);
      gradient.addColorStop(0.78, `rgba(255, 234, 212, ${opacity * 0.32})`);
      gradient.addColorStop(1, `rgba(255, 249, 238, ${opacity * 0.9})`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(x, y);
      ctx.stroke();

      const inner = ctx.createLinearGradient(
        tailX + (x - tailX) * 0.55,
        tailY + (y - tailY) * 0.55,
        x,
        y,
      );
      inner.addColorStop(0, 'rgba(255, 240, 220, 0)');
      inner.addColorStop(1, `rgba(255, 255, 248, ${opacity * 0.72})`);
      ctx.strokeStyle = inner;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(tailX + (x - tailX) * 0.55, tailY + (y - tailY) * 0.55);
      ctx.lineTo(x, y);
      ctx.stroke();

      for (let spark = 1; spark <= 3; spark += 1) {
        const t = spark / 5;
        const sparkX = x + (tailX - x) * t;
        const sparkY = y + (tailY - y) * t;
        ctx.fillStyle = `rgba(255, 228, 198, ${opacity * (0.3 - t * 0.07)})`;
        ctx.beginPath();
        ctx.arc(sparkX, sparkY, 0.8 - t * 0.1, 0, TAU);
        ctx.fill();
      }

      this.drawGlowSprite(ctx, '#FFE5C9', x, y, 38, opacity * 0.5, true);
    }

    ctx.restore();
  }

  private drawAtmosphere() {
    // A very light cinematic top/bottom falloff is painted into the canvas so
    // the CSS vignette never has to blur a full-screen layer.
    const ctx = this.context;
    const top = ctx.createLinearGradient(0, 0, 0, this.height * 0.22);
    top.addColorStop(0, 'rgba(2, 4, 7, 0.22)');
    top.addColorStop(1, 'rgba(2, 4, 7, 0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, this.width, this.height * 0.22);
  }

  private drawArrival() {
    const intensity =
      smoothstep(0.02, 0.22, this.viewMix) * (1 - smoothstep(0.64, 0.96, this.viewMix));
    if (intensity <= 0.003) return;

    const ctx = this.context;
    const progress = smoothstep(0.06, 0.92, this.viewMix);
    const time = this.motion === 'static' ? 0 : this.clock;
    ctx.save();
    ctx.translate(NEXUS_POSITION.x, NEXUS_POSITION.y);
    ctx.globalCompositeOperation = 'lighter';

    // A contracting aperture turns the camera move into an approach rather than
    // a dissolve. On the way home it naturally expands again.
    this.drawGlowSprite(ctx, '#F0A66F', 0, 0, 170 + progress * 130, 0.075 * intensity, true);

    for (let index = 0; index < 3; index += 1) {
      const radius = lerp(244 + index * 38, 69 + index * 12, progress) + Math.sin(time * 0.7 + index) * 2;
      ctx.save();
      ctx.rotate(-0.24 + time * (index % 2 === 0 ? 0.018 : -0.012));
      ctx.strokeStyle = rgba(index === 0 ? '#F4C39D' : '#B7CEDA', intensity * (0.16 - index * 0.035));
      ctx.lineWidth = 0.7;
      ctx.setLineDash(index === 0 ? [18, 22] : [1, 12 + index * 4]);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.72, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    const tickRadius = lerp(186, 93, progress);
    for (let index = 0; index < 8; index += 1) {
      const angle = time * 0.045 + (index / 8) * TAU;
      const length = 5 + (index % 2) * 4;
      ctx.strokeStyle = rgba('#E7D3C2', intensity * (index % 2 === 0 ? 0.2 : 0.11));
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * tickRadius, Math.sin(angle) * tickRadius * 0.72);
      ctx.lineTo(
        Math.cos(angle) * (tickRadius + length),
        Math.sin(angle) * (tickRadius + length) * 0.72,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawUniverse(departureAlpha: number, nexusSystemAlpha: number) {
    const ctx = this.context;
    const time = this.clock;
    const focusKey =
      this.hoverKey ??
      (this.selectedSystem ? `system:${this.selectedSystem}` : null);

    ctx.save();
    this.drawUniverseOrbits(departureAlpha);
    this.drawUniverseRelations(focusKey, departureAlpha);
    this.drawCore(departureAlpha, focusKey);
    for (let index = 0; index < SYSTEMS.length; index += 1) {
      const system = SYSTEMS[index];
      const systemAlpha = system.id === 'nexus' ? nexusSystemAlpha : departureAlpha;
      this.drawSystem(system, index, systemAlpha, focusKey, time);
    }
    this.drawCoreCaption(departureAlpha);
    ctx.restore();
  }

  private drawNexus(alpha: number) {
    const ctx = this.context;
    const focusKey = this.activeModule
      ? `module:${this.activeModule}`
      : this.hoverKey ?? null;

    ctx.save();
    ctx.globalAlpha = alpha;
    this.drawNexusGuides(alpha);
    this.drawNexusRelations(focusKey, alpha);
    this.drawNexusHub(alpha, focusKey);
    for (let index = 0; index < MODULES.length; index += 1) {
      const module = MODULES[index];
      this.drawModule(module, index, alpha, focusKey);
    }
    ctx.restore();
  }

  private drawUniverseOrbits(alpha: number) {
    const ctx = this.context;
    ctx.save();
    ctx.translate(CORE.x, CORE.y);
    ctx.globalCompositeOperation = 'lighter';

    const rings = [
      { rx: 196, ry: 132, rotation: -0.18, opacity: 0.085, dash: [1, 8] },
      { rx: 330, ry: 228, rotation: 0.2, opacity: 0.065, dash: [1, 12] },
      { rx: 556, ry: 372, rotation: -0.1, opacity: 0.042, dash: [1, 16] },
    ];
    for (const ring of rings) {
      ctx.save();
      ctx.rotate(ring.rotation);
      ctx.strokeStyle = `rgba(194, 216, 228, ${ring.opacity * alpha})`;
      ctx.lineWidth = 0.7;
      ctx.setLineDash(ring.dash);
      ctx.beginPath();
      ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    const arcRotation = this.motion === 'static' ? 0.2 : this.clock * 0.02;
    ctx.save();
    ctx.rotate(-0.18);
    ctx.strokeStyle = `rgba(238, 125, 44, ${0.14 * alpha})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 196, 132, 0, arcRotation, arcRotation + 0.58);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  private drawUniverseRelations(focusKey: string | null, alpha: number) {
    for (const relation of this.relations.filter((item) => !item.toKey.startsWith('module:') && item.fromKey !== 'hub')) {
      const involvesFocus =
        !focusKey ||
        relation.fromKey === focusKey ||
        relation.toKey === focusKey ||
        (focusKey === 'core' && relation.fromKey === 'core');
      const opacity = relation.cross ? 0.34 : 0.8;
      this.drawRelation(
        relation,
        alpha,
        focusKey ? (involvesFocus ? 1.32 : 0.24) : opacity,
      );
    }
  }

  private drawNexusRelations(focusKey: string | null, alpha: number) {
    for (const relation of this.relations.filter((item) => item.fromKey === 'hub')) {
      const moduleId = relation.toKey.split(':')[1] as ModuleId;
      const index = MODULE_INDEX_BY_ID[moduleId];
      const { reveal, progress } = this.moduleLayout(MODULES[index], index);
      if (!reveal) continue;
      const involvesFocus = !focusKey || relation.toKey === focusKey;
      const factor = focusKey ? (involvesFocus ? 1.72 : 0.34) : 0.88;
      // Grow the link with the module instead of showing a full-length line
      // before its destination has arrived.
      const trim = clamp(0.24 + progress * 0.76, 0, 1);
      this.drawRelation(relation, alpha * reveal, factor, trim);
    }
  }

  private drawRelation(
    relation: Relation,
    alpha: number,
    emphasis: number,
    trim = 1,
  ) {
    if (emphasis < 0.02 || trim <= 0.01) return;
    const ctx = this.context;
    const points = relation.points;
    if (points.length < 2) return;
    const from = points[0];
    const to = trim >= 0.999 ? points[points.length - 1] : pointAtSamples(points, trim);
    const lastIndex = Math.max(1, Math.floor((points.length - 1) * trim));
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    const baseAlpha = clamp(0.25 * emphasis, 0.035, 0.62) * alpha;
    gradient.addColorStop(0, rgba(relation.fromColor, baseAlpha));
    gradient.addColorStop(0.6, rgba(relation.fromColor, baseAlpha * 0.82));
    gradient.addColorStop(1, rgba(relation.toColor, baseAlpha * 0.72));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = gradient;
    ctx.lineWidth = relation.width * (0.72 + emphasis * 0.56);
    ctx.beginPath();
    for (let index = 0; index <= lastIndex; index += 1) {
      const point = points[index];
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // A fine inner core line keeps the connection legible without neon bloom.
    ctx.strokeStyle = rgba(relation.toColor, baseAlpha * 0.56);
    ctx.lineWidth = Math.max(0.38, relation.width * 0.38);
    ctx.setLineDash([2, 9]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (trim > 0.78) {
      this.drawRelationArrow(relation, alpha * emphasis * smoothstep(0.78, 0.96, trim));
    }

    const strongFocus = emphasis > 1.2;
    const motionSpeed = this.motion === 'full' ? 1 : 0.44;
    const particleCount =
      this.motion === 'static' ? 0 : this.motion === 'low' ? 2 : strongFocus ? 6 : 4;
    if (particleCount > 0 && trim > 0.985) {
      for (let index = 0; index < particleCount; index += 1) {
        const offset = (relation.phase + index / particleCount) % 1;
        const speed = strongFocus ? 0.074 : 0.055;
        const t = (this.clock * speed * motionSpeed + offset) % 1;
        const point = pointAtSamples(points, t);
        const fade = Math.sin(t * Math.PI);
        const size = strongFocus ? 7.2 : 4.9;
        const trailSpan = strongFocus ? 0.043 : 0.018;
        this.drawGlowSprite(
          ctx,
          relation.toColor,
          point.x,
          point.y,
          size * (1 + emphasis * 0.35),
          alpha * emphasis * fade * 0.9,
          true,
        );
        const trail = pointAtSamples(points, Math.max(0, t - trailSpan));
        const trailGradient = ctx.createLinearGradient(trail.x, trail.y, point.x, point.y);
        trailGradient.addColorStop(0, rgba(relation.toColor, 0));
        trailGradient.addColorStop(
          1,
          rgba(strongFocus ? '#FFC08E' : relation.toColor, (strongFocus ? 0.38 : 0.26) * alpha * emphasis * fade),
        );
        ctx.strokeStyle = trailGradient;
        ctx.lineWidth = strongFocus ? 1.7 : 1.1;
        ctx.beginPath();
        ctx.moveTo(trail.x, trail.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();

        if (strongFocus) {
          const wisp = pointAtSamples(points, Math.max(0, t - trailSpan * 1.9));
          ctx.strokeStyle = rgba(relation.toColor, 0.1 * alpha * emphasis * fade);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(wisp.x, wisp.y);
          ctx.lineTo(trail.x, trail.y);
          ctx.stroke();
        }
      }

      // One larger wave links focus and neighbours on the same hub rhythm.
      if (strongFocus && this.motion !== 'static') {
        const pulseT = ((this.clock * 0.046 + relation.phase + 0.32) % 1 + 1) % 1;
        const pulsePoint = pointAtSamples(points, pulseT);
        const pulseFade = Math.sin(pulseT * Math.PI);
        this.drawGlowSprite(
          ctx,
          '#FFD1A8',
          pulsePoint.x,
          pulsePoint.y,
          23,
          0.28 * alpha * pulseFade,
          true,
        );
        const pulseTail = pointAtSamples(points, Math.max(0, pulseT - 0.08));
        ctx.strokeStyle = rgba('#FFD1A8', 0.16 * alpha * pulseFade);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pulseTail.x, pulseTail.y);
        ctx.lineTo(pulsePoint.x, pulsePoint.y);
        ctx.stroke();
      }
    } else if (particleCount === 0 && trim > 0.985) {
      for (const t of [0.35, 0.68]) {
        const point = pointAtSamples(points, t);
        ctx.fillStyle = rgba(relation.toColor, 0.3 * alpha * emphasis);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.15, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawRelationArrow(relation: Relation, alpha: number) {
    const ctx = this.context;
    const t = 0.69;
    const point = pointAtSamples(relation.points, t);
    const ahead = pointAtSamples(relation.points, Math.min(1, t + 0.035));
    const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x);
    const opacity = clamp(alpha * 0.25, 0, 0.35);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.strokeStyle = rgba(relation.toColor, opacity);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-4.2, -3.2);
    ctx.lineTo(0, 0);
    ctx.lineTo(-4.2, 3.2);
    ctx.stroke();
    ctx.restore();
  }

  private drawCore(alpha: number, focusKey: string | null) {
    const ctx = this.context;
    const time = this.clock;
    const breath = Math.sin(time * 0.56);
    const slowBreath = Math.sin(time * 0.31 + 1.4);
    const breathing = 1 + breath * 0.018 + slowBreath * 0.007;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.56 - 0.7);
    const focusBoost = focusKey === 'core' ? 0.06 : 0;
    const zoom = this.camera.zoom;
    const coreAlpha = alpha * (this.motion === 'low' ? 0.9 : 1);

    ctx.save();
    ctx.translate(CORE.x, CORE.y);
    ctx.scale(breathing, breathing);
    ctx.globalCompositeOperation = 'lighter';

    // Broad atmospheric bloom, deliberately asymmetric. Two slow, offset
    // breathing cycles keep the halo alive without a visible pulse.
    this.drawGlowSprite(
      ctx,
      '#E97B35',
      34,
      10,
      620 + breath * 20 + slowBreath * 10,
      (0.36 + breath * 0.018 + slowBreath * 0.012) * coreAlpha,
      true,
    );
    this.drawGlowSprite(ctx, '#F6B072', -22, -16, 310 + slowBreath * 12, (0.3 + breath * 0.02) * coreAlpha, true);
    this.drawGlowSprite(ctx, '#37657A', -150, 40, 640, 0.14 * coreAlpha, true);

    // Low-frequency energy ripples.
    const rippleStrength = this.motion === 'static' ? 0 : 1;
    for (let index = 0; index < 3; index += 1) {
      const progress = ((time * 0.045 + index / 3) % 1 + 1) % 1;
      const radius = CORE_RADIUS * (1.35 + progress * 2.15);
      const opacity = Math.pow(1 - progress, 2.4) * 0.12 * alpha * rippleStrength;
      if (opacity <= 0.002) continue;
      ctx.strokeStyle = rgba('#F2A66F', opacity);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
    }

    // Orbital rings with sparse, elegant traffic.
    const orbitConfigs = [
      { rx: 113, ry: 43, rotation: -0.48, speed: 0.03, count: 4, color: '#F5C39B' },
      { rx: 151, ry: 53, rotation: 0.55, speed: -0.022, count: 5, color: '#E88A4E' },
    ];
    for (const [ringIndex, ring] of orbitConfigs.entries()) {
      ctx.save();
      ctx.rotate(ring.rotation);
      ctx.strokeStyle = rgba(ring.color, 0.12 * alpha);
      ctx.lineWidth = 0.72;
      ctx.beginPath();
      ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, TAU);
      ctx.stroke();

      const arcStart = time * ring.speed + ringIndex * 1.7;
      ctx.strokeStyle = rgba(ring.color, (0.32 + focusBoost) * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, ring.rx, ring.ry, 0, arcStart, arcStart + 0.52);
      ctx.stroke();

      for (let index = 0; index < ring.count; index += 1) {
        const angle =
          time * ring.speed * (1.9 + index * 0.06) + (index / ring.count) * TAU + ringIndex;
        const px = Math.cos(angle) * ring.rx;
        const py = Math.sin(angle) * ring.ry;
        const particleAlpha = (0.24 + (index % 3) * 0.12) * alpha;
        ctx.fillStyle = rgba(ring.color, particleAlpha);
        ctx.beginPath();
        ctx.arc(px, py, index === 0 ? 1.5 : 0.9, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // The sphere itself.
    const sphereGradient = ctx.createRadialGradient(
      -CORE_RADIUS * 0.28,
      -CORE_RADIUS * 0.34,
      CORE_RADIUS * 0.05,
      0,
      0,
      CORE_RADIUS * 1.08,
    );
    sphereGradient.addColorStop(0, 'rgba(255, 250, 238, 0.98)');
    sphereGradient.addColorStop(0.12, 'rgba(255, 229, 198, 0.98)');
    sphereGradient.addColorStop(0.34, 'rgba(245, 162, 93, 0.96)');
    sphereGradient.addColorStop(0.62, 'rgba(215, 99, 44, 0.92)');
    sphereGradient.addColorStop(0.84, 'rgba(105, 47, 28, 0.9)');
    sphereGradient.addColorStop(1, 'rgba(19, 13, 12, 0.96)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = sphereGradient;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS, 0, TAU);
    ctx.fill();

    // A dark shoulder gives it volume instead of reading as a flat disc.
    const shade = ctx.createRadialGradient(
      CORE_RADIUS * 0.52,
      CORE_RADIUS * 0.58,
      CORE_RADIUS * 0.1,
      0,
      0,
      CORE_RADIUS * 1.34,
    );
    shade.addColorStop(0, 'rgba(3, 6, 9, 0.76)');
    shade.addColorStop(0.48, 'rgba(3, 6, 9, 0.34)');
    shade.addColorStop(1, 'rgba(3, 6, 9, 0)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS, 0, TAU);
    ctx.fill();

    // Bright inner filaments travel just below the surface.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS - 1.2, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let index = 0; index < 3; index += 1) {
      const drift = time * (0.035 + index * 0.009) * (index % 2 ? -1 : 1);
      ctx.save();
      ctx.rotate(drift + index * 0.92);
      ctx.strokeStyle = rgba(index % 2 ? '#FFDEB8' : '#F4A364', 0.12 + index * 0.025);
      ctx.lineWidth = 0.75 + index * 0.12;
      ctx.beginPath();
      ctx.ellipse(0, 0, CORE_RADIUS * (0.56 + index * 0.085), CORE_RADIUS * (0.16 + index * 0.07), -0.25, 0.13 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
    // A dark, quiet core inside the luminous shell.
    const innerVoid = ctx.createRadialGradient(0, 0, 0, 0, 0, CORE_RADIUS * 0.6);
    innerVoid.addColorStop(0, 'rgba(55, 20, 10, 0.22)');
    innerVoid.addColorStop(0.56, 'rgba(44, 18, 12, 0.12)');
    innerVoid.addColorStop(1, 'rgba(44, 18, 12, 0)');
    ctx.fillStyle = innerVoid;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS * 0.6, 0, TAU);
    ctx.fill();

    // Slow inner energy iris: counter-rotating arcs and a few warm motes keep
    // the interior alive without adding a particle cloud.
    ctx.globalCompositeOperation = 'lighter';
    for (let index = 0; index < 2; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1;
      ctx.save();
      ctx.rotate(time * (0.032 + index * 0.013) * direction + index * 1.9);
      ctx.strokeStyle = rgba(index === 1 ? '#FFE3C6' : '#F3A268', (0.13 - index * 0.03) * alpha);
      ctx.lineWidth = 0.65 + index * 0.1;
      ctx.setLineDash(index === 0 ? [10, 18] : [3, 14]);
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        CORE_RADIUS * (0.34 + index * 0.15),
        CORE_RADIUS * (0.15 + index * 0.085),
        -0.3 + index * 0.24,
        0.12 * Math.PI,
        1.12 * Math.PI,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    for (let index = 0; index < 3; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1;
      const angle = time * (0.1 + index * 0.026) * direction + index * 2.35;
      const radius = CORE_RADIUS * (0.38 + index * 0.11);
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius * 0.52;
      const trailAngle = angle - direction * 0.2;
      const tx = Math.cos(trailAngle) * radius;
      const ty = Math.sin(trailAngle) * radius * 0.52;
      ctx.strokeStyle = rgba('#FFD2A8', (0.16 + index * 0.04) * alpha);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();
      this.drawGlowSprite(ctx, '#FFCEA1', px, py, 13 + index * 3, (0.2 + index * 0.05) * alpha, true);
      ctx.fillStyle = rgba('#FFF2E2', 0.7 * alpha);
      ctx.beginPath();
      ctx.arc(px, py, 0.9 + index * 0.15, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // A crescent rim + fine lens arcs.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#FFD9B4', (0.34 + pulse * 0.12) * alpha);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS + 0.4, Math.PI * 0.86, Math.PI * 1.94);
    ctx.stroke();
    ctx.strokeStyle = rgba('#EE7D2C', 0.25 * alpha);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS + 7, Math.PI * 0.92, Math.PI * 1.42);
    ctx.stroke();

    ctx.save();
    ctx.rotate(time * 0.014);
    ctx.strokeStyle = rgba('#F4C49D', 0.13 * alpha);
    ctx.lineWidth = 0.62;
    ctx.setLineDash([20, 17, 2, 17]);
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS + 25, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // A warm central glint.
    this.drawGlowSprite(ctx, '#FFF4E1', -CORE_RADIUS * 0.17, -CORE_RADIUS * 0.18, 88, (0.26 + pulse * 0.05) * alpha, true);

    // Front arcs cross the sphere, giving the orbit real spatial depth.
    ctx.save();
    ctx.rotate(-0.48);
    ctx.strokeStyle = rgba('#FFD2A9', 0.24 * alpha);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 113, 43, 0, 0.05 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // A restrained crosshair under the core anchors the composition.
    ctx.save();
    ctx.translate(CORE.x, CORE.y);
    ctx.strokeStyle = rgba('#D8E3EC', 0.15 * alpha);
    ctx.lineWidth = 0.55;
    const tick = 7 + 2 * zoom;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const x1 = Math.cos(angle) * (CORE_RADIUS + 19);
      const y1 = Math.sin(angle) * (CORE_RADIUS + 19);
      const x2 = Math.cos(angle) * (CORE_RADIUS + 19 + tick);
      const y2 = Math.sin(angle) * (CORE_RADIUS + 19 + tick);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCoreCaption(alpha: number) {
    const ctx = this.context;
    const x = CORE.x;
    const y = CORE.y + 174;
    ctx.save();
    ctx.globalAlpha = 1;
    this.drawLabelScrim(x, y + 18, 360, 136, alpha * 0.9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba('#EE7D2C', 0.94 * alpha);
    ctx.font = `500 9px ${FONT_MONO}`;
    ctx.fillText('D A C H U A N   C O R E', x, y);
    ctx.fillStyle = `rgba(234, 241, 244, ${0.7 * alpha})`;
    ctx.font = `400 10px ${FONT_SANS}`;
    ctx.fillText('软件体系核心', x, y + 21);
    ctx.strokeStyle = rgba('#EE7D2C', 0.34 * alpha);
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(x - 100, y + 38);
    ctx.lineTo(x - 28, y + 38);
    ctx.moveTo(x + 28, y + 38);
    ctx.lineTo(x + 100, y + 38);
    ctx.stroke();
    ctx.restore();
  }

  private drawSystem(
    system: AtlasSystem,
    index: number,
    alpha: number,
    focusKey: string | null,
    time: number,
  ) {
    const ctx = this.context;
    const hover = this.hoverLevels.get(`system:${system.id}`) ?? 0;
    const selected = this.selectedSystem === system.id;
    const isFocus = focusKey === `system:${system.id}`;
    // Dimmed neighbours stay clearly legible instead of dropping into the dust.
    const dimmed = focusKey && !isFocus ? 0.68 : 1;
    const interactiveAlpha = alpha * dimmed * (1 + hover * 0.08);
    const position = system.position;
    const isPrimary = system.id === 'nexus';
    const radial = isPrimary ? 1.1 : 1;
    const nodeScale = 1 + hover * 0.055 + (selected ? 0.025 : 0);
    const motionFactor = this.motion === 'static' ? 0 : 1;
    const breath =
      this.motion === 'static' ? 0.5 : 0.5 + 0.5 * Math.sin(time * 0.62 + index * 2.1);

    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.scale(nodeScale, nodeScale);
    ctx.globalAlpha = interactiveAlpha;

    ctx.globalCompositeOperation = 'lighter';
    this.drawGlowSprite(
      ctx,
      system.color,
      0,
      0,
      (196 + breath * 18) * radial,
      (0.15 + breath * 0.035 + hover * 0.11) * interactiveAlpha,
      true,
    );
    this.drawGlowSprite(ctx, system.colorSoft, 0, 0, 300 + breath * 12, (0.05 + breath * 0.012) * interactiveAlpha, true);

    const orbitRotation = index * 0.8 + (this.motion === 'static' ? 0 : time * 0.005);
    const rings = [
      { rx: 54, ry: 19, rotation: orbitRotation - 0.36, speed: 0.12, opacity: 0.22 },
      { rx: 74 * radial, ry: 25 * radial, rotation: orbitRotation + 0.64, speed: -0.07, opacity: 0.13 },
    ];

    if (hover > 0.02 || selected) {
      ctx.save();
      ctx.rotate(orbitRotation);
      ctx.strokeStyle = rgba(system.color, (0.2 + hover * 0.36) * alpha);
      ctx.lineWidth = 0.65;
      ctx.setLineDash([1.5, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, 50 + hover * 6, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    for (const [ringIndex, ring] of rings.entries()) {
      ctx.save();
      ctx.rotate(ring.rotation);
      ctx.strokeStyle = rgba(system.color, ring.opacity * interactiveAlpha);
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, TAU);
      ctx.stroke();

      const sparkCount = isPrimary ? 7 : 5;
      for (let sparkIndex = 0; sparkIndex < sparkCount; sparkIndex += 1) {
        const direction = sparkIndex % 2 === 0 ? 1 : -1;
        const angle =
          time * ring.speed * direction * motionFactor +
          (sparkIndex / sparkCount) * TAU +
          ringIndex * 0.8;
        const px = Math.cos(angle) * ring.rx;
        const py = Math.sin(angle) * ring.ry;
        const sparkAlpha = (0.24 + (sparkIndex % 3) * 0.15 + hover * 0.2) * interactiveAlpha;
        ctx.fillStyle = rgba(system.color, clamp(sparkAlpha, 0, 0.8));
        ctx.beginPath();
        ctx.arc(px, py, sparkIndex === 0 ? 1.3 : 0.8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // The luminous pearl.
    this.drawGlowSprite(ctx, system.color, 0, 0, 54 + hover * 22, (0.4 + hover * 0.22) * interactiveAlpha, true);
    ctx.fillStyle = rgba(system.color, 0.95 * interactiveAlpha);
    ctx.beginPath();
    ctx.arc(0, 0, isPrimary ? 5.8 : 4.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba('#FFF8EC', 0.9 * interactiveAlpha);
    ctx.beginPath();
    ctx.arc(-1, -1.2, isPrimary ? 2.2 : 1.7, 0, TAU);
    ctx.fill();

    if (isPrimary) {
      // A distinct orbital gate tells the eye this is the one enterable system.
      ctx.save();
      ctx.rotate(-0.52);
      ctx.strokeStyle = rgba(system.color, (0.34 + hover * 0.34) * interactiveAlpha);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(0, 0, 64, 28, 0, -0.18, 1.66);
      ctx.stroke();
      ctx.strokeStyle = rgba('#F4C39D', (0.22 + hover * 0.16) * interactiveAlpha);
      ctx.beginPath();
      ctx.ellipse(0, 0, 64, 28, 0, 1.95, 2.45);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // Typography stays upright while the galaxy rotates.
    this.drawSystemLabel(system, alpha, hover, selected, isPrimary, dimmed);
  }

  private drawSystemLabel(
    system: AtlasSystem,
    alpha: number,
    hover: number,
    selected: boolean,
    primary: boolean,
    dimmed: number,
  ) {
    const ctx = this.context;
    const gate =
      system.id === 'nexus' ? 1 - smoothstep(0.24, 0.52, this.viewMix) : 1;
    if (gate <= 0.003) return;
    const x = system.position.x;
    const labelTop = system.position.y + system.labelOffset;
    const accent = system.color;
    const textAlpha = alpha * gate * dimmed * (0.86 + hover * 0.14);
    const lineAlpha = alpha * gate * dimmed * (0.34 + hover * 0.5);

    ctx.save();
    ctx.globalAlpha = 1;
    this.drawLabelScrim(x, labelTop + 20, 316, 130, alpha * gate * dimmed * 0.86);
    ctx.strokeStyle = rgba(accent, lineAlpha);
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.moveTo(x, system.position.y + 40);
    ctx.lineTo(x, labelTop - 9);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(accent, (0.7 + hover * 0.22) * textAlpha);
    ctx.font = `500 8.7px ${FONT_MONO}`;
    ctx.fillText(`SYS · ${system.index}   /   ${system.latin}`, x, labelTop);

    ctx.fillStyle = `rgba(247, 248, 244, ${0.96 * textAlpha})`;
    ctx.font = `500 ${primary ? 18.5 : 17}px ${FONT_SANS}`;
    ctx.fillText(system.name, x, labelTop + 23);

    ctx.fillStyle = rgba(primary ? accent : '#DCE6EB', (0.68 + hover * 0.22) * textAlpha);
    ctx.font = `400 9.4px ${FONT_SANS}`;
    ctx.fillText(system.stat, x, labelTop + 43);

    if (selected || (hover > 0.24 && system.available)) {
      const chipWidth = primary ? 58 : 46;
      const chipY = labelTop + 56;
      ctx.strokeStyle = rgba(accent, (0.28 + hover * 0.24) * alpha);
      ctx.lineWidth = 0.55;
      roundRect(ctx, x - chipWidth / 2, chipY, chipWidth, 15, 7.5);
      ctx.stroke();
      ctx.fillStyle = rgba(accent, (0.68 + hover * 0.22) * alpha);
      ctx.font = `500 7px ${FONT_MONO}`;
      ctx.fillText(system.available ? 'ENTER' : 'SELECTED', x, chipY + 7.7);
    }
    ctx.restore();
  }

  private drawNexusGuides(alpha: number) {
    const ctx = this.context;
    ctx.save();
    ctx.translate(NEXUS_POSITION.x, NEXUS_POSITION.y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#8EA6B8', 0.07 * alpha);
    ctx.lineWidth = 0.65;
    ctx.setLineDash([1, 13]);
    ctx.beginPath();
    ctx.ellipse(0, 0, 374, 302, 0.1, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = rgba('#EE7D2C', 0.075 * alpha);
    ctx.beginPath();
    ctx.ellipse(0, 0, 154, 116, -0.24, 0, TAU);
    ctx.stroke();

    const rotations = [-0.65, 0.8];
    rotations.forEach((rotation, index) => {
      ctx.save();
      ctx.rotate(rotation);
      ctx.strokeStyle = rgba(index === 0 ? '#F1B884' : '#7CBCC7', 0.09 * alpha);
      ctx.beginPath();
      ctx.ellipse(0, 0, 268 + index * 34, 198 + index * 22, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  private drawNexusHub(alpha: number, focusKey: string | null) {
    const ctx = this.context;
    const hover = focusKey === 'hub' ? 1 : 0;
    const time = this.motion === 'static' ? 0 : this.clock;
    const arrival = smoothstep(0.08, 0.82, this.viewMix);
    const hubScale = 0.7 + easeOutCubic(arrival) * 0.3 + hover * 0.02;
    const breath = this.motion === 'static' ? 0.5 : 0.5 + 0.5 * Math.sin(time * 0.52);
    const focusLive = this.activeModule !== null;

    ctx.save();
    ctx.translate(NEXUS_POSITION.x, NEXUS_POSITION.y);
    ctx.save();
    ctx.scale(hubScale, hubScale);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlowSprite(ctx, '#EE7D2C', 0, 0, 340 + breath * 22, 0.28 + breath * 0.035, true);
    this.drawGlowSprite(ctx, '#F3B98D', 0, 0, 122, 0.19 + breath * 0.03 + hover * 0.06, true);

    const rotation = this.motion === 'static' ? 0.3 : time * 0.026;
    ctx.save();
    ctx.rotate(rotation);
    ctx.strokeStyle = rgba('#EE7D2C', 0.34);
    ctx.lineWidth = 0.75;
    ctx.setLineDash([16, 13]);
    ctx.beginPath();
    ctx.arc(0, 0, 61, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // A single slow energy ripple leaves the hub, giving the module layer a
    // heartbeat without an expanding particle wall.
    if (this.motion !== 'static') {
      const rippleProgress = ((time * 0.07) % 1 + 1) % 1;
      const rippleRadius = 61 + rippleProgress * 58;
      ctx.strokeStyle = rgba('#F3B98D', (1 - rippleProgress) ** 2 * 0.17);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(0, 0, rippleRadius, 0, TAU);
      ctx.stroke();
    }

    ctx.strokeStyle = rgba('#F5D6BE', 0.25);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, 43, 0, TAU);
    ctx.stroke();

    for (let index = 0; index < 4; index += 1) {
      const angle = rotation * 0.4 + index * (TAU / 4);
      ctx.strokeStyle = rgba('#EE7D2C', 0.58);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 61, Math.sin(angle) * 61);
      ctx.lineTo(Math.cos(angle) * 70, Math.sin(angle) * 70);
      ctx.stroke();
    }

    for (let index = 0; index < 3; index += 1) {
      const angle = -rotation * 0.8 + index * (TAU / 3) + 0.4;
      const px = Math.cos(angle) * 61;
      const py = Math.sin(angle) * 61;
      this.drawGlowSprite(ctx, '#FFD7B4', px, py, 15, (focusLive ? 0.32 : 0.22) * alpha, true);
      ctx.fillStyle = rgba('#FFF3E4', 0.68 * alpha);
      ctx.beginPath();
      ctx.arc(px, py, 1, 0, TAU);
      ctx.fill();
    }

    this.drawGlowSprite(ctx, '#FFF1E4', 0, 0, 50 + breath * 4, 0.35 + breath * 0.03, true);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#F6DDC6';
    ctx.beginPath();
    ctx.arc(0, 0, 5.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFF9F1';
    ctx.beginPath();
    ctx.arc(-1.2, -1.4, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();

    const labelGate = smoothstep(0.54, 0.9, this.viewMix);
    if (labelGate > 0.003) {
      ctx.globalAlpha = 1;
      this.drawLabelScrim(0, 105, 300, 92, alpha * labelGate * 0.88);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba('#EE7D2C', 0.94 * alpha * labelGate);
      ctx.font = `500 8.2px ${FONT_MONO}`;
      ctx.fillText('N E X U S   H U B', 0, 96);
      ctx.fillStyle = `rgba(236, 241, 243, ${0.72 * alpha * labelGate})`;
      ctx.font = `400 9.5px ${FONT_SANS}`;
      ctx.fillText('模块中枢', 0, 113);
    }
    ctx.restore();
  }

  private moduleLayout(module: AtlasModule, index: number) {
    const reveal = smoothstep(0.34 + index * 0.028, 0.94, this.viewMix);
    const progress = easeOutCubic(reveal);
    const start = NEXUS_POSITION;
    const target = {
      x: NEXUS_POSITION.x + module.offset.x,
      y: NEXUS_POSITION.y + module.offset.y,
    };
    const angle = Math.atan2(module.offset.y, module.offset.x);
    const arc = Math.sin(Math.PI * progress) * (index % 2 === 0 ? -20 : 20);
    const position = {
      x: lerp(start.x, target.x, progress) - Math.sin(angle) * arc,
      y: lerp(start.y, target.y, progress) + Math.cos(angle) * arc,
    };
    return { reveal, progress, position };
  }

  private moduleBaseRotation(index: number, time: number) {
    return index * 1.25 + time * 0.012 * (index % 2 === 0 ? 1 : -1);
  }

  private drawModuleDecorations(
    module: AtlasModule,
    moduleAlpha: number,
    index: number,
    layer: 'back' | 'front',
    time: number,
  ) {
    const ctx = this.context;
    const decoration = DECORATION_BY_MODULE[module.id];
    if (!decoration) return;
    const baseRotation = this.moduleBaseRotation(index, time);

    ctx.save();
    ctx.rotate(baseRotation);
    ctx.globalAlpha = 1;
    if (layer === 'back') {
      for (const orbit of decoration.orbits) {
        ctx.strokeStyle = rgba(module.color, orbit.opacity * moduleAlpha * 1.08);
        ctx.lineWidth = 0.58;
        ctx.setLineDash([1.2, 7.5]);
        ctx.beginPath();
        ctx.ellipse(0, 0, orbit.rx, orbit.ry, orbit.rotation, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const satellite of decoration.satellites) {
      const orbit = decoration.orbits[satellite.orbit];
      const angle = satellite.phase * TAU + time * orbit.speed;
      const front = Math.sin(angle) > 0;
      if (front !== (layer === 'front')) continue;
      const px = Math.cos(angle) * orbit.rx;
      const py = Math.sin(angle) * orbit.ry;
      const tangentX = -Math.sin(angle) * orbit.rx;
      const tangentY = Math.cos(angle) * orbit.ry;
      const tangentLength = Math.hypot(tangentX, tangentY) || 1;
      const direction = Math.sign(orbit.speed) || 1;
      const trail = 7 + satellite.size * 5;
      ctx.strokeStyle = rgba(module.color, satellite.brightness * moduleAlpha * 0.38);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(
        px - (tangentX / tangentLength) * trail * direction,
        py - (tangentY / tangentLength) * trail * direction,
      );
      ctx.lineTo(px, py);
      ctx.stroke();

      this.drawGlowSprite(
        ctx,
        module.color,
        px,
        py,
        14 + satellite.size * 6,
        satellite.brightness * moduleAlpha * (front ? 0.5 : 0.3),
        true,
      );
      if (satellite.shape === 'shard') {
        const shardAngle = Math.atan2(tangentY, tangentX);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(shardAngle);
        ctx.fillStyle = rgba('#F0F5F4', satellite.brightness * moduleAlpha * 0.94);
        ctx.beginPath();
        ctx.moveTo(satellite.size * 1.8, 0);
        ctx.lineTo(0, satellite.size * 0.55);
        ctx.lineTo(-satellite.size * 1.4, 0);
        ctx.lineTo(0, -satellite.size * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = rgba('#F4F8F7', satellite.brightness * moduleAlpha * 1);
        ctx.beginPath();
        ctx.arc(px, py, satellite.size * (satellite.shape === 'mote' ? 0.9 : 0.72), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawModule(
    module: AtlasModule,
    index: number,
    alpha: number,
    focusKey: string | null,
  ) {
    const ctx = this.context;
    const { reveal, progress: spawnProgress, position } = this.moduleLayout(module, index);
    if (reveal <= 0.002) return;

    const hover = this.hoverLevels.get(`module:${module.id}`) ?? 0;
    const isFocus = focusKey === `module:${module.id}`;
    const isActive = this.activeModule === module.id;
    // Neighbours stay present while the focus module opens; they recede rather
    // than disappearing.
    const dimmed = focusKey && !isFocus ? (isActive ? 1 : 0.58) : 1;
    const time = this.motion === 'static' ? 0 : this.clock;
    const moduleAlpha = alpha * reveal * dimmed;
    const primaryFactor = isActive ? 1.12 : 1;
    const scale = (0.72 + spawnProgress * 0.28) * (1 + hover * 0.05);
    const baseRotation = this.moduleBaseRotation(index, time);
    const breath =
      this.motion === 'static' ? 0.5 : 0.5 + 0.5 * Math.sin(time * 0.68 + index * 1.7);

    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = moduleAlpha;
    ctx.globalCompositeOperation = 'lighter';

    this.drawGlowSprite(
      ctx,
      module.color,
      0,
      0,
      (214 + breath * 18) * primaryFactor,
      (0.12 + breath * 0.035 + hover * 0.09) * moduleAlpha,
      true,
    );
    this.drawGlowSprite(ctx, '#9AB3C3', -14, -8, 270, 0.035 * moduleAlpha, true);

    this.drawModuleDecorations(module, moduleAlpha, index, 'back', time);

    ctx.save();
    ctx.rotate(baseRotation);
    ctx.strokeStyle = rgba(module.color, (0.16 + hover * 0.2) * moduleAlpha);
    ctx.lineWidth = 0.65;
    ctx.setLineDash([1.5, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.rotate(baseRotation + 0.7);
    ctx.strokeStyle = rgba(module.color, (0.2 + hover * 0.18) * moduleAlpha);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(0, 0, 64, 22, 0, 0, TAU);
    ctx.stroke();
    const sparks = this.motion === 'static' ? 2 : 4;
    for (let spark = 0; spark < sparks; spark += 1) {
      const angle = time * 0.09 * (spark % 2 === 0 ? 1 : -0.8) + (spark / sparks) * TAU;
      const px = Math.cos(angle) * 64;
      const py = Math.sin(angle) * 22;
      ctx.fillStyle = rgba(module.color, (0.35 + hover * 0.2) * moduleAlpha);
      ctx.beginPath();
      ctx.arc(px, py, 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (isActive) {
      ctx.save();
      ctx.rotate(-time * 0.06);
      ctx.strokeStyle = rgba(module.color, 0.46 * alpha);
      ctx.lineWidth = 0.8;
      ctx.setLineDash([19, 10, 3, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, 53 + Math.sin(time * 0.9) * 2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // A slow outward energy wave marks the open focus.
      if (this.motion !== 'static') {
        const focusProgress = ((time * 0.22) % 1 + 1) % 1;
        ctx.strokeStyle = rgba(module.color, (1 - focusProgress) ** 2 * 0.28 * alpha);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 48 + focusProgress * 44, 0, TAU);
        ctx.stroke();
      }
    }

    // Small orbital marker for each module.
    this.drawGlowSprite(
      ctx,
      module.color,
      0,
      0,
      74 + breath * 6,
      (0.34 + breath * 0.04 + hover * 0.26) * moduleAlpha,
      true,
    );
    ctx.fillStyle = rgba('#080A0D', 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(module.color, (0.58 + hover * 0.32) * moduleAlpha);
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, TAU);
    ctx.stroke();

    this.drawModuleIcon(module, moduleAlpha * (0.74 + hover * 0.26));

    this.drawModuleDecorations(module, moduleAlpha, index, 'front', time);
    ctx.restore();

    this.drawModuleLabel(module, position, alpha * reveal, hover, dimmed);
  }

  private drawModuleIcon(module: AtlasModule, alpha: number) {
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rgba('#F4F7F8', 0.86);
    ctx.fillStyle = rgba('#F4F7F8', 0.86);
    ctx.lineWidth = 1.15;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (module.icon === 'bars') {
      const heights = [5, 9, 13, 8];
      heights.forEach((height, index) => {
        const x = -5.4 + index * 3.5;
        ctx.beginPath();
        ctx.moveTo(x, 6.5);
        ctx.lineTo(x, 6.5 - height);
        ctx.stroke();
      });
      ctx.fillStyle = rgba(module.color, 0.8);
      ctx.beginPath();
      ctx.arc(7.3, -5.4, 1.2, 0, TAU);
      ctx.fill();
    } else if (module.icon === 'wave') {
      ctx.beginPath();
      for (let index = 0; index <= 20; index += 1) {
        const x = -8.5 + (index / 20) * 17;
        const envelope = Math.sin((index / 20) * Math.PI);
        const y = Math.sin((index / 20) * Math.PI * 4.1) * 4.2 * envelope;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (module.icon === 'orbit') {
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 4.4, -0.55, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(5.2, -4.1, 1.6, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-1.2, 0.6, 1.4, 0, TAU);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(-7.5, -2.2);
      ctx.lineTo(-7.5, -7);
      ctx.lineTo(-2.4, -7);
      ctx.moveTo(2.4, -7);
      ctx.lineTo(7.5, -7);
      ctx.lineTo(7.5, -2.2);
      ctx.moveTo(7.5, 2.2);
      ctx.lineTo(7.5, 7);
      ctx.lineTo(2.4, 7);
      ctx.moveTo(-2.4, 7);
      ctx.lineTo(-7.5, 7);
      ctx.lineTo(-7.5, 2.2);
      ctx.stroke();
      ctx.fillStyle = rgba(module.color, 0.9);
      ctx.beginPath();
      ctx.arc(0, 0, 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawModuleLabel(
    module: AtlasModule,
    position: Point,
    alpha: number,
    hover: number,
    dimmed: number,
  ) {
    const ctx = this.context;
    // Keep labels out of the early camera approach so no ghost typography
    // appears while the modules are still growing out of the hub.
    if (alpha < 0.12) return;
    const y = position.y + 76;
    const textAlpha = alpha * (dimmed > 0.9 ? 0.9 + hover * 0.1 : 0.74 + hover * 0.12);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    this.drawLabelScrim(position.x, y + 25, 252, 138, alpha * (dimmed > 0.9 ? 0.82 : 0.58));
    ctx.strokeStyle = rgba(module.color, (0.28 + hover * 0.34) * alpha * dimmed);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(position.x, position.y + 27);
    ctx.lineTo(position.x, y - 9);
    ctx.stroke();

    const active = this.activeModule === module.id;
    ctx.fillStyle = rgba(module.color, (0.78 + hover * 0.2) * textAlpha);
    ctx.font = `500 8.2px ${FONT_MONO}`;
    ctx.fillText(`MODULE ${module.index}`, position.x, y);

    ctx.fillStyle = `rgba(246, 248, 246, ${0.98 * textAlpha})`;
    ctx.font = `500 17px ${FONT_SANS}`;
    ctx.fillText(module.name, position.x, y + 20);

    ctx.fillStyle = rgba('#DFE8EC', 0.58 * textAlpha);
    ctx.font = `400 8.2px ${FONT_MONO}`;
    ctx.fillText(module.latin, position.x, y + 38);

    const label = active ? '详情已展开 · 模拟' : module.available ? '可查看详情 · 模拟' : 'P0 占位 · 模拟';
    ctx.fillStyle = rgba(module.color, (active ? 0.98 : module.available ? 0.86 : 0.6) * textAlpha);
    ctx.font = `400 8.8px ${FONT_SANS}`;
    ctx.fillText(label, position.x, y + 54);
    ctx.restore();
  }

  private updateHitAreas(homeAlpha: number, nexusAlpha: number) {
    const areas: HitArea[] = [];
    const settled = Math.abs(this.viewMix - this.viewMixTarget) < 0.06;
    if (!settled) {
      this.hitAreas = areas;
      return;
    }

    const scale = this.scale;
    if (this.view === 'universe' && homeAlpha > 0.75) {
      for (const system of SYSTEMS) {
        const screen = this.worldToScreen(system.position);
        const radius = 72 * scale;
        const labelTop = screen.y + system.labelOffset * scale;
        areas.push({
          kind: 'system',
          id: system.id,
          circle: { x: screen.x, y: screen.y, r: radius },
          rect: {
            x: screen.x - 160 * scale,
            y: labelTop - 12 * scale,
            width: 320 * scale,
            height: 96 * scale,
          },
        });
      }
    }

    if (this.view === 'nexus' && nexusAlpha > 0.8) {
      for (let index = 0; index < MODULES.length; index += 1) {
        const module = MODULES[index];
        if (this.activeModule && this.activeModule !== module.id) continue;
        const { position } = this.moduleLayout(module, index);
        const screen = this.worldToScreen(position);
        const radius = 74 * scale;
        areas.push({
          kind: 'module',
          id: module.id,
          circle: { x: screen.x, y: screen.y, r: radius },
          rect: {
            x: screen.x - 120 * scale,
            y: screen.y + 42 * scale,
            width: 240 * scale,
            height: 106 * scale,
          },
        });
      }
    }

    this.hitAreas = areas;
  }

  private getLabelScrim() {
    if (this.labelScrim) return this.labelScrim;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建文字底衬纹理。');
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(3, 6, 9, 0.64)');
    gradient.addColorStop(0.42, 'rgba(3, 6, 9, 0.42)');
    gradient.addColorStop(0.72, 'rgba(3, 6, 9, 0.14)');
    gradient.addColorStop(1, 'rgba(3, 6, 9, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this.labelScrim = canvas;
    return canvas;
  }

  private drawLabelScrim(x: number, y: number, width: number, height: number, alpha: number) {
    if (alpha <= 0.003) return;
    const ctx = this.context;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(this.getLabelScrim(), x - width / 2, y - height / 2, width, height);
    ctx.restore();
  }

  private drawGlowSprite(
    ctx: CanvasRenderingContext2D,
    color: string,
    x: number,
    y: number,
    diameter: number,
    alpha: number,
    additive = false,
  ) {
    if (alpha <= 0.002 || diameter <= 0) return;
    const sprite = this.getGlowSprite(color);
    const previousComposite = ctx.globalCompositeOperation;
    const previousAlpha = ctx.globalAlpha;
    if (additive) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(sprite, x - diameter / 2, y - diameter / 2, diameter, diameter);
    ctx.globalAlpha = previousAlpha;
    ctx.globalCompositeOperation = previousComposite;
  }

  private getGlowSprite(color: string) {
    const cached = this.glowCache.get(color);
    if (cached) return cached;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建辉光纹理。');
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 249, 239, 0.92)');
    gradient.addColorStop(0.06, rgba(color, 0.78));
    gradient.addColorStop(0.2, rgba(color, 0.34));
    gradient.addColorStop(0.48, rgba(color, 0.09));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this.glowCache.set(color, canvas);
    return canvas;
  }
}

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

export const isSystemId = (id: string): id is SystemId => id in SYSTEM_BY_ID;
export const isModuleId = (id: string): id is ModuleId => id in MODULE_BY_ID;

