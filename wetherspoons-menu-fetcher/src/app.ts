'use strict';

import { randomUUID } from 'node:crypto';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import {
  DrinksResult,
  getDrinks,
  highLevelVenueSchema,
} from 'wetherspoons-api';
import { claimVenue, ClaimOutcome, markTerminal } from './run-ledger';
import { loadSnapshot, MenuSnapshot, saveSnapshot } from './snapshot-store';

export { isRunComplete } from './run-ledger';

type TerminalOutcome = 'written' | 'unavailable';
const SERVER_UPSTREAM_DEADLINE_MS = 25_000;
const getDrinksWithOptions = getDrinks as unknown as (
  venue: RunMessage['venue'],
  options: { timeoutMs: number },
) => Promise<DrinksResult>;

interface RunMessage {
  runId: string
  observedAt: string
  venue: ReturnType<typeof highLevelVenueSchema.parse>
}

export interface Dependencies {
  getDrinks: (venue: RunMessage['venue']) => Promise<DrinksResult>
  createWriteApi: () => Pick<WriteApi, 'writePoint' | 'close'>
  claimVenue: (
    runId: string,
    venueId: string,
    leaseToken: string,
    observedAt: string,
  ) => Promise<ClaimOutcome>
  loadSnapshot: (runId: string, venueId: string) => Promise<MenuSnapshot | undefined>
  saveSnapshot: (runId: string, venueId: string, snapshot: MenuSnapshot) => Promise<void>
  markTerminal: (
    runId: string,
    venueId: string,
    leaseToken: string,
    outcome: TerminalOutcome,
  ) => Promise<void>
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
  getDrinks: venue => getDrinksWithOptions(venue, { timeoutMs: SERVER_UPSTREAM_DEADLINE_MS }),
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
  claimVenue,
  loadSnapshot,
  saveSnapshot,
  markTerminal,
};

export async function processRecord(
  record: SQSRecord,
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  const { runId, observedAt, venue } = parseRecord(record);
  const venueId = venue.venueRef.toString();
  const leaseToken = randomUUID();
  const claim = await dependencies.claimVenue(runId, venueId, leaseToken, observedAt);
  if (claim === 'terminal') {
    console.log(`MENU_ALREADY_TERMINAL runId=${runId} venue=${venue.name} (${venueId})`);
    return;
  }
  if (claim === 'busy') throw new Error(`Venue ${venueId} is already being processed`);

  let snapshot = await dependencies.loadSnapshot(runId, venueId);
  if (!snapshot) {
    const result = await dependencies.getDrinks(venue);
    if ((result as { partial?: boolean }).partial) {
      throw new Error(`Refusing to persist a partial menu for venue ${venueId}`);
    }
    await dependencies.saveSnapshot(runId, venueId, {
      observedAt,
      venueId,
      venueName: venue.name,
      result,
    });
    // At an expired-lease boundary another worker's immutable snapshot may
    // have won the conditional put, so always reload the canonical object.
    snapshot = await dependencies.loadSnapshot(runId, venueId);
    if (!snapshot) throw new Error(`Menu snapshot was not readable after saving for venue ${venueId}`);
  }

  if (snapshot.observedAt !== observedAt) {
    throw new Error(`Snapshot for run ${runId} venue ${venueId} has a conflicting observedAt`);
  }
  if (snapshot.venueId !== venueId) {
    throw new Error(`Snapshot for run ${runId} venue ${venueId} has a conflicting venue ID`);
  }
  const { result } = snapshot;

  if (result.status === 'unavailable') {
    await dependencies.markTerminal(runId, venueId, leaseToken, 'unavailable');
    console.log(
      `MENU_UNAVAILABLE runId=${runId} venue=${snapshot.venueName} (${venueId}) reason=${result.reason}`,
    );
    return;
  }

  if ((result as { partial?: boolean }).partial) {
    throw new Error(`Refusing to persist a partial menu for venue ${venueId}`);
  }

  const writeApi = dependencies.createWriteApi();
  const timestamp = new Date(snapshot.observedAt);
  for (const drink of result.drinks) {
    const point = new Point('drink')
      .tag('venueId', snapshot.venueId)
      .tag('venueName', snapshot.venueName)
      .tag('productId', drink.productId.toString())
      .tag('productName', drink.name)
      .floatField('price', drink.price)
      .floatField('units', drink.units)
      .timestamp(timestamp);
    const currency = (drink as { currency?: unknown }).currency;
    if (typeof currency === 'string') point.tag('currency', currency);
    writeApi.writePoint(point);
  }

  // A record is terminal only after InfluxDB confirms that its complete venue
  // payload was flushed. Any error before this point returns the SQS item ID.
  await writeApi.close();
  await dependencies.markTerminal(runId, venueId, leaseToken, 'written');
  console.log(
    `MENU_WRITTEN runId=${runId} venue=${snapshot.venueName} (${venueId}) points=${result.drinks.length}`,
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
