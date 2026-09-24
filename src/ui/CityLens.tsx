import { cities, cityScenes } from '../data';
import { useAppStore } from '../state/store';
import { useLang, useT, formatYear } from '../i18n';
import { captionForYear, interpolateKeyframes, roundPopulation } from '../lib/cityTimeline';

/**
 * City-lens chrome. On the world map: an "Enter <city>" offer once the
 * camera is zoomed in near a city that has a view. Inside a city: a
 * "Back to the map" control and an era caption card (year, population,
 * what the city looked like then).
 */
export function CityLens() {
  const view = useAppStore((s) => s.view);
  const candidate = useAppStore((s) => s.lensCandidate);
  const enterCity = useAppStore((s) => s.enterCity);
  const exitCity = useAppStore((s) => s.exitCity);
  const year = Math.round(useAppStore((s) => s.year));
  const lang = useLang();
  const t = useT();

  if (view.kind === 'world') {
    if (!candidate) return null;
    const city = cities.find((c) => c.scene === candidate);
    if (!city) return null;
    return (
      <button type="button" className="lens-enter" onClick={() => enterCity(candidate)}>
        <span className="lens-enter-icon" aria-hidden="true">
          ⌖
        </span>
        {t('enterCity')} {city.name[lang]}
      </button>
    );
  }

  const scene = cityScenes.get(view.cityId);
  if (!scene) return null;
  const caption = captionForYear(scene, year);
  const population = roundPopulation(interpolateKeyframes(scene.population, year));
  return (
    <>
      <button type="button" className="city-back" onClick={exitCity}>
        ← {t('backToMap')}
      </button>
      <section className="city-caption" aria-live="polite">
        <h2 className="city-caption-title">
          {scene.name[lang]} <span className="city-caption-year">{formatYear(year, lang)}</span>
        </h2>
        <p className="city-caption-text">{caption.text[lang]}</p>
        <p className="city-caption-pop">
          {t('population')} ≈ {population.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
        </p>
      </section>
    </>
  );
}
