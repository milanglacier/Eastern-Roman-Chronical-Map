import { events } from '../data';
import { useAppStore } from '../state/store';
import { useT, useLang, categoryNames, formatYearRange } from '../i18n';
import { CategoryIcon } from './CategoryIcon';
import { CATEGORY_COLORS } from '../map/colors';

/** Detail panel for the selected event, styled as an illuminated page. */
export function EventPanel() {
  const selectedId = useAppStore((s) => s.selectedEventId);
  const selectEvent = useAppStore((s) => s.selectEvent);
  const lang = useLang();
  const t = useT();

  const event = events.find((e) => e.id === selectedId);
  if (!event) return null;

  return (
    <aside className="event-panel" role="dialog" aria-label={event.title[lang]} data-lang={lang}>
      <div className="event-panel-inner">
        <button
          type="button"
          className="event-panel-close"
          onClick={() => selectEvent(null)}
          aria-label={t('close')}
        >
          ✕
        </button>
        <div className="event-panel-meta">
          <span
            className="event-panel-category"
            style={{ ['--cat-color' as string]: CATEGORY_COLORS[event.category] }}
          >
            <CategoryIcon category={event.category} size={13} />
            {categoryNames[event.category][lang]}
          </span>
          <span className="event-panel-year">{formatYearRange(event.year, event.endYear, lang)}</span>
        </div>
        <h2 className="event-panel-title">{event.title[lang]}</h2>
        <p className="event-panel-summary">{event.summary[lang]}</p>
        <div className="event-panel-detail">
          {event.detail[lang].split('\n\n').map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </div>
    </aside>
  );
}
