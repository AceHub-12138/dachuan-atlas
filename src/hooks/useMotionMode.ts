import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { MotionMode } from '../scene/AtlasScene';

const STORAGE_KEY = 'dachuan-atlas-motion';

const isMotionMode = (value: string | null): value is MotionMode =>
  value === 'full' || value === 'low' || value === 'static';

const initialMode = (): MotionMode => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isMotionMode(saved)) return saved;
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'static' : 'full';
};

export function useMotionMode() {
  const [motion, setMotion] = useState<MotionMode>(initialMode);
  const [initialReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useLayoutEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, motion);
    } catch {
      // A failed write should never block the prototype.
    }
  }, [motion]);

  const setMotionMode = useCallback((next: MotionMode) => {
    setMotion(next);
  }, []);

  return { motion, setMotionMode, initialReduced };
}
