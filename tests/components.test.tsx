import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timeline } from '../src/ui/Timeline';
import { EventPanel } from '../src/ui/EventPanel';
import { EventMarkers } from '../src/map/EventMarkers';
import { Header } from '../src/ui/Header';
import { useAppStore } from '../src/state/store';
import { events, snapshots } from '../src/data';
import { eventsForYear } from '../src/lib/timeline';
import { YEAR_MIN } from '../src/data/schema';

beforeEach(() => {
  useAppStore.setState({
    year: YEAR_MIN,
    isPlaying: false,
    selectedEventId: null,
    language: 'zh',
    viewVersion: 0,
  });
});

describe('Timeline', () => {
  it('toggles autoplay with the play button', async () => {
    render(<Timeline />);
    await userEvent.click(screen.getByTestId('play-button'));
    expect(useAppStore.getState().isPlaying).toBe(true);
    await userEvent.click(screen.getByTestId('play-button'));
    expect(useAppStore.getState().isPlaying).toBe(false);
  });

  it('seeks and pauses when the track is clicked', () => {
    useAppStore.setState({ isPlaying: true });
    render(<Timeline />);
    const track = screen.getByTestId('timeline-track');
    track.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 22, right: 1000, bottom: 22, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(track, { clientX: 500, pointerId: 1 });
    expect(useAppStore.getState().isPlaying).toBe(false);
    // Halfway along the track ≈ year 891
    expect(useAppStore.getState().year).toBeGreaterThan(850);
    expect(useAppStore.getState().year).toBeLessThan(950);
  });

  it('scrubs while dragging along the track', () => {
    render(<Timeline />);
    const track = screen.getByTestId('timeline-track');
    track.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 22, right: 1000, bottom: 22, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(track, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 750, pointerId: 1, buttons: 1 });
    // Three-quarters along the track ≈ year 1172
    expect(useAppStore.getState().year).toBeGreaterThan(1100);
    expect(useAppStore.getState().year).toBeLessThan(1250);
  });

  it('shows the year in the active language', () => {
    render(<Timeline />);
    expect(screen.getByTestId('year-display').textContent).toContain('公元330年');
    act(() => useAppStore.setState({ language: 'en' }));
    expect(screen.getByTestId('year-display').textContent).toContain('AD 330');
  });
});

describe('EventMarkers', () => {
  it('renders a marker for each event of the current era', () => {
    render(<EventMarkers />);
    const expected = eventsForYear(events, snapshots, YEAR_MIN);
    expect(expected.length).toBeGreaterThan(0);
    for (const e of expected) {
      expect(document.querySelector(`[data-event-id="${e.id}"]`)).toBeInTheDocument();
    }
  });

  it('clicking a marker stops autoplay and selects the event', async () => {
    useAppStore.setState({ isPlaying: true });
    render(<EventMarkers />);
    const first = eventsForYear(events, snapshots, YEAR_MIN)[0];
    await userEvent.click(document.querySelector(`[data-event-id="${first.id}"]`)!);
    expect(useAppStore.getState().isPlaying).toBe(false);
    expect(useAppStore.getState().selectedEventId).toBe(first.id);
  });
});

describe('EventPanel', () => {
  it('renders nothing without a selection', () => {
    render(<EventPanel />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows localized event content and closes', async () => {
    const event = events[0];
    useAppStore.setState({ selectedEventId: event.id });
    render(<EventPanel />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(event.title.zh)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(useAppStore.getState().selectedEventId).toBeNull();
  });

  it('switches content language', () => {
    const event = events[0];
    useAppStore.setState({ selectedEventId: event.id, language: 'en' });
    render(<EventPanel />);
    expect(screen.getByText(event.title.en)).toBeInTheDocument();
  });
});

describe('Header', () => {
  it('toggles the language', async () => {
    render(<Header />);
    expect(useAppStore.getState().language).toBe('zh');
    await userEvent.click(screen.getByTestId('language-toggle'));
    expect(useAppStore.getState().language).toBe('en');
  });
});
