import { LEAVE_CITY_EVENT } from '../map/three/projection';
import { useAppStore } from '../state/store';
import { useT } from '../i18n';

/** Inside a city view: return to the continental map (as climbing out does). */
export function CityViewButton() {
  const t = useT();
  const inCity = useAppStore((s) => s.cityView !== null);
  if (!inCity) return null;
  return (
    <button
      type="button"
      className="city-view-button glass"
      onClick={() => window.dispatchEvent(new Event(LEAVE_CITY_EVENT))}
      data-testid="city-view-button"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {t('backToMap')}
    </button>
  );
}
