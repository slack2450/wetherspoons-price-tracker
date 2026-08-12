'use strict';

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import {
  DrinksResult,
  getDrinks,
  highLevelVenueSchema,
} from 'wetherspoons-api';

const region = 'eu-west-2';
const dynamodb = new DynamoDBClient({ region });

type TerminalOutcome = 'written' | 'unavailable';

export function isRunComplete(processedCount: number, expectedCount: number): boolean {
  return expectedCount > 0 && processedCount === expectedCount;
}

interface RunMessage {
  runId: string
  observedAt: string
  venue: ReturnType<typeof highLevelVenueSchema.parse>
}

export interface Dependencies {
  getDrinks: (venue: RunMessage['venue']) => Promise<DrinksResult>
  createWriteApi: () => Pick<WriteApi, 'writePoint' | 'close'>
  markTerminal: (runId: string, venueId: string, outcome: TerminalOutcome) => Promise<void>
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

async function markTerminal(
  runId: string,
  venueId: string,
  outcome: TerminalOutcome,
): Promise<void> {
  const counter = outcome === 'written' ? 'writtenCount' : 'unavailableCount';
  let attributes;

  try {
    const response = await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.RUN_TABLE_NAME!,
      Key: { runId: { S: runId } },
      ConditionExpression: 'attribute_exists(runId) AND (attribute_not_exists(processedVenues) OR NOT contains(processedVenues, :venueId))',
      UpdateExpression: `SET lastUpdatedAt = :now ADD processedVenues :venueSet, processedCount :one, ${counter} :one`,
      ExpressionAttributeValues: {
        ':venueId': { S: venueId },
        ':venueSet': { SS: [venueId] },
        ':one': { N: '1' },
        ':now': { N: Date.now().toString() },
      },
      ReturnValues: 'ALL_NEW',
    }));
    attributes = response.Attributes;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      console.log(`RUN_VENUE_ALREADY_TERMINAL runId=${runId} venueId=${venueId}`);
      return;
    }
    throw error;
  }

  const processedCount = Number(attributes?.processedCount?.N);
  const expectedCount = Number(attributes?.expectedCount?.N);
  if (!isRunComplete(processedCount, expectedCount)) return;

  try {
    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.RUN_TABLE_NAME!,
      Key: { runId: { S: runId } },
      ConditionExpression: 'processedCount = expectedCount AND #status <> :complete',
      UpdateExpression: 'SET #status = :complete, completedAt = :now, lastUpdatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':complete': { S: 'COMPLETE' },
        ':now': { N: Date.now().toString() },
      },
    }));
    console.log(`RUN_COMPLETE runId=${runId} processed=${processedCount}`);
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
      throw error;
    }
  }
}

const defaultDependencies: Dependencies = {
  getDrinks,
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
  markTerminal,
};

export async function processRecord(
  record: SQSRecord,
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  const { runId, observedAt, venue } = parseRecord(record);
  const result = await dependencies.getDrinks(venue);
  const venueId = venue.venueRef.toString();

  if (result.status === 'unavailable') {
    await dependencies.markTerminal(runId, venueId, 'unavailable');
    console.log(
      `MENU_UNAVAILABLE runId=${runId} venue=${venue.name} (${venueId}) reason=${result.reason}`,
    );
    return;
  }

  const writeApi = dependencies.createWriteApi();
  const timestamp = new Date(observedAt);
  for (const drink of result.drinks) {
    writeApi.writePoint(new Point('drink')
      .tag('venueId', venueId)
      .tag('venueName', venue.name)
      .tag('productId', drink.productId.toString())
      .tag('productName', drink.name)
      .floatField('price', drink.price)
      .floatField('units', drink.units)
      .timestamp(timestamp));
  }

  // A record is terminal only after InfluxDB confirms that its complete venue
  // payload was flushed. Any error before this point returns the SQS item ID.
  await writeApi.close();
  await dependencies.markTerminal(runId, venueId, 'written');
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
