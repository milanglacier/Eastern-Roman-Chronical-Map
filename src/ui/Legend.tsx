import { useState } from 'react';
import { useT, useLang, categoryNames } from '../i18n';
import { EVENT_CATEGORIES } from '../data/schema';
import { CategoryIcon } from './CategoryIcon';
import { CATEGORY_COLORS, TERRITORY_TINT } from '../map/colors';
import { LEGEND_TERRAIN } from '../map/three/palette';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const TERRAIN_ITEMS = [
  { key: 'terrainSea', color: LEGEND_TERRAIN.sea },
  { key: 'terrainGrass', color: LEGEND_TERRAIN.grass },
  { key: 'terrainDesert', color: LEGEND_TERRAIN.desert },
  { key: 'terrainMountain', color: LEGEND_TERRAIN.mountain },
  { key: 'terrainSnow', color: LEGEND_TERRAIN.snow },
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
            <span className="legend-swatch territory" style={{ background: hex(TERRITORY_TINT) }} />
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
