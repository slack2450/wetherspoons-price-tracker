import { Point } from '@influxdata/influxdb-client';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { Dependencies, handle, isRunComplete, processRecord } from './app';

const venue = {
  franchise: 'jdw',
  id: 1,
  isClosed: false,
  name: 'Test Pub',
  venueRef: 1234,
  address: {},
};

function record(messageId: string, venueRef = venue.venueRef): SQSRecord {
  return {
    messageId,
    receiptHandle: 'receipt',
    body: JSON.stringify({
      Message: JSON.stringify({
        runId: 'run-1',
        observedAt: '2026-08-12T21:00:00.000Z',
        venue: { ...venue, venueRef },
      }),
    }),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '0',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-west-2:123456789012:test',
    awsRegion: 'eu-west-2',
  };
}

function unavailableDependencies(): Dependencies {
  return {
    getDrinks: vi.fn(async () => ({
      status: 'unavailable' as const,
      reason: 'ordering-unavailable' as const,
      drinks: [] as [],
    })),
    createWriteApi: vi.fn(() => ({
      writePoint: vi.fn(),
      close: vi.fn(async () => undefined),
    })),
    markTerminal: vi.fn(async () => undefined),
  };
}

describe('menu fetcher', () => {
  it('cannot complete a run before every expected venue is terminal', () => {
    expect(isRunComplete(793, 794)).toBe(false);
    expect(isRunComplete(794, 794)).toBe(true);
    expect(isRunComplete(0, 0)).toBe(false);
  });

  it('records a legitimate unavailable menu without opening an Influx writer', async () => {
    const dependencies = unavailableDependencies();
    await processRecord(record('one'), dependencies);

    expect(dependencies.createWriteApi).not.toHaveBeenCalled();
    expect(dependencies.markTerminal).toHaveBeenCalledWith('run-1', '1234', 'unavailable');
  });

  it('returns only failed SQS records for retry', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async currentVenue => {
      if (currentVenue.venueRef === 5678) throw new Error('upstream failed');
      return {
        status: 'unavailable' as const,
        reason: 'ordering-unavailable' as const,
        drinks: [] as [],
      };
    });
    const event = { Records: [record('success'), record('failure', 5678)] } as SQSEvent;

    await expect(handle(event, dependencies)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'failure' }],
    });
    expect(dependencies.markTerminal).toHaveBeenCalledTimes(1);
  });

  it('does not mark a venue terminal when the Influx flush fails', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5 }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: vi.fn(),
      close: vi.fn(async () => { throw new Error('Influx timeout'); }),
    }));

    await expect(processRecord(record('one'), dependencies)).rejects.toThrow('Influx timeout');
    expect(dependencies.markTerminal).not.toHaveBeenCalled();
  });

  it('uses the run timestamp so retries write the identical Influx point', async () => {
    const lines: string[] = [];
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5 }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: (point: Point) => { lines.push(point.toLineProtocol()!); },
      close: vi.fn(async () => undefined),
    }));

    await processRecord(record('first'), dependencies);
    await processRecord(record('retry'), dependencies);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(lines[1]);
    expect(dependencies.markTerminal).toHaveBeenCalledTimes(2);
  });
});
