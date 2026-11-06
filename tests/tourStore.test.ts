// Guided-tour state: every onboarding part shares one store, and a flow can
// resume at a specific step (the welcome page's CTA skips the intro).
import { describe, it, expect, beforeEach } from 'vitest';
import { useTourStore, type TourFlow } from '@/stores/tourStore';

function reset() {
  useTourStore.setState({ active: false, flow: 'menu', step: 0 });
}

describe('tourStore', () => {
  beforeEach(() => reset());

  it('opens the entry chooser by default', () => {
    useTourStore.getState().start();
    expect(useTourStore.getState()).toMatchObject({ active: true, flow: 'menu', step: 0 });
  });

  it('starts the debut flow at step 0', () => {
    useTourStore.getState().start('debut');
    expect(useTourStore.getState()).toMatchObject({ active: true, flow: 'debut', step: 0 });
  });

  it('starts each additional feature flow', () => {
    const flows: TourFlow[] = ['analysis', 'publish', 'launcher'];
    for (const flow of flows) {
      useTourStore.getState().start(flow);
      expect(useTourStore.getState()).toMatchObject({ active: true, flow, step: 0 });
    }
  });

  it('resumes a flow at a specific step', () => {
    useTourStore.getState().startAt('debut', 1);
    expect(useTourStore.getState()).toMatchObject({ active: true, flow: 'debut', step: 1 });
  });

  it('advances and finishes', () => {
    useTourStore.getState().start('ui');
    useTourStore.getState().next();
    expect(useTourStore.getState().step).toBe(1);
    useTourStore.getState().finish();
    expect(useTourStore.getState()).toMatchObject({ active: false, step: 0 });
  });
});
