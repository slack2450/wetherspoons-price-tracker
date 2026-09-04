import { SQSRecord } from 'aws-lambda';
import { vi } from 'vitest';
import { Dependencies } from './app';

export const venue = {
  franchise: 'jdw',
  id: 1,
  isClosed: false,
  name: 'Test Pub',
  venueRef: 1234,
  address: {},
};

export function record(messageId: string, venueRef = venue.venueRef): SQSRecord {
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

export function unavailableDependencies(): Dependencies {
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
