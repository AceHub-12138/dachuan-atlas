import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function AtlasMark(props: IconProps) {
  return (
    <svg viewBox="0 0 44 44" fill="none" aria-hidden="true" {...props}>
      <circle cx="22" cy="22" r="3.6" fill="#EE7D2C" />
      <path
        d="M22 5.5C31.6 5.5 39.5 13.3 39.5 23"
        stroke="#F1C4A3"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity=".62"
      />
      <path
        d="M36.2 30.3C32.3 36.2 25.2 38.7 18.9 36.4"
        stroke="#EE7D2C"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity=".94"
      />
      <path
        d="M9.7 30.6C6.5 24.7 8.8 17.5 14.7 14.3"
        stroke="#9BB4C2"
        strokeWidth="1"
        strokeLinecap="round"
        opacity=".58"
      />
      <circle cx="39.5" cy="23" r="1.45" fill="#F1C4A3" />
      <circle cx="18.9" cy="36.4" r="1.45" fill="#EE7D2C" />
      <circle cx="14.7" cy="14.3" r="1.1" fill="#9BB4C2" />
      <path d="M22 16.8V27.2M16.8 22H27.2" stroke="rgba(255,255,255,.22)" strokeWidth=".7" />
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M3.5 10H16.2M11.5 5.5L16.2 10L11.5 14.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M16.5 10H3.8M8.5 5.5L3.8 10L8.5 14.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M5.8 3.8L10 8L5.8 12.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="10" cy="10" r="7.1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M10 8.7V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function MockDataset(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="10" cy="10" r="7.1" stroke="currentColor" strokeWidth=".9" opacity=".5" />
      <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth=".9" />
      <path d="M10 2.9V7M10 13V17.1M2.9 10H7M13 10H17.1" stroke="currentColor" strokeWidth=".9" strokeLinecap="round" />
    </svg>
  );
}
