import { Container, Graphics, Text } from 'pixi.js';
import { cities } from '../../data';
import type { City, Language } from './types';
import { lonLatToIso } from '../iso';
import { CITY_BUILDING, CITY_ROOF, CITY_OUTLINE } from '../colors';

export function visibleCities(year: number): City[] {
  return cities.filter((c) => year >= c.from && year <= c.to);
}

function drawCityIcon(g: Graphics, x: number, y: number, rank: 1 | 2): void {
  if (rank === 1) {
    // Domed basilica: base, central dome, two flanking towers.
    g.rect(x - 6, y - 4, 12, 5).fill(CITY_BUILDING).stroke({ width: 0.7, color: CITY_OUTLINE });
    // arc() is a path command, not a shape: isolate it so it doesn't chain a
    // line from the previous city's path.
    g.beginPath();
    g.arc(x, y - 4, 3.6, Math.PI, 0);
    g.closePath();
    g.fill(CITY_ROOF).stroke({ width: 0.7, color: CITY_OUTLINE });
    g.beginPath();
    g.rect(x - 7.5, y - 8, 2.4, 9).fill(CITY_BUILDING).stroke({ width: 0.7, color: CITY_OUTLINE });
    g.rect(x + 5.1, y - 8, 2.4, 9).fill(CITY_BUILDING).stroke({ width: 0.7, color: CITY_OUTLINE });
    g.poly([x - 7.5, y - 8, x - 6.3, y - 10.4, x - 5.1, y - 8]).fill(CITY_ROOF);
    g.poly([x + 5.1, y - 8, x + 6.3, y - 10.4, x + 7.5, y - 8]).fill(CITY_ROOF);
  } else {
    // Small house with a tower.
    g.rect(x - 4, y - 3, 8, 4).fill(CITY_BUILDING).stroke({ width: 0.6, color: CITY_OUTLINE });
    g.poly([x - 4, y - 3, x, y - 6, x + 4, y - 3]).fill(CITY_ROOF).stroke({ width: 0.6, color: CITY_OUTLINE });
  }
}

/** City icons + labels for the given year. Rebuilt when the year range set changes. */
export function buildCitiesLayer(year: number, language: Language): Container {
  const layer = new Container();
  const g = new Graphics();
  layer.addChild(g);

  for (const city of visibleCities(year)) {
    const { x, y } = lonLatToIso(city.lonlat[0], city.lonlat[1]);
    drawCityIcon(g, x, y, city.rank);
    const label = new Text({
      text: city.name[language],
      style: {
        fontFamily: city.rank === 1 ? 'Cinzel, "Songti SC", serif' : 'Georgia, "Songti SC", serif',
        fontSize: city.rank === 1 ? 8.5 : 6.5,
        fill: 0xf3ead6,
        stroke: { color: 0x1a1028, width: 2 },
        fontWeight: city.rank === 1 ? '700' : '400',
      },
    });
    label.resolution = 3;
    label.anchor.set(0.5, 0);
    label.position.set(x, y + 2.5);
    layer.addChild(label);
  }

  return layer;
}
