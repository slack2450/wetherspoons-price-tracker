import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { loadSnapshotWith, saveSnapshotWith } from './snapshot-store';

describe('menu snapshot store', () => {
  const identity = {
    observedAt: '2026-08-12T21:00:00.000Z',
    venueId: '1234',
    venueName: 'Test Pub',
  };

  it('stores immutable run and venue snapshots', async () => {
    const send = vi.fn().mockResolvedValue({});
    const snapshot = { ...identity, result: { status: 'available' as const, drinks: [] } };
    await saveSnapshotWith(send, 'snapshots', 'run/1', '1234', snapshot);
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command.input.Key).toBe('runs/run%2F1/venues/1234.json');
    expect(command.input.IfNoneMatch).toBe('*');
  });

  it('loads a saved snapshot', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToString: async () => JSON.stringify({
        ...identity, result: { status: 'unavailable', drinks: [] },
      }) },
    });
    await expect(loadSnapshotWith(send, 'snapshots', 'run-1', '1234'))
      .resolves.toEqual({ ...identity, result: { status: 'unavailable', drinks: [] } });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it('returns undefined only for a missing object', async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    await expect(loadSnapshotWith(send, 'snapshots', 'run-1', '1234')).resolves.toBeUndefined();
  });

  it('rejects snapshots without complete canonical identity metadata', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToString: async () => JSON.stringify({
        observedAt: identity.observedAt,
        venueId: identity.venueId,
        result: { status: 'available', drinks: [] },
      }) },
    });
    await expect(loadSnapshotWith(send, 'snapshots', 'run-1', '1234'))
      .rejects.toThrow('invalid canonical identity');
  });

  it('accepts a concurrent immutable writer but propagates other failures', async () => {
    const precondition = vi.fn().mockRejectedValue(
      Object.assign(new Error('exists'), { name: 'PreconditionFailed' }),
    );
    await expect(saveSnapshotWith(precondition, 'snapshots', 'run-1', '1234', {
      ...identity,
      result: { status: 'available', drinks: [] },
    })).resolves.toBeUndefined();

    const failure = vi.fn().mockRejectedValue(new Error('S3 unavailable'));
    await expect(saveSnapshotWith(failure, 'snapshots', 'run-1', '1234', {
      ...identity,
      result: { status: 'available', drinks: [] },
    })).rejects.toThrow('S3 unavailable');
  });
});
