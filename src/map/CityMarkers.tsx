import { useAppStore } from '../state/store';
import { projectLonLat } from './three/projection';
import { visibleCities } from './cities';
import { useLang } from '../i18n';

/**
 * DOM overlay of city markers + bilingual labels over the 3D canvas. DOM
 * (not in-scene sprites) keeps the text crisp at every zoom; markers do not
 * depth-test against terrain, which is imperceptible at the 40–55° pitch.
 * Re-renders whenever the camera bumps `viewVersion`.
 */
export function CityMarkers() {
  const year = useAppStore((s) => s.year);
  useAppStore((s) => s.viewVersion);
  const lang = useLang();

  return (
    <div className="city-markers" aria-label="cities">
      {visibleCities(year).map((city) => {
        const p = projectLonLat(city.lonlat[0], city.lonlat[1]);
        if (!p.visible) return null;
        return (
          <div
            key={city.id}
            className={`city-marker rank-${city.rank}`}
            style={{ left: `${p.x}px`, top: `${p.y}px` }}
            data-city-id={city.id}
          >
            <span className="city-dot" />
            <span className="city-name">{city.name[lang]}</span>
          </div>
        );
      })}
    </div>
  );
}
