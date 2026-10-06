import { useState, type CSSProperties } from 'react';
import { snapshots } from '../data';
import type { Snapshot } from '../data/schema';
import { snapshotForYear } from '../lib/timeline';
import { ERA_SECONDS_MIN, playbackClock } from '../lib/playback';
import { useAppStore, type Language } from '../state/store';
import { formatYear, useLang } from '../i18n';

/** A title card's timing (seconds): fade in, hold at full strength, fade out. */
export interface CaptionTiming {
  fadeIn: number;
  hold: number;
  fadeOut: number;
}

/** The standard card, for an era reached by hand (scrub, tick, keys): 4.2 s. */
const STILL: CaptionTiming = { fadeIn: 0.9, hold: 2.1, fadeOut: 1.2 };
/** The fall of the City: playback stops here, so the card lingers 6 s. */
const ENDING: CaptionTiming = { fadeIn: 0.9, hold: 3.9, fadeOut: 1.2 };
/**
 * During playback the fades, and the breath before the next title, scale
 * with the playback beat so the shortest era still holds its title.
 */
const BEAT = ERA_SECONDS_MIN / 4;
const PLAY_FADE_IN = 0.9 * BEAT;
const PLAY_FADE_OUT = 1.2 * BEAT;
const PLAY_GAP = 0.3 * BEAT;
const HOLD_MIN = 0.5;

/** How the title card runs, given how the era was reached. */
export function captionTiming(snapshot: Snapshot, playing: boolean): CaptionTiming {
  if (snapshot === snapshots[snapshots.length - 1]) return ENDING;
  if (!playing) return STILL;
  const hold = playbackClock.eraSeconds(snapshot.year) - PLAY_FADE_IN - PLAY_FADE_OUT - PLAY_GAP;
  return { fadeIn: PLAY_FADE_IN, hold: Math.max(HOLD_MIN, hold), fadeOut: PLAY_FADE_OUT };
}

/**
 * Cinematic title card: whenever the era (snapshot) changes, its name
 * fades in over the painting and dissolves again. During playback the title
 * holds for as long as its era plays, fading out just before the next one.
 */
export function EraCaption() {
  const year = useAppStore((s) => s.year);
  const hidden = useAppStore((s) => s.uiHidden);
  const selected = useAppStore((s) => s.selectedEventId);
  const lang = useLang();
  const snapshot = snapshotForYear(snapshots, year);
  if (hidden || selected) return null;
  // Keyed so the animation restarts, and the hold is fixed, on every change.
  return <Caption key={`${snapshot.id}-${lang}`} snapshot={snapshot} lang={lang} />;
}

function Caption({ snapshot, lang }: { snapshot: Snapshot; lang: Language }) {
  // Fixed at mount: pausing mid-caption must not re-time a running animation.
  const [timing] = useState(() => captionTiming(snapshot, useAppStore.getState().isPlaying));
  const style = {
    '--era-caption-in': `${timing.fadeIn.toFixed(2)}s`,
    '--era-caption-hold': `${timing.hold.toFixed(2)}s`,
    '--era-caption-out': `${timing.fadeOut.toFixed(2)}s`,
  } as CSSProperties;
  return (
    <div
      className="era-caption"
      style={style}
      aria-hidden="true"
      data-testid="era-caption"
    >
      <div className="era-caption-year">{formatYear(snapshot.year, lang)}</div>
      <div className="era-caption-rule" />
      <div className="era-caption-title">{snapshot.label[lang]}</div>
    </div>
  );
}
