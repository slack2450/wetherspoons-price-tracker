import { Point } from '@influxdata/influxdb-client';
import { SQSRecord } from 'aws-lambda';
import { DrinksResult, highLevelVenueSchema } from 'wetherspoons-api';

interface RunMessage {
  runId: string
  observedAt: string
  venue: ReturnType<typeof highLevelVenueSchema.parse>
}

export interface PrepareDependencies {
  getDrinks: (venue: RunMessage['venue']) => Promise<DrinksResult>
}

interface PreparedWrite {
  kind: 'write'
  logMessage: string
  points: Point[]
}

interface PreparedUnavailable {
  kind: 'unavailable'
  logMessage: string
}

export type PreparedRecord = PreparedWrite | PreparedUnavailable;

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

export async function prepareRecord(
  record: SQSRecord,
  dependencies: PrepareDependencies,
): Promise<PreparedRecord> {
  const { runId, observedAt, venue } = parseRecord(record);
  const venueId = venue.venueRef.toString();
  const result = await dependencies.getDrinks(venue);
  if ((result as { partial?: boolean }).partial) {
    throw new Error(`Refusing to persist a partial menu for venue ${venueId}`);
  }

  if (result.status === 'unavailable') {
    return {
      kind: 'unavailable',
      logMessage:
        `MENU_UNAVAILABLE runId=${runId} venue=${venue.name} (${venueId}) reason=${result.reason}`,
    };
  }

  const points: Point[] = [];
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
    points.push(point);
  }

  return {
    kind: 'write',
    points,
    logMessage:
      `MENU_WRITTEN runId=${runId} venue=${venue.name} (${venueId}) points=${result.drinks.length}`,
  };
}
