import { events, snapshots } from '../data';
import { eventsForYear } from '../lib/timeline';
import { useAppStore } from '../state/store';
import { projectLonLat } from './three/projection';
import { CategoryIcon } from '../ui/CategoryIcon';
import { CATEGORY_COLORS } from './colors';
import { useLang } from '../i18n';

/**
 * DOM overlay of clickable event widgets, positioned over the 3D canvas at
 * each event's map location. Clicking one stops autoplay and opens the panel.
 * Re-renders whenever the camera bumps `viewVersion` in the store.
 */
export function EventMarkers() {
  const year = useAppStore((s) => s.year);
  useAppStore((s) => s.viewVersion);
  const selectEvent = useAppStore((s) => s.selectEvent);
  const selectedId = useAppStore((s) => s.selectedEventId);
  const lang = useLang();

  const visible = eventsForYear(events, snapshots, year);

  // Fan out markers that share a location so none hide behind another.
  const seenAt = new Map<string, number>();

  return (
    <div className="event-markers" aria-label="events">
      {visible.map((event) => {
        const p = projectLonLat(event.lonlat[0], event.lonlat[1]);
        if (!p.visible) return null;
        const key = `${Math.round(p.x / 8)},${Math.round(p.y / 8)}`;
        const stack = seenAt.get(key) ?? 0;
        seenAt.set(key, stack + 1);
        const fan = stack === 0 ? 0 : (stack % 2 === 1 ? 1 : -1) * Math.ceil(stack / 2) * 26;
        const major = event.importance === 1;
        return (
          <button
            key={event.id}
            type="button"
            className={`event-marker cat-${event.category}${major ? ' major' : ''}${
              selectedId === event.id ? ' selected' : ''
            }`}
            style={{
              left: `${p.x + fan}px`,
              top: `${p.y}px`,
              ['--cat-color' as string]: CATEGORY_COLORS[event.category],
            }}
            title={event.title[lang]}
            aria-label={event.title[lang]}
            data-event-id={event.id}
            onClick={() => selectEvent(event.id)}
          >
            <CategoryIcon category={event.category} size={major ? 15 : 12} />
          </button>
        );
      })}
    </div>
  );
}
