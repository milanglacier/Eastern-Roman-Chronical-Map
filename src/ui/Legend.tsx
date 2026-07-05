import { useState } from 'react';
import { useT, useLang, categoryNames } from '../i18n';
import { EVENT_CATEGORIES } from '../data/schema';
import { CategoryIcon } from './CategoryIcon';
import { CATEGORY_COLORS, TERRAIN_COLORS, TERRITORY_FILL } from '../map/colors';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const TERRAIN_ITEMS = [
  { key: 'terrainSea', color: TERRAIN_COLORS.s },
  { key: 'terrainGrass', color: TERRAIN_COLORS.g },
  { key: 'terrainPlains', color: TERRAIN_COLORS.p },
  { key: 'terrainHills', color: TERRAIN_COLORS.h },
  { key: 'terrainMountain', color: TERRAIN_COLORS.m },
  { key: 'terrainDesert', color: TERRAIN_COLORS.d },
] as const;

export function Legend() {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);

  return (
    <div className={`legend${open ? ' open' : ''}`}>
      <button type="button" className="legend-toggle" onClick={() => setOpen(!open)}>
        {t('legend')}
      </button>
      {open && (
        <div className="legend-body">
          <div className="legend-section">
            <span className="legend-swatch territory" style={{ background: hex(TERRITORY_FILL) }} />
            <span>{t('territory')}</span>
          </div>
          <h3>{t('categories')}</h3>
          <ul className="legend-categories">
            {EVENT_CATEGORIES.map((cat) => (
              <li key={cat} style={{ ['--cat-color' as string]: CATEGORY_COLORS[cat] }}>
                <span className="legend-cat-icon">
                  <CategoryIcon category={cat} size={11} />
                </span>
                {categoryNames[cat][lang]}
              </li>
            ))}
          </ul>
          <h3>{t('terrainLegend')}</h3>
          <ul className="legend-terrain">
            {TERRAIN_ITEMS.map((item) => (
              <li key={item.key}>
                <span className="legend-swatch" style={{ background: hex(item.color) }} />
                {t(item.key)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
