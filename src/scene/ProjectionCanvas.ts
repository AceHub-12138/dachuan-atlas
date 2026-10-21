import { MODULE_BY_ID, type ModuleId } from '../data/atlas';
import {
  EVIDENCE_COLORS,
  type GraphProjection,
  type ProjectionEdge,
  type ProjectionNode,
} from '../architecture/projection';
import { clamp, mulberry32, pointAtSamples, rgba, sampleCubic } from './math';
import type { Point } from './math';
import type { MotionMode } from './AtlasScene';

/**
 * 关系投影画布。它只消费 GraphProjection，不接触标准数据集以外的原始图。
 *
 * 布局是确定性的：模块层固定构图，文件/符号层按焦点内 / 关联节点分环。
 * 切换层级、筛选或缩放时重建一次；绘制循环不重新聚合关系。
 */

export interface ProjectionSelection {
  nodeId: string | null;
  edgeId: string | null;
  pathNodeIds: string[];
  pathEdgeIds: string[];
}

export interface ProjectionCanvasMetrics {
  fps: number;
  frameMs: number;
  nodes: number;
  edges: number;
  rafActive: boolean;
}

export interface ProjectionCanvasOptions {
  canvas: HTMLCanvasElement;
  projection: GraphProjection;
  motion: MotionMode;
  selection?: Partial<ProjectionSelection>;
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  onBackgroundClick?: () => void;
  onMetrics?: (metrics: ProjectionCanvasMetrics) => void;
}

interface LayoutNode {
  node: ProjectionNode;
  x: number;
  y: number;
  radius: number;
  color: string;
}

interface LayoutEdge {
  edge: ProjectionEdge;
  points: Point[];
  mid: Point;
  normal: Point;
}

interface DecorativeStar {
  x: number;
  y: number;
  size: number;
  alpha: number;
}

const FONT_SANS =
  '"Space Grotesk", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const FONT_MONO = '"IBM Plex Mono", "SFMono-Regular", "Cascadia Code", Consolas, monospace';
const TAU = Math.PI * 2;
const EMPTY_SELECTION: ProjectionSelection = {
  nodeId: null,
  edgeId: null,
  pathNodeIds: [],
  pathEdgeIds: [],
};

function moduleColor(moduleId: ModuleId | null): string {
  if (moduleId && MODULE_BY_ID[moduleId]) return MODULE_BY_ID[moduleId].color;
  return '#A9B8C4';
}

