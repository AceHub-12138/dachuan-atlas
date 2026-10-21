export interface Point {
  x: number;
  y: number;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const lerp = (start: number, end: number, amount: number) =>
  start + (end - start) * amount;

export const lerpPoint = (start: Point, end: Point, amount: number): Point => ({
  x: lerp(start.x, end.x, amount),
  y: lerp(start.y, end.y, amount),
});

export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

export const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);

export const easeInOutCubic = (value: number) => {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const pointOnCubic = (
  from: Point,
  controlA: Point,
  controlB: Point,
  to: Point,
  t: number,
): Point => {
  const oneMinus = 1 - t;
  const a = oneMinus * oneMinus * oneMinus;
  const b = 3 * oneMinus * oneMinus * t;
  const c = 3 * oneMinus * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * controlA.x + c * controlB.x + d * to.x,
    y: a * from.y + b * controlA.y + c * controlB.y + d * to.y,
  };
};

export const sampleCubic = (
  from: Point,
  controlA: Point,
  controlB: Point,
  to: Point,
  samples = 64,
): Point[] => {
  const points: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    points.push(pointOnCubic(from, controlA, controlB, to, index / samples));
  }
  return points;
};

export const pointAtSamples = (points: Point[], t: number): Point => {
  const scaled = clamp(t, 0, 1) * (points.length - 1);
  const index = Math.floor(scaled);
  const next = Math.min(points.length - 1, index + 1);
  return lerpPoint(points[index], points[next], scaled - index);
};

export const rgba = (hex: string, alpha: number) => {
  const clean = hex.replace('#', '');
  const value =
    clean.length === 3
      ? clean
          .split('')
          .map((part) => part + part)
          .join('')
      : clean;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

/** Deterministic PRNG so the star field stays art-directed between reloads. */
export const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};
