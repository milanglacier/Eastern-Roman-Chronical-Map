import { useCallback, useRef } from 'react';
import { snapshots } from '../data';
import { YEAR_MIN, YEAR_MAX } from '../data/schema';
import { snapshotForYear } from '../lib/timeline';
import { useAppStore } from '../state/store';
import { useT, useLang, formatYear } from '../i18n';

const SPAN = YEAR_MAX - YEAR_MIN;

const yearToPct = (year: number) => ((year - YEAR_MIN) / SPAN) * 100;

/** Bottom bar: play/pause, scrubber with snapshot ticks, era label. */
export function Timeline() {
  const year = useAppStore((s) => s.year);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const togglePlay = useAppStore((s) => s.togglePlay);
  const setYear = useAppStore((s) => s.setYear);
  const pause = useAppStore((s) => s.pause);
  const t = useT();
  const lang = useLang();

  const trackRef = useRef<HTMLDivElement>(null);
  const snapshot = snapshotForYear(snapshots, year);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      setYear(Math.round(YEAR_MIN + frac * SPAN));
    },
    [setYear],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    pause();
    seekFromPointer(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons & 1) seekFromPointer(e.clientX);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setYear(year + (e.shiftKey ? 25 : 5));
    else if (e.key === 'ArrowLeft') setYear(year - (e.shiftKey ? 25 : 5));
    else if (e.key === 'Home') setYear(YEAR_MIN);
    else if (e.key === 'End') setYear(YEAR_MAX);
    else if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    }
  };

  return (
    <div className="timeline" data-testid="timeline">
      <button
        type="button"
        className="timeline-play"
        onClick={togglePlay}
        aria-label={isPlaying ? t('pause') : t('play')}
        data-testid="play-button"
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M7 4h4v16H7zM13 4h4v16h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M7 4l13 8-13 8z" />
          </svg>
        )}
      </button>

      <div className="timeline-body">
        <div className="timeline-labels">
          <span className="timeline-year" data-testid="year-display">
            {formatYear(Math.round(year), lang)}
          </span>
          <span className="timeline-era" data-testid="era-label">
            {snapshot.label[lang]}
          </span>
        </div>
        <div
          ref={trackRef}
          className="timeline-track"
          role="slider"
          tabIndex={0}
          aria-label={t('timeline')}
          aria-valuemin={YEAR_MIN}
          aria-valuemax={YEAR_MAX}
          aria-valuenow={Math.round(year)}
          aria-valuetext={formatYear(Math.round(year), lang)}
          data-testid="timeline-track"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
        >
          <div className="timeline-rail" />
          <div className="timeline-fill" style={{ width: `${yearToPct(year)}%` }} />
          {snapshots.map((snap) => (
            <button
              key={snap.id}
              type="button"
              className={`timeline-tick${snap.year === snapshot.year ? ' active' : ''}`}
              style={{ left: `${yearToPct(snap.year)}%` }}
              title={`${formatYear(snap.year, lang)} · ${snap.label[lang]}`}
              aria-label={`${formatYear(snap.year, lang)} ${snap.label[lang]}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                pause();
                setYear(snap.year);
              }}
            />
          ))}
          <div className="timeline-thumb" style={{ left: `${yearToPct(year)}%` }} />
        </div>
        <div className="timeline-bounds">
          <span>{formatYear(YEAR_MIN, lang)}</span>
          <span>{formatYear(YEAR_MAX, lang)}</span>
        </div>
      </div>
    </div>
  );
}
