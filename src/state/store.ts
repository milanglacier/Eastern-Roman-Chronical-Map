import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { YEAR_MIN, YEAR_MAX } from '../data/schema';

export type Language = 'en' | 'zh';
export type MapView = { kind: 'world' } | { kind: 'city'; cityId: string };

interface AppState {
  year: number;
  isPlaying: boolean;
  language: Language;
  selectedEventId: string | null;
  /**
   * Monotone counter bumped by the 3D camera whenever the view changes; DOM
   * overlays subscribe to it and re-project via map/three/projection.ts (a
   * function has no place in a persisted store).
   */
  viewVersion: number;
  /** Requested view; MapCanvas animates the transition when it changes. */
  view: MapView;
  /** City view offered because the world camera is zoomed in near it. */
  lensCandidate: string | null;
  setYear: (year: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  selectEvent: (id: string | null) => void;
  setLanguage: (lang: Language) => void;
  bumpView: () => void;
  enterCity: (cityId: string) => void;
  exitCity: () => void;
  setLensCandidate: (cityId: string | null) => void;
}

export const clampYear = (year: number): number =>
  Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      year: YEAR_MIN,
      isPlaying: false,
      language: 'en',
      selectedEventId: null,
      viewVersion: 0,
      view: { kind: 'world' },
      lensCandidate: null,
      setYear: (year) => set({ year: clampYear(year) }),
      play: () =>
        set((s) => ({
          isPlaying: true,
          // Restart from the beginning when play is hit at the end of history.
          year: s.year >= YEAR_MAX ? YEAR_MIN : s.year,
          selectedEventId: null,
        })),
      pause: () => set({ isPlaying: false }),
      togglePlay: () => set((s) => (s.isPlaying ? { isPlaying: false } : { isPlaying: true, year: s.year >= YEAR_MAX ? YEAR_MIN : s.year, selectedEventId: null })),
      // Selecting an event always stops autoplay (user requirement).
      selectEvent: (id) => set((s) => ({ selectedEventId: id, isPlaying: id === null ? s.isPlaying : false })),
      setLanguage: (language) => set({ language }),
      bumpView: () => set((s) => ({ viewVersion: (s.viewVersion + 1) % 0x7fffffff })),
      enterCity: (cityId) => set({ view: { kind: 'city', cityId }, selectedEventId: null }),
      exitCity: () => set({ view: { kind: 'world' }, selectedEventId: null }),
      setLensCandidate: (lensCandidate) =>
        set((s) => (s.lensCandidate === lensCandidate ? s : { lensCandidate })),
    }),
    {
      name: 'east-roman-map-prefs',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ language: s.language }),
    },
  ),
);
