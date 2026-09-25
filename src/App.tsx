import { useEffect } from 'react';
import { MapCanvas } from './map/MapCanvas';
import { EventMarkers } from './map/EventMarkers';
import { CityMarkers } from './map/CityMarkers';
import { Header } from './ui/Header';
import { Timeline } from './ui/Timeline';
import { EventPanel } from './ui/EventPanel';
import { Legend } from './ui/Legend';
import { EraCaption } from './ui/EraCaption';
import { Compass } from './ui/Compass';
import { JourneyButton } from './ui/JourneyButton';
import { CityViewButton } from './ui/CityViewButton';
import { useAppStore } from './state/store';
import { YEARS_PER_SECOND } from './lib/timeline';
import { YEAR_MAX } from './data/schema';
import { useT } from './i18n';

/** Advances the year while autoplay is on; stops at the end of history. */
function useAutoplay() {
  const isPlaying = useAppStore((s) => s.isPlaying);
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { year, setYear, pause } = useAppStore.getState();
      const next = year + dt * YEARS_PER_SECOND;
      if (next >= YEAR_MAX) {
        setYear(YEAR_MAX);
        pause();
        return;
      }
      setYear(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);
}

/** H toggles all chrome (ignored while typing). */
function useHideUiKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'h') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      useAppStore.getState().toggleUi();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  useAutoplay();
  useHideUiKey();
  const t = useT();
  const uiHidden = useAppStore((s) => s.uiHidden);

  return (
    <div className={`app${uiHidden ? ' ui-hidden' : ''}`}>
      <main className="map-stage">
        <MapCanvas />
        <CityMarkers />
        <EventMarkers />
        <EraCaption />
        <Legend />
        <Compass />
        <JourneyButton />
        <CityViewButton />
        <p className="drag-hint">{t('dragHint')}</p>
        <EventPanel />
      </main>
      <Header />
      <Timeline />
    </div>
  );
}
