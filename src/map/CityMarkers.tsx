import { useAppStore } from '../state/store';
import { projectLonLat } from './three/projection';
import { visibleCities } from './cities';
import { useLang, useT } from '../i18n';
import { cityPlans } from '../data';
import { activeTheme } from './three/theme';
import { ENTER_CITY_EVENT } from './three/projection';

/**
 * DOM overlay of city markers + bilingual labels over the 3D canvas. DOM
 * (not in-scene sprites) keeps the text crisp at every zoom; markers do not
 * depth-test against terrain, which is imperceptible at the 40–55° pitch.
 * Re-renders whenever the camera bumps `viewVersion`. In the chronicle
 * theme a city with a city view can be clicked to enter it; inside a city
 * view the map's markers are hidden.
 */
export function CityMarkers() {
  const year = useAppStore((s) => s.year);
  useAppStore((s) => s.viewVersion);
  const lang = useLang();
  const t = useT();
  const inCity = useAppStore((s) => s.cityView !== null);
  const enterable = activeTheme() === 'chronicle' ? cityPlans : null;
  if (inCity) return <div className="city-markers" aria-label="cities" />;

  return (
    <div className="city-markers" aria-label="cities">
      {visibleCities(year).map((city) => {
        const p = projectLonLat(city.lonlat[0], city.lonlat[1]);
        if (!p.visible) return null;
        if (enterable?.has(city.id)) {
          return (
            <button
              key={city.id}
              type="button"
              className={`city-marker rank-${city.rank} enterable`}
              style={{ left: `${p.x}px`, top: `${p.y}px` }}
              data-city-id={city.id}
              title={t('enterCity')}
              onClick={() => window.dispatchEvent(new CustomEvent(ENTER_CITY_EVENT, { detail: city.id }))}
            >
              <span className="city-dot" />
              <span className="city-name">{city.name[lang]}</span>
            </button>
          );
        }
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
