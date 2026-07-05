import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, clampYear } from '../src/state/store';
import { YEAR_MIN, YEAR_MAX } from '../src/data/schema';

beforeEach(() => {
  useAppStore.setState({
    year: YEAR_MIN,
    isPlaying: false,
    selectedEventId: null,
    language: 'zh',
  });
});

describe('clampYear', () => {
  it('clamps to the historical span', () => {
    expect(clampYear(100)).toBe(YEAR_MIN);
    expect(clampYear(2000)).toBe(YEAR_MAX);
    expect(clampYear(800)).toBe(800);
  });
});

describe('store behavior', () => {
  it('selecting an event stops autoplay', () => {
    useAppStore.getState().play();
    expect(useAppStore.getState().isPlaying).toBe(true);
    useAppStore.getState().selectEvent('some-event');
    expect(useAppStore.getState().isPlaying).toBe(false);
    expect(useAppStore.getState().selectedEventId).toBe('some-event');
  });

  it('deselecting does not resume autoplay', () => {
    useAppStore.getState().selectEvent('some-event');
    useAppStore.getState().selectEvent(null);
    expect(useAppStore.getState().isPlaying).toBe(false);
  });

  it('play from the end restarts at the beginning', () => {
    useAppStore.setState({ year: YEAR_MAX });
    useAppStore.getState().play();
    expect(useAppStore.getState().year).toBe(YEAR_MIN);
    expect(useAppStore.getState().isPlaying).toBe(true);
  });

  it('setYear clamps out-of-range values', () => {
    useAppStore.getState().setYear(9999);
    expect(useAppStore.getState().year).toBe(YEAR_MAX);
  });
});
