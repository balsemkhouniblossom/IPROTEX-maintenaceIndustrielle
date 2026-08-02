import { mapWithConcurrency } from './scheduler-utils';

describe('scheduler utilities', () => {
  it('never exceeds the configured concurrency limit and isolates item failures', async () => {
    let active = 0;
    let maxActive = 0;
    const failures: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (item === 3) failures.push(item);
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(failures).toEqual([3]);
  });
});
