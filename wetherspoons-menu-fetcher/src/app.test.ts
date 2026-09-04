import { Point } from '@influxdata/influxdb-client';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { Dependencies, handle, processRecord } from './app';

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
  };
}

describe('menu fetcher', () => {
  it('records a legitimate unavailable menu without opening an Influx writer', async () => {
    const dependencies = unavailableDependencies();
    await processRecord(record('one'), dependencies);

    expect(dependencies.createWriteApi).not.toHaveBeenCalled();
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
  });

  it('only logs a record failure after SQS retries are exhausted', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => { throw new Error('upstream failed'); });
    const finalAttempt = record('failure');
    finalAttempt.attributes.ApproximateReceiveCount = '5';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handle({ Records: [finalAttempt] } as SQSEvent, dependencies);

    expect(error).toHaveBeenCalledWith(
      'MENU_RECORD_FAILED messageId=failure attempts=5',
      expect.any(Error),
    );
    error.mockRestore();
  });

  it('retries a venue when the Influx flush fails', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: vi.fn(),
      close: vi.fn(async () => { throw new Error('Influx timeout'); }),
    }));

    await expect(processRecord(record('one'), dependencies)).rejects.toThrow('Influx timeout');
  });

  it('does not persist a partial upstream menu', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      partial: true,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));

    await expect(processRecord(record('one'), dependencies)).rejects.toThrow('partial menu');
    expect(dependencies.createWriteApi).not.toHaveBeenCalled();
  });

  it('uses the run timestamp so retries write the identical Influx point', async () => {
    const lines: string[] = [];
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: (point: Point) => { lines.push(point.toLineProtocol()!); },
      close: vi.fn(async () => undefined),
    }));

    await processRecord(record('first'), dependencies);
    await processRecord(record('retry'), dependencies);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(lines[1]);
    expect(dependencies.getDrinks).toHaveBeenCalledTimes(2);
  });

  it('uses the current queue message venue name when retry metadata changes', async () => {
    const dependencies = unavailableDependencies();
    const lines: string[] = [];
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: (point: Point) => { lines.push(point.toLineProtocol()!); },
      close: vi.fn(async () => undefined),
    }));
    await processRecord(record('first'), dependencies);

    const renamed = record('retry');
    const envelope = JSON.parse(renamed.body) as { Message: string };
    const message = JSON.parse(envelope.Message) as {
      runId: string
      observedAt: string
      venue: typeof venue
    };
    message.venue.name = 'Renamed Pub';
    envelope.Message = JSON.stringify(message);
    renamed.body = JSON.stringify(envelope);

    await expect(processRecord(renamed, dependencies)).resolves.toBeUndefined();
    expect(dependencies.getDrinks).toHaveBeenCalledTimes(2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('venueName=Renamed\\ Pub');
  });

});
