import type { EventCategory } from '../data/schema';

/** Minimal geometric glyphs, one per category, drawn for a 24×24 viewBox. */
const PATHS: Record<EventCategory, JSX.Element> = {
  politics: (
    // Crown
    <path d="M4 17h16l-1-8-4 3.5L12 6l-3 6.5L5 9l-1 8zm0 2h16v2H4z" />
  ),
  military: (
    // Crossed swords
    <path d="M5 4l6.3 6.3-1.4 1.4L3.6 5.4 3 3l2 1zm14 0l2-1-.6 2.4-6.3 6.3-1.4-1.4L19 4zM8.5 13.9l1.6 1.6-3.6 3.6L8 20.6 6.6 22l-1.5-1.5L3.4 22 2 20.6l1.5-1.6L2 17.5 3.4 16l1.5 1.5 3.6-3.6zm7 0l3.6 3.6L20.6 16l1.4 1.5-1.5 1.5L22 20.6 20.6 22l-1.6-1.4-1.5 1.4-1.4-1.4 1.4-1.5-3.6-3.6 1.6-1.6z" />
  ),
  economy: (
    // Coin with cross (nomisma)
    <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2a8 8 0 110 16 8 8 0 010-16zm-1 3h2v4h4v2h-4v4h-2v-4H7v-2h4V7z" />
  ),
  culture: (
    // Open codex
    <path d="M3 5c2.5-1.4 5.5-1.4 8 0v14c-2.5-1.4-5.5-1.4-8 0V5zm18 0c-2.5-1.4-5.5-1.4-8 0v14c2.5-1.4 5.5-1.4 8 0V5z" />
  ),
  art: (
    // Mosaic tesserae
    <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 3.5L16.5 13l3.5 3.5-3.5 3.5-3.5-3.5z" />
  ),
  law: (
    // Scales
    <path d="M11 3h2v2.3l5 1.2 2.4 6a3.5 3.5 0 01-7 0L15.7 7 13 6.4V18h4v2H7v-2h4V6.4L8.3 7l2.3 5.5a3.5 3.5 0 01-7 0L6 6.5l5-1.2V3zm-4.5 6.2L5 13h3L6.5 9.2zm11 0L16 13h3l-1.5-3.8z" />
  ),
  religion: (
    // Cross with flared serifs
    <path d="M10.5 2h3v6.5H20v3h-6.5V22h-3V11.5H4v-3h6.5V2z" />
  ),
  civilization: (
    // Columned temple
    <path d="M12 2l9 5v2H3V7l9-5zM5 10h2.5v8H5v-8zm5.75 0h2.5v8h-2.5v-8zM16.5 10H19v8h-2.5v-8zM3 19h18v3H3v-3z" />
  ),
};

export function CategoryIcon({ category, size = 14 }: { category: EventCategory; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {PATHS[category]}
    </svg>
  );
}
