import { useAppStore } from '../state/store';
import type { EventCategory, LocalizedText } from '../data/schema';

const dict = {
  appTitle: { en: 'Eastern Roman Chronicle Map', zh: '东罗马编年地图' },
  appSubtitle: { en: 'AD 330 – 1453', zh: '公元330年—1453年' },
  play: { en: 'Play', zh: '播放' },
  pause: { en: 'Pause', zh: '暂停' },
  close: { en: 'Close', zh: '关闭' },
  legend: { en: 'Legend', zh: '图例' },
  territory: { en: 'Imperial territory', zh: '帝国疆域' },
  timeline: { en: 'Timeline', zh: '时间轴' },
  currentEra: { en: 'Current era', zh: '当前时代' },
  categories: { en: 'Event categories', zh: '事件类别' },
  terrainLegend: { en: 'Terrain', zh: '地形' },
  terrainSea: { en: 'Sea', zh: '海洋' },
  terrainGrass: { en: 'Grassland', zh: '草原' },
  terrainPlains: { en: 'Plains', zh: '平原' },
  terrainHills: { en: 'Hills', zh: '丘陵' },
  terrainMountain: { en: 'Mountains', zh: '山脉' },
  terrainDesert: { en: 'Desert', zh: '沙漠' },
  terrainSnow: { en: 'Snowcaps', zh: '雪峰' },
  eventsInEra: { en: 'Events of this era', zh: '本时代大事记' },
  dragHint: { en: 'Drag to pan · scroll to zoom', zh: '拖拽平移 · 滚轮缩放' },
  languageToggle: { en: '中文', zh: 'EN' },
} as const;

export type DictKey = keyof typeof dict;

export const categoryNames: Record<EventCategory, LocalizedText> = {
  politics: { en: 'Politics', zh: '政治' },
  military: { en: 'Military', zh: '军事' },
  economy: { en: 'Economy', zh: '经济' },
  culture: { en: 'Culture', zh: '文化' },
  art: { en: 'Art', zh: '艺术' },
  law: { en: 'Law', zh: '法律' },
  religion: { en: 'Religion', zh: '宗教' },
  civilization: { en: 'Civilization', zh: '文明' },
};

export function formatYear(year: number, lang: 'en' | 'zh'): string {
  return lang === 'zh' ? `公元${year}年` : `AD ${year}`;
}

export function formatYearRange(year: number, endYear: number | undefined, lang: 'en' | 'zh'): string {
  if (endYear === undefined || endYear === year) return formatYear(year, lang);
  return lang === 'zh' ? `公元${year}—${endYear}年` : `AD ${year}–${endYear}`;
}

/** UI string lookup bound to the current language. */
export function useT(): (key: DictKey) => string {
  const language = useAppStore((s) => s.language);
  return (key) => dict[key][language];
}

export function useLang() {
  return useAppStore((s) => s.language);
}
