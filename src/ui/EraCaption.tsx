import { snapshots } from '../data';
import { snapshotForYear } from '../lib/timeline';
import { useAppStore } from '../state/store';
import { formatYear, useLang } from '../i18n';

/**
 * Cinematic title card: whenever the era (snapshot) changes, its name
 * fades in over the painting and dissolves again. Keyed by snapshot so the
 * CSS animation restarts on every change.
 */
export function EraCaption() {
  const year = useAppStore((s) => s.year);
  const hidden = useAppStore((s) => s.uiHidden);
  const selected = useAppStore((s) => s.selectedEventId);
  const lang = useLang();
  const snapshot = snapshotForYear(snapshots, year);
  if (hidden || selected) return null;
  return (
    <div className="era-caption" key={`${snapshot.id}-${lang}`} aria-hidden="true" data-testid="era-caption">
      <div className="era-caption-year">{formatYear(snapshot.year, lang)}</div>
      <div className="era-caption-rule" />
      <div className="era-caption-title">{snapshot.label[lang]}</div>
    </div>
  );
}
