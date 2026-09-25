import { JOURNEY_EVENT } from '../map/three/projection';
import { activeTheme } from '../map/three/theme';
import { useT } from '../i18n';

/** Replays the guided opening flight (clockwork theme only). */
export function JourneyButton() {
  const t = useT();
  if (activeTheme() === 'painted') return null;
  return (
    <button
      type="button"
      className="journey-button glass"
      onClick={() => window.dispatchEvent(new Event(JOURNEY_EVENT))}
      data-testid="journey-button"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M7 4l13 8-13 8z" />
      </svg>
      {t('journey')}
    </button>
  );
}