function shortLabel(label: string, limit = 22): string {
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

export class ProjectionCanvasScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly options: ProjectionCanvasOptions;
  private readonly resizeObserver: ResizeObserver;

  private projection: GraphProjection;
  private motion: MotionMode;
  private selection: ProjectionSelection;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private layoutNodes: LayoutNode[] = [];
  private layoutEdges: LayoutEdge[] = [];
  private stars: DecorativeStar[] = [];

  private pointer = { x: 0, y: 0 };
  private hoverNodeId: string | null = null;
  private hoverEdgeId: string | null = null;

  private clock = 0;
  private lastTime = 0;
  private raf = 0;
  private loopRunning = false;
  private pendingFrame = false;
  private destroyed = false;
  private visible = true;

  private frameCount = 0;
  private metricsWindowStart = 0;
  private drawTimes: number[] = [];
  private lastMetricsAt = 0;

  private readonly boundPointerMove: (event: PointerEvent) => void;
  private readonly boundPointerLeave: () => void;
  private readonly boundClick: (event: MouseEvent) => void;
  private readonly boundVisibility: () => void;

  constructor(options: ProjectionCanvasOptions) {
    this.options = options;
    this.canvas = options.canvas;
    const context = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) throw new Error('无法初始化关系投影 Canvas。');
    this.context = context;
    this.projection = options.projection;
    this.motion = options.motion;
    this.selection = { ...EMPTY_SELECTION, ...options.selection };

    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerLeave = () => this.handlePointerLeave();
    this.boundClick = (event) => this.handleClick(event);
    this.boundVisibility = () => this.handleVisibility();

    this.canvas.addEventListener('pointermove', this.boundPointerMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.boundPointerLeave, { passive: true });
    this.canvas.addEventListener('click', this.boundClick);
    document.addEventListener('visibilitychange', this.boundVisibility);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
    this.startLoop();
  }

  setProjection(projection: GraphProjection) {
    if (this.projection === projection) return;
    this.projection = projection;
    this.hoverNodeId = null;
    this.hoverEdgeId = null;
    this.selection = {
      ...this.selection,
      nodeId: projection.nodes.some((node) => node.id === this.selection.nodeId)
        ? this.selection.nodeId
        : null,
      edgeId: projection.edges.some((edge) => edge.id === this.selection.edgeId)
        ? this.selection.edgeId
        : null,
    };
    this.buildLayout();
    this.canvas.style.cursor = 'default';
    this.requestRender();
  }

  setMotion(motion: MotionMode) {
    if (this.motion === motion) return;
    this.motion = motion;
    if (motion === 'static') {
      this.stopLoop();
      this.requestRender();
      this.publishIdleMetrics();
    } else {
      this.startLoop();
    }
  }

  setSelection(selection: Partial<ProjectionSelection>) {
    this.selection = { ...this.selection, ...selection };
    if (this.motion === 'static') this.requestRender();
  }

  getMetrics(): ProjectionCanvasMetrics {
    return {
      fps: 0,
      frameMs: 0,
      nodes: this.layoutNodes.length,
      edges: this.layoutEdges.length,
      rafActive: this.loopRunning,
    };
  }

  destroy() {
    this.destroyed = true;
    this.stopLoop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener('pointerleave', this.boundPointerLeave);
    this.canvas.removeEventListener('click', this.boundClick);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    this.layoutNodes = [];
    this.layoutEdges = [];
    this.stars = [];
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    if (Math.abs(width - this.width) < 0.5 && Math.abs(height - this.height) < 0.5) return;
    this.width = width;
    this.height = height;
    const nativeDpr = window.devicePixelRatio || 1;
    const dprCap = Math.max(1, 4096 / Math.max(width, height));
    this.dpr = Math.min(nativeDpr, 1.75, dprCap);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.buildStars();
    this.buildLayout();
    this.requestRender();
  }

  private buildStars() {
    const rng = mulberry32(0x0a7a5f1d);
    const count = clamp(Math.round((this.width * this.height) / 14000), 40, 180);
    const stars: DecorativeStar[] = [];
    for (let index = 0; index < count; index += 1) {
      stars.push({
        x: rng() * this.width,
        y: rng() * this.height,
        size: 0.3 + rng() * 0.95,
        alpha: 0.1 + rng() * 0.34,
      });
    }
    this.stars = stars;
  }

  private nodeRadius(node: ProjectionNode): number {
    if (node.level === 'module') return 21;
    if (node.level === 'file') return node.inFocus ? 12 : 10.5;
    return node.inFocus ? 7.2 : 6.2;
  }

  private buildLayout() {
    const nodes: LayoutNode[] = [];
    const cx = this.width / 2;
    // Leave room for the stage banner and the footer legend; labels below the
    // module nodes otherwise clip at 1440p.
    const cy = this.height / 2 + (this.projection.level === 'module' ? -14 : 4);
    const min = Math.min(this.width, this.height);

    if (this.projection.level === 'module') {
      const positions: Record<ModuleId, Point> = {
        data: { x: -0.32, y: -0.27 },
        voice: { x: 0.34, y: -0.23 },
        animation: { x: -0.3, y: 0.27 },
        canvas: { x: 0.35, y: 0.29 },
      };
      for (const node of this.projection.nodes) {
        const moduleId = node.moduleId;
        if (!moduleId || !positions[moduleId]) continue;
        nodes.push({
          node,
          x: cx + positions[moduleId].x * min,
          y: cy + positions[moduleId].y * min,
          radius: this.nodeRadius(node),
          color: moduleColor(moduleId),
        });
      }
    } else {
      const focus = this.projection.nodes.filter((node) => node.inFocus);
      const outer = this.projection.nodes.filter((node) => !node.inFocus);
      const rings: { radius: number; items: ProjectionNode[]; offset: number }[] = [];
      if (focus.length <= 10) {
        rings.push({ radius: min * 0.235, items: focus, offset: -Math.PI / 2 });
      } else {
        // Split only the crowded symbol ring; the file layer stays on one
        // balanced ring so the composition does not collapse toward center.
        const firstRing = Math.ceil(focus.length / 2);
        rings.push({ radius: min * 0.2, items: focus.slice(0, firstRing), offset: -Math.PI / 2 });
        rings.push({
          radius: min * 0.32,
          items: focus.slice(firstRing),
          offset: -Math.PI / 2 + 0.24,
        });
      }
      if (outer.length) {
        rings.push({ radius: min * 0.43, items: outer, offset: -Math.PI / 2 + 0.12 });
      }
      for (const ring of rings) {
        const step = TAU / Math.max(1, ring.items.length);
        ring.items.forEach((node, index) => {
          const angle = ring.offset + index * step;
          nodes.push({
            node,
            x: cx + Math.cos(angle) * ring.radius,
            y: cy + Math.sin(angle) * ring.radius,
            radius: this.nodeRadius(node),
            color: moduleColor(node.moduleId),
          });
        });
      }
    }

    const byId = new Map(nodes.map((layout) => [layout.node.id, layout]));
    const reciprocal = new Set(this.projection.edges.map((edge) => `${edge.from}>${edge.to}`));
    const edges: LayoutEdge[] = [];
    for (const edge of this.projection.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      const ux = dx / length;
      const uy = dy / length;
      const start = {
        x: from.x + ux * (from.radius + 7),
        y: from.y + uy * (from.radius + 7),
      };
      const end = {
        x: to.x - ux * (to.radius + 8),
        y: to.y - uy * (to.radius + 8),
      };
      const hasReverse = reciprocal.has(`${edge.to}>${edge.from}`);
      const sign = hasReverse ? (edge.from < edge.to ? 1 : -1) : 1;
      const bow = (this.projection.level === 'module' ? 44 : 20) * sign;
      const controlA = {
        x: from.x + dx * 0.32 + nx * bow * 0.6,
        y: from.y + dy * 0.32 + ny * bow * 0.6,
      };
      const controlB = {
        x: from.x + dx * 0.7 + nx * bow,
        y: from.y + dy * 0.7 + ny * bow,
      };
      const points = sampleCubic(start, controlA, controlB, end, 48);
      const mid = pointAtSamples(points, 0.5);
      const before = pointAtSamples(points, 0.46);
      const after = pointAtSamples(points, 0.54);
      const tx = after.x - before.x;
      const ty = after.y - before.y;
      const tangent = Math.hypot(tx, ty) || 1;
      edges.push({
        edge,
        points,
        mid,
        normal: { x: -ty / tangent, y: tx / tangent },
      });
    }

    this.layoutNodes = nodes;
    this.layoutEdges = edges;
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
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.clock += dt * (this.motion === 'low' ? 0.42 : 1);
    this.render(now);
    if (this.options.onMetrics && now - this.lastMetricsAt > 1000) {
      this.lastMetricsAt = now;
      this.emitMetrics(now);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private publishIdleMetrics() {
    if (!this.options.onMetrics) return;
    const average = this.drawTimes.length
      ? this.drawTimes.reduce((sum, value) => sum + value, 0) / this.drawTimes.length
      : 0;
    this.options.onMetrics({
      fps: 0,
      frameMs: Number(average.toFixed(2)),
      nodes: this.layoutNodes.length,
      edges: this.layoutEdges.length,
      rafActive: this.loopRunning,
    });
  }

  private emitMetrics(now: number) {
    if (!this.options.onMetrics) return;
    const windowMs = Math.max(1, now - this.metricsWindowStart);
    const fps = (this.frameCount * 1000) / windowMs;
    const average = this.drawTimes.length
      ? this.drawTimes.reduce((sum, value) => sum + value, 0) / this.drawTimes.length
      : 0;
    this.options.onMetrics({
      fps: Number(fps.toFixed(1)),
      frameMs: Number(average.toFixed(2)),
      nodes: this.layoutNodes.length,
      edges: this.layoutEdges.length,
      rafActive: this.loopRunning,
    });
    this.frameCount = 0;
    this.drawTimes = [];
    this.metricsWindowStart = now;
  }

  private handleVisibility() {
    this.visible = document.visibilityState === 'visible';
    if (!this.visible) this.stopLoop();
    else if (this.motion !== 'static') this.startLoop();
    else this.requestRender();
  }

  private handlePointerMove(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const node = this.findNodeAt(this.pointer.x, this.pointer.y);
    const edge = node ? null : this.findEdgeAt(this.pointer.x, this.pointer.y);
    const nextNode = node?.node.id ?? null;
    const nextEdge = edge?.edge.id ?? null;
    const changed = nextNode !== this.hoverNodeId || nextEdge !== this.hoverEdgeId;
    this.hoverNodeId = nextNode;
    this.hoverEdgeId = nextEdge;
    this.canvas.style.cursor = node || edge ? 'pointer' : 'default';
    if (changed && this.motion === 'static') this.requestRender();
  }

  private handlePointerLeave() {
    this.pointer = { x: -1, y: -1 };
    this.hoverNodeId = null;
    this.hoverEdgeId = null;
    this.canvas.style.cursor = 'default';
    if (this.motion === 'static') this.requestRender();
  }

  private handleClick(event: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = this.findNodeAt(x, y);
    if (node) {
      this.selection = { ...this.selection, nodeId: node.node.id, edgeId: null };
      this.options.onSelectNode?.(node.node.id);
      this.requestRender();
      return;
    }
    const edge = this.findEdgeAt(x, y);
    if (edge) {
      this.selection = { ...this.selection, edgeId: edge.edge.id, nodeId: null };
      this.options.onSelectEdge?.(edge.edge.id);
      this.requestRender();
      return;
    }
    this.options.onBackgroundClick?.();
  }

  private findNodeAt(x: number, y: number): LayoutNode | null {
    for (let index = this.layoutNodes.length - 1; index >= 0; index -= 1) {
      const layout = this.layoutNodes[index];
      if (Math.hypot(x - layout.x, y - layout.y) <= layout.radius + 8) return layout;
    }
    return null;
  }

  private findEdgeAt(x: number, y: number): LayoutEdge | null {
    let best: { edge: LayoutEdge; distance: number } | null = null;
    for (const edge of this.layoutEdges) {
      for (let index = 1; index < edge.points.length; index += 1) {
        const a = edge.points[index - 1];
        const b = edge.points[index];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0.0001) continue;
        const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared, 0, 1);
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const distance = Math.hypot(x - px, y - py);
        if (distance <= 7 && (!best || distance < best.distance)) best = { edge, distance };
      }
    }
    return best?.edge ?? null;
  }

  private render(now: number) {
    if (!this.width || !this.height) return;
    const start = performance.now();
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground();
    this.drawEdges();
    this.drawNodes();
    const drawMs = performance.now() - start;
    this.frameCount += 1;
    this.drawTimes.push(drawMs);
    if (this.drawTimes.length > 120) this.drawTimes.shift();
    this.lastTime = now;
  }

  private drawBackground() {
    const ctx = this.context;
    const cx = this.width / 2;
    const cy = this.height / 2 + 4;
    const min = Math.min(this.width, this.height);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, min * 0.62);
    gradient.addColorStop(0, 'rgba(20, 31, 38, 0.24)');
    gradient.addColorStop(0.55, 'rgba(7, 12, 16, 0.14)');
    gradient.addColorStop(1, 'rgba(3, 6, 9, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    for (const star of this.stars) {
      const pulse = this.motion === 'static' ? 1 : 0.72 + 0.28 * Math.sin(this.clock * 0.6 + star.x * 0.01);
      ctx.fillStyle = rgba('#DCE6EB', star.alpha * pulse);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, TAU);
      ctx.fill();
    }

    // Decorative orbital rings. They carry no data and never receive hits.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(142, 166, 184, 0.075)';
    ctx.lineWidth = 0.65;
    ctx.setLineDash([1, 12]);
    for (const [rx, ry, rotation] of [
      [min * 0.29, min * 0.22, -0.2],
      [min * 0.42, min * 0.34, 0.24],
    ] as [number, number, number][]) {
      ctx.save();
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);
    ctx.restore();

    if (this.projection.level === 'module') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(238, 125, 44, 0.7)';
      ctx.font = `500 8px ${FONT_MONO}`;
      ctx.fillText('P R O J E C T I O N', cx, cy - 16);
      ctx.fillStyle = 'rgba(246, 248, 246, 0.9)';
      ctx.font = `500 14px ${FONT_SANS}`;
      ctx.fillText('NEXUS', cx, cy + 3);
      ctx.fillStyle = 'rgba(220, 231, 236, 0.5)';
      ctx.font = `400 8px ${FONT_MONO}`;
      ctx.fillText('模块关系投影', cx, cy + 20);
    } else {
      // File and symbol layers already carry labels around the ring; a large
      // center caption would collide with the nearest nodes.
      ctx.strokeStyle = 'rgba(142, 166, 184, 0.16)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.2, 0, TAU);
      ctx.stroke();
    }
  }

  private drawEdges() {
    const ctx = this.context;
    const showBadges = this.layoutEdges.length <= 24;
    const selectedNode = this.selection.nodeId;

    for (const layout of this.layoutEdges) {
      const { edge, points, mid, normal } = layout;
      const isSelected = this.selection.edgeId === edge.id;
      const isPath = this.selection.pathEdgeIds.includes(edge.id);
      const isHover = this.hoverEdgeId === edge.id;
      const touchesSelection =
        !selectedNode || edge.from === selectedNode || edge.to === selectedNode;
      const dim = selectedNode && !touchesSelection ? 0.16 : 1;
      const density = this.layoutEdges.length > 28 ? 0.58 : 1;
      const emphasis = isSelected ? 1.9 : isPath ? 1.6 : isHover ? 1.35 : 1;
      const color = EVIDENCE_COLORS[edge.evidenceClass];
      const alpha = clamp(0.72 * emphasis * dim * density, 0.1, 1);
      const dashed =
        edge.evidenceClass === 'inferred'
          ? [5, 6]
          : edge.evidenceClass === 'unverified'
            ? [1, 5]
            : [];

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';

      if (isSelected || isPath) {
        ctx.strokeStyle = rgba('#F5C98B', 0.2 * dim);
        ctx.lineWidth = 7;
        this.traceEdge(points);
      }

      ctx.strokeStyle = 'rgba(3, 5, 7, 0.55)';
      ctx.lineWidth = 4;
      this.traceEdge(points);

      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = isSelected ? 2.3 : isPath ? 2 : isHover ? 1.8 : 1.15;
      ctx.setLineDash(dashed);
      this.traceEdge(points);
      ctx.setLineDash([]);

      if (isPath) {
        ctx.strokeStyle = 'rgba(245, 201, 139, 0.68)';
        ctx.lineWidth = 1.6;
        this.traceEdge(points);
      }

      if (edge.unverifiedCount > 0 && edge.evidenceClass !== 'unverified') {
        ctx.strokeStyle = rgba('#D98C8C', 0.52 * alpha);
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 7]);
        this.traceEdge(points);
        ctx.setLineDash([]);
      }

      if (edge.evidenceClass === 'ai-reviewed' || edge.evidenceCounts['ai-reviewed'] > 0) {
        const marker = pointAtSamples(points, 0.34);
        ctx.save();
        ctx.translate(marker.x, marker.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(7, 10, 14, 0.88)';
        ctx.strokeStyle = rgba('#B9A7FF', 0.85 * alpha);
        ctx.lineWidth = 0.8;
        ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
        ctx.strokeRect(-2.8, -2.8, 5.6, 5.6);
        ctx.restore();
      }

      if (showBadges || isSelected || isHover) {
        if (edge.unverifiedCount > 0) {
          const x = mid.x - normal.x * 12;
          const y = mid.y - normal.y * 12;
          ctx.fillStyle = 'rgba(5, 8, 11, 0.92)';
          ctx.strokeStyle = rgba('#D98C8C', 0.85 * dim);
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = rgba('#EFB7B7', 0.95 * dim);
          ctx.font = `500 7.5px ${FONT_MONO}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', x, y + 0.3);
        }
        const x = mid.x + normal.x * 12;
        const y = mid.y + normal.y * 12;
        const label = `${edge.count}`;
        ctx.font = `500 7.5px ${FONT_MONO}`;
        const width = ctx.measureText(label).width + 8;
        ctx.fillStyle = 'rgba(5, 8, 11, 0.88)';
        ctx.strokeStyle = rgba(color, 0.4 * dim);
        ctx.lineWidth = 0.55;
        this.roundRect(x - width / 2, y - 6, width, 12, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = rgba(color, 0.92 * dim);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 0.3);
      }

      ctx.restore();
    }
  }

  private traceEdge(points: Point[]) {
    const ctx = this.context;
    ctx.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }

  private drawNodes() {
    const ctx = this.context;
    const pathNodes = new Set(this.selection.pathNodeIds);
    for (const layout of this.layoutNodes) {
      const { node, x, y, radius, color } = layout;
      const selected = this.selection.nodeId === node.id;
      const path = pathNodes.has(node.id);
      const hovered = this.hoverNodeId === node.id;
      const dim = this.selection.nodeId && !selected && !path ? 0.5 : 1;
      const pulse = this.motion === 'static' ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 0.9 + x * 0.01);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, (0.035 + pulse * 0.025) * dim);
      ctx.beginPath();
      ctx.arc(x, y, radius * 2.7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(color, (0.06 + pulse * 0.04) * dim);
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.55, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba('#06090C', 0.92);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = rgba(color, (selected || hovered ? 0.98 : 0.62) * dim);
      ctx.lineWidth = selected ? 1.7 : node.level === 'module' ? 1.25 : 0.95;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.stroke();

      if (node.distributed) {
        ctx.strokeStyle = rgba(color, 0.4 * dim);
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.arc(x, y, radius + 6, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (selected || path) {
        ctx.strokeStyle = rgba(selected ? '#F5C98B' : '#8DE3B0', 0.82 * dim);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, radius + 9 + pulse * 2, 0, TAU);
        ctx.stroke();
      }

      this.drawNodeGlyph(node, x, y, color, dim);
      this.drawNodeLabel(node, x, y, radius, color, dim, selected || hovered);
      ctx.restore();
    }
  }

  private drawNodeGlyph(node: ProjectionNode, x: number, y: number, color: string, dim: number) {
    const ctx = this.context;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = dim;
    ctx.strokeStyle = 'rgba(244, 247, 248, 0.9)';
    ctx.fillStyle = rgba(color, 0.95);
    ctx.lineWidth = 1;

    if (node.level === 'module') {
      const moduleId = node.moduleId;
      if (moduleId === 'data') {
        [-4.8, -1.6, 1.6, 4.8].forEach((offset, index) => {
          const height = [4, 8, 11, 6][index];
          ctx.beginPath();
          ctx.moveTo(offset, 5);
          ctx.lineTo(offset, 5 - height);
          ctx.stroke();
        });
      } else if (moduleId === 'voice') {
        ctx.beginPath();
        for (let index = 0; index <= 16; index += 1) {
          const px = -7 + (index / 16) * 14;
          const envelope = Math.sin((index / 16) * Math.PI);
          const py = Math.sin((index / 16) * Math.PI * 3.6) * 3.8 * envelope;
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else if (moduleId === 'animation') {
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 3.6, -0.5, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(4.4, -3.2, 1.4, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-1, 0.5, 1.2, 0, TAU);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(-6, -2);
        ctx.lineTo(-6, -6);
        ctx.lineTo(-2, -6);
        ctx.moveTo(2, -6);
        ctx.lineTo(6, -6);
        ctx.lineTo(6, -2);
        ctx.moveTo(6, 2);
        ctx.lineTo(6, 6);
        ctx.lineTo(2, 6);
        ctx.moveTo(-2, 6);
        ctx.lineTo(-6, 6);
        ctx.lineTo(-6, 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 1.2, 0, TAU);
        ctx.fill();
      }
    } else if (node.level === 'file') {
      ctx.strokeStyle = rgba(color, 0.95);
      ctx.strokeRect(-3.6, -4.4, 7.2, 8.8);
      ctx.beginPath();
      ctx.moveTo(-3.6, -1.4);
      ctx.lineTo(3.6, -1.4);
      ctx.stroke();
    } else {
      ctx.fillStyle = rgba(color, 1);
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba('#F4F7F8', 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawNodeLabel(
    node: ProjectionNode,
    x: number,
    y: number,
    radius: number,
    color: string,
    dim: number,
    detailed: boolean,
  ) {
    const ctx = this.context;
    // Outer-ring nodes above the middle get their labels above the node; this
    // keeps long file names from stacking on the inner ring.
    const placeAbove = node.level !== 'module' && y < this.height * 0.52;
    const step = placeAbove ? -1 : 1;
    const labelY = y + step * (radius + (node.level === 'module' ? 20 : 15));
    const alignRight = x > this.width - 110;
    const alignLeft = x < 110;
    const textAlign = alignRight ? 'right' : alignLeft ? 'left' : 'center';
    const textX = x;
    const titleSize = node.level === 'module' ? 11.5 : 9.4;
    const title = shortLabel(node.label, node.level === 'module' ? 14 : node.level === 'file' ? 16 : 20);

    ctx.save();
    ctx.globalAlpha = dim;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(3, 5, 7, 0.9)';
    ctx.lineWidth = 3;
    ctx.font = `500 ${titleSize}px ${FONT_SANS}`;
    ctx.strokeText(title, textX, labelY);
    ctx.fillStyle = 'rgba(246, 248, 246, 0.96)';
    ctx.fillText(title, textX, labelY);

    if (node.level === 'module') {
      ctx.font = `400 7.2px ${FONT_MONO}`;
      ctx.strokeText(node.sublabel, textX, labelY + 13);
      ctx.fillStyle = 'rgba(220, 231, 236, 0.55)';
      ctx.fillText(node.sublabel, textX, labelY + 13);
      const status = node.distributed ? '分布式能力集合 · 主归属 0' : `${node.nodeCount} 主节点`;
      ctx.font = `400 7.2px ${FONT_SANS}`;
      ctx.strokeText(status, textX, labelY + 25);
      ctx.fillStyle = rgba(color, 0.86);
      ctx.fillText(status, textX, labelY + 25);
    } else if (detailed) {
      ctx.font = `400 7px ${FONT_MONO}`;
      const sub = shortLabel(node.sublabel, 30);
      ctx.strokeText(sub, textX, labelY + step * 12);
      ctx.fillStyle = 'rgba(220, 231, 236, 0.55)';
      ctx.fillText(sub, textX, labelY + step * 12);
    }
    ctx.restore();
  }

  private roundRect(x: number, y: number, width: number, height: number, radius: number) {
    const ctx = this.context;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}
