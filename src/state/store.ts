import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { YEAR_MIN, YEAR_MAX } from '../data/schema';

export type Language = 'en' | 'zh';

export interface CameraState {
  x: number;
  y: number;
  scale: number;
}

interface AppState {
  year: number;
  isPlaying: boolean;
  language: Language;
  selectedEventId: string | null;
  camera: CameraState;
  setYear: (year: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  selectEvent: (id: string | null) => void;
  setLanguage: (lang: Language) => void;
  setCamera: (camera: CameraState) => void;
}

export const clampYear = (year: number): number =>
  Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      year: YEAR_MIN,
      isPlaying: false,
      language: 'zh',
      selectedEventId: null,
      camera: { x: 0, y: 0, scale: 1 },
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
      setCamera: (camera) => set({ camera }),
    }),
    {
      name: 'east-roman-map-prefs',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ language: s.language }),
    },
  ),
);
