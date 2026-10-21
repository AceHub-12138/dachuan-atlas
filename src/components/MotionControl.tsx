import type { MotionMode } from '../scene/AtlasScene';

const MODES: { id: MotionMode; label: string; description: string }[] = [
  { id: 'full', label: '完整', description: '完整动效' },
  { id: 'low', label: '低动态', description: '降低动效密度与速度' },
  { id: 'static', label: '静态', description: '停止环境动画' },
];

interface MotionControlProps {
  motion: MotionMode;
  onChange: (mode: MotionMode) => void;
}

export function MotionControl({ motion, onChange }: MotionControlProps) {
  return (
    <div className="motion-control">
      <span className="motion-control__label">动效</span>
      <div
        className="motion-control__segments"
        role="radiogroup"
        aria-label="动画强度"
        data-active={motion}
      >
        <span className="motion-control__thumb" aria-hidden="true" />
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={motion === mode.id}
            title={mode.description}
            className={motion === mode.id ? 'is-active' : undefined}
            onClick={() => onChange(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
