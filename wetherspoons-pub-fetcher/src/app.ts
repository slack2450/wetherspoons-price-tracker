'use strict';

import { randomUUID } from 'node:crypto';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { venues } from 'wetherspoons-api';

const region = 'eu-west-2';
const dynamodb = new DynamoDBClient({ region });
const sns = new SNSClient({ region });

interface ScheduleEvent {
  id?: string
  time?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createRun(
  runId: string,
  observedAt: string,
  expectedVenueIds: string[],
): Promise<void> {
  try {
    await dynamodb.send(new PutItemCommand({
      TableName: process.env.RUN_TABLE_NAME!,
      ConditionExpression: 'attribute_not_exists(runId)',
      Item: {
        runId: { S: runId },
        observedAt: { S: observedAt },
        startedAt: { N: Date.now().toString() },
        expiresAt: { N: Math.floor(Date.now() / 1000 + 7 * 24 * 60 * 60).toString() },
        status: { S: 'PROCESSING' },
        expectedCount: { N: expectedVenueIds.length.toString() },
        expectedVenues: { SS: expectedVenueIds },
        processedCount: { N: '0' },
        writtenCount: { N: '0' },
        unavailableCount: { N: '0' },
      },
    }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
      throw error;
    }

    // EventBridge retries reuse the event ID. Retaining the existing ledger makes
    // republishing safe because menu writes use the run's fixed timestamp.
    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.RUN_TABLE_NAME!,
      Key: { runId: { S: runId } },
      UpdateExpression: 'SET #status = :processing, lastUpdatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':processing': { S: 'PROCESSING' },
        ':now': { N: Date.now().toString() },
      },
    }));
  }
}

export const handler = async (event: ScheduleEvent = {}): Promise<void> => {
  const runId = event.id ?? randomUUID();
  const observedAt = event.time ?? new Date().toISOString();
  const highLevelVenues = (await venues()).filter(venue => !venue.isClosed);

  if (highLevelVenues.length === 0) {
    throw new Error('Wetherspoons returned zero open pubs');
  }

  await createRun(
    runId,
    observedAt,
    highLevelVenues.map(venue => venue.venueRef.toString()),
  );

  console.log(`RUN_STARTED runId=${runId} observedAt=${observedAt} expected=${highLevelVenues.length}`);

  try {
    for (let offset = 0; offset < highLevelVenues.length; offset += 25) {
      const batch = highLevelVenues.slice(offset, offset + 25);
      await Promise.all(batch.map(async venue => {
        console.log(`Submitting ${venue.name} (${venue.id}) for processing`);
        await sns.send(new PublishCommand({
          TopicArn: process.env.PUBS_TOPIC_ARN!,
          Message: JSON.stringify({ runId, observedAt, venue }),
        }));
      }));
    }

    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.RUN_TABLE_NAME!,
      Key: { runId: { S: runId } },
      UpdateExpression: 'SET publishedAt = :now, lastUpdatedAt = :now',
      ExpressionAttributeValues: { ':now': { N: Date.now().toString() } },
    }));
    console.log(`RUN_PUBLISHED runId=${runId} count=${highLevelVenues.length}`);
  } catch (error) {
    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.RUN_TABLE_NAME!,
      Key: { runId: { S: runId } },
      UpdateExpression: 'SET #status = :failed, lastError = :error, lastUpdatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':failed': { S: 'PUBLISH_FAILED' },
        ':error': { S: errorMessage(error).slice(0, 1000) },
        ':now': { N: Date.now().toString() },
      },
    }));
    throw error;
  }
};
