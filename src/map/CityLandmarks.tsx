import { cityScenes } from '../data';
import type { CityStructureKind } from '../data/schema';
import { structureStands } from '../lib/cityTimeline';
import { useAppStore } from '../state/store';
import { useLang } from '../i18n';
import { projectLonLat } from './three/projection';

/** Kinds that get a name label in the city view (columns sit in their fora). */
const LABELED: ReadonlySet<CityStructureKind> = new Set([
  'land-wall',
  'gate',
  'tower',
  'great-church',
  'church',
  'hippodrome',
  'palace',
  'forum',
  'aqueduct',
  'harbor',
  'chain',
]);

/**
 * DOM name labels for the structures standing in the city view's year,
 * projected like the event markers (crisp text at every zoom). Linear works
 * are labelled a third of the way along their course.
 */
export function CityLandmarks() {
  const view = useAppStore((s) => s.view);
  const year = Math.round(useAppStore((s) => s.year));
  useAppStore((s) => s.viewVersion);
  const lang = useLang();
  if (view.kind !== 'city') return null;
  const scene = cityScenes.get(view.cityId);
  if (!scene) return null;

  return (
    <div className="city-landmarks" aria-label="landmarks">
      {scene.structures.map((s) => {
        if (!LABELED.has(s.kind) || !structureStands(s, year)) return null;
        const at = s.position ?? s.path![Math.floor(s.path!.length / 3)];
        const p = projectLonLat(at[0], at[1]);
        if (!p.visible) return null;
        return (
          <span
            key={s.id}
            className={`city-landmark kind-${s.kind}`}
            style={{ left: `${p.x}px`, top: `${p.y}px` }}
            data-structure-id={s.id}
          >
            {s.name[lang]}
          </span>
        );
      })}
    </div>
  );
}
