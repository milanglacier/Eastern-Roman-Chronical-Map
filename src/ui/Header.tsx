import { useAppStore } from '../state/store';
import { useT, useLang } from '../i18n';
import { snapshots } from '../data';
import { snapshotForYear } from '../lib/timeline';

/** Top bar: chi-rho ornament, bilingual title, era note, language toggle. */
export function Header() {
  const t = useT();
  const lang = useLang();
  const year = useAppStore((s) => s.year);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const snapshot = snapshotForYear(snapshots, year);

  return (
    <header className="app-header">
      <div className="app-header-brand">
        <svg className="chi-rho" viewBox="0 0 40 48" width="30" height="36" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round">
            <path d="M20 8v36" />
            <path d="M8 44l24-30M32 44L8 14" />
            <path d="M20 8a6 6 0 116 6" />
          </g>
        </svg>
        <div>
          <h1 className="app-title">{t('appTitle')}</h1>
          <p className="app-subtitle">{t('appSubtitle')}</p>
        </div>
      </div>
      <p className="app-header-note" data-testid="era-note">
        {snapshot.note[lang]}
      </p>
      <button
        type="button"
        className="language-toggle"
        onClick={() => setLanguage(lang === 'en' ? 'zh' : 'en')}
        aria-label="Switch language"
        data-testid="language-toggle"
      >
        {t('languageToggle')}
      </button>
    </header>
  );
}
