import { useAppStore } from '../state/store';
import { getCameraHeading, NORTH_UP_EVENT } from '../map/three/projection';
import { useT } from '../i18n';

/** Compass rose that follows the camera heading; click flies back to north-up. */
export function Compass() {
  useAppStore((s) => s.viewVersion);
  const t = useT();
  const deg = (-getCameraHeading() * 180) / Math.PI;
  return (
    <button
      type="button"
      className="compass glass"
      aria-label={t('northUp')}
      title={t('northUp')}
      onClick={() => window.dispatchEvent(new Event(NORTH_UP_EVENT))}
      data-testid="compass"
    >
      <svg viewBox="0 0 40 40" width="30" height="30" style={{ transform: `rotate(${deg}deg)` }} aria-hidden="true">
        <path d="M20 4 L25 20 L20 17 L15 20 Z" fill="currentColor" />
        <path d="M20 36 L15 20 L20 23 L25 20 Z" fill="currentColor" opacity="0.35" />
        <text x="20" y="11.5" textAnchor="middle" fontSize="6" fontFamily="Cinzel, serif" fill="#1a1410">N</text>
      </svg>
    </button>
  );
}
