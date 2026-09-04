'use strict';

import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import {
  DrinksResult,
  getDrinks,
  highLevelVenueSchema,
} from 'wetherspoons-api';
const SERVER_UPSTREAM_DEADLINE_MS = 25_000;

interface RunMessage {
  runId: string
  observedAt: string
  venue: ReturnType<typeof highLevelVenueSchema.parse>
}

export interface Dependencies {
  getDrinks: (venue: RunMessage['venue']) => Promise<DrinksResult>
  createWriteApi: () => Pick<WriteApi, 'writePoint' | 'close'>
}

function parseRecord(record: SQSRecord): RunMessage {
  const notification = JSON.parse(record.body) as { Message?: string };
  if (typeof notification.Message !== 'string') {
    throw new Error(`SQS record ${record.messageId} did not contain an SNS Message`);
  }

  const raw = JSON.parse(notification.Message) as Partial<RunMessage>;
  if (typeof raw.runId !== 'string' || raw.runId.length === 0) {
    throw new Error(`SQS record ${record.messageId} did not contain a runId`);
  }
  if (typeof raw.observedAt !== 'string' || Number.isNaN(Date.parse(raw.observedAt))) {
    throw new Error(`SQS record ${record.messageId} contained an invalid observedAt`);
  }

  return {
    runId: raw.runId,
    observedAt: raw.observedAt,
    venue: highLevelVenueSchema.parse(raw.venue),
  };
}

const defaultDependencies: Dependencies = {
  getDrinks: venue => getDrinks(venue, { timeoutMs: SERVER_UPSTREAM_DEADLINE_MS }),
  createWriteApi: () => new InfluxDB({
    url: process.env.INFLUXDB_URL!,
    token: process.env.INFLUXDB_WRITE_API_TOKEN!,
    timeout: 30000,
  }).getWriteApi(
      process.env.INFLUXDB_ORG!,
      process.env.INFLUXDB_BUCKET!,
      'ms',
      {
        batchSize: 1000,
        flushInterval: 1000,
        maxRetries: 2,
        maxRetryTime: 60000,
        minRetryDelay: 1000,
        maxRetryDelay: 15000,
      },
    ),
};

export async function processRecord(
  record: SQSRecord,
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  const { runId, observedAt, venue } = parseRecord(record);
  const venueId = venue.venueRef.toString();
  const result = await dependencies.getDrinks(venue);
  if ((result as { partial?: boolean }).partial) {
    throw new Error(`Refusing to persist a partial menu for venue ${venueId}`);
  }

  if (result.status === 'unavailable') {
    console.log(
      `MENU_UNAVAILABLE runId=${runId} venue=${venue.name} (${venueId}) reason=${result.reason}`,
    );
    return;
  }

  const writeApi = dependencies.createWriteApi();
  const timestamp = new Date(observedAt);
  for (const drink of result.drinks) {
    const point = new Point('drink')
      .tag('venueId', venueId)
      .tag('productId', drink.productId.toString())
      .floatField('price', drink.price)
      .floatField('units', drink.units)
      .stringField('venueName', venue.name)
      .stringField('productName', drink.name)
      .timestamp(timestamp);
    const currency = (drink as { currency?: unknown }).currency;
    if (typeof currency === 'string') point.stringField('currency', currency);
    writeApi.writePoint(point);
  }

  // SQS deletes a record only after InfluxDB confirms that the complete venue
  // payload was flushed. Any error before this point returns the item ID.
  await writeApi.close();
  console.log(
    `MENU_WRITTEN runId=${runId} venue=${venue.name} (${venueId}) points=${result.drinks.length}`,
  );
}

export async function handle(
  event: SQSEvent,
  dependencies: Dependencies = defaultDependencies,
): Promise<SQSBatchResponse> {
  const results = await Promise.allSettled(
    event.Records.map(record => processRecord(record, dependencies)),
  );

  const batchItemFailures: SQSBatchItemFailure[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    const record = event.Records[index];
    if (!record) return;
    const receiveCount = Number(record.attributes.ApproximateReceiveCount ?? 1);
    const maxReceiveCount = Number(process.env.MAX_RECEIVE_COUNT ?? 5);
    if (receiveCount >= maxReceiveCount) {
      console.error(
        `MENU_RECORD_FAILED messageId=${record.messageId} attempts=${receiveCount}`,
        result.reason,
      );
    } else {
      console.warn(
        `MENU_RECORD_RETRY messageId=${record.messageId} attempt=${receiveCount}/${maxReceiveCount}`,
        result.reason,
      );
    }
    batchItemFailures.push({ itemIdentifier: record.messageId });
  });

  return { batchItemFailures };
}

export const handler = (event: SQSEvent): Promise<SQSBatchResponse> => handle(event);
