import { useEffect } from 'react';
import { MapCanvas } from './map/MapCanvas';
import { EventMarkers } from './map/EventMarkers';
import { CityMarkers } from './map/CityMarkers';
import { CityLandmarks } from './map/CityLandmarks';
import { Header } from './ui/Header';
import { Timeline } from './ui/Timeline';
import { EventPanel } from './ui/EventPanel';
import { Legend } from './ui/Legend';
import { CityLens } from './ui/CityLens';
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

export default function App() {
  useAutoplay();
  const t = useT();
  const inCity = useAppStore((s) => s.view.kind === 'city');

  return (
    <div className="app">
      <Header />
      <main className="map-stage">
        <MapCanvas />
        <CityMarkers />
        <CityLandmarks />
        <EventMarkers />
        <Legend />
        <CityLens />
        <p className="drag-hint">{t(inCity ? 'cityDragHint' : 'dragHint')}</p>
        <EventPanel />
      </main>
      <Timeline />
    </div>
  );
}
