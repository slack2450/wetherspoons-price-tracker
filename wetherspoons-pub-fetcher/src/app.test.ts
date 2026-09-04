import { describe, expect, it, vi } from 'vitest';
import { Dependencies, run } from './app';

const openVenue = {
  franchise: 'jdw',
  id: 1,
  isClosed: false,
  name: 'Open Pub',
  venueRef: 1234,
  address: {},
};

function dependencies(): Dependencies {
  return {
    getVenues: vi.fn(async () => [
      openVenue,
      { ...openVenue, id: 2, venueRef: 5678, name: 'Closed Pub', isClosed: true },
    ]),
    publish: vi.fn(async () => undefined),
  };
}

describe('pub fetcher', () => {
  it('publishes each open venue with the scheduled observation identity', async () => {
    const deps = dependencies();
    await expect(run({ id: 'scheduled-run', time: '2026-09-04T12:00:00Z' }, deps))
      .resolves.toEqual({
        runId: 'scheduled-run',
        observedAt: '2026-09-04T12:00:00Z',
        publishedCount: 1,
      });

    expect(deps.publish).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.publish).mock.calls[0]![0])).toEqual({
      runId: 'scheduled-run',
      observedAt: '2026-09-04T12:00:00Z',
      venue: openVenue,
    });
  });

  it('publishes the same snapshot identity when a schedule event is retried', async () => {
    const deps = dependencies();
    const event = { id: 'scheduled-run', time: '2026-09-04T12:00:00Z' };

    await run(event, deps);
    await run(event, deps);

    expect(deps.publish).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.publish).mock.calls[0]![0])
      .toBe(vi.mocked(deps.publish).mock.calls[1]![0]);
  });

  it('rejects invalid schedule timestamps before querying venues', async () => {
    const deps = dependencies();
    await expect(run({ time: 'not-a-time' }, deps)).rejects.toThrow('invalid time');
    expect(deps.getVenues).not.toHaveBeenCalled();
  });

  it('rejects an empty open-venue response', async () => {
    const deps = dependencies();
    deps.getVenues = vi.fn(async () => []);
    await expect(run({}, deps)).rejects.toThrow('zero open pubs');
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('rejects duplicate venue references before publishing', async () => {
    const deps = dependencies();
    deps.getVenues = vi.fn(async () => [openVenue, { ...openVenue, id: 2 }]);
    await expect(run({}, deps)).rejects.toThrow('duplicate open venue references');
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('fails the invocation when any SNS publish fails so Scheduler retries it', async () => {
    const deps = dependencies();
    deps.publish = vi.fn(async () => { throw new Error('SNS unavailable'); });
    await expect(run({}, deps)).rejects.toThrow('SNS unavailable');
  });
});
