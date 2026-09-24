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
  const inCity = useAppStore((s) => s.view.kind === 'city');
  const enterCity = useAppStore((s) => s.enterCity);
  const lang = useLang();

  // Inside a city view the world's city dots would all project off-lens.
  if (inCity) return null;

  return (
    <div className="city-markers" aria-label="cities">
      {visibleCities(year).map((city) => {
        const p = projectLonLat(city.lonlat[0], city.lonlat[1]);
        if (!p.visible) return null;
        const style = { left: `${p.x}px`, top: `${p.y}px` };
        if (city.scene) {
          // Cities with a view open it on click.
          const scene = city.scene;
          return (
            <button
              type="button"
              key={city.id}
              className={`city-marker rank-${city.rank} has-scene`}
              style={style}
              data-city-id={city.id}
              onClick={() => enterCity(scene)}
            >
              <span className="city-dot" />
              <span className="city-name">{city.name[lang]}</span>
            </button>
          );
        }
        return (
          <div key={city.id} className={`city-marker rank-${city.rank}`} style={style} data-city-id={city.id}>
            <span className="city-dot" />
            <span className="city-name">{city.name[lang]}</span>
          </div>
        );
      })}
    </div>
  );
}
