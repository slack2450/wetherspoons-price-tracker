'use strict';

import { randomUUID } from 'node:crypto';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { venues } from 'wetherspoons-api';
import { beginRun, markPublishFailed } from './run-ledger';

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

export const handler = async (event: ScheduleEvent = {}): Promise<void> => {
  if (event.time !== undefined && Number.isNaN(Date.parse(event.time))) {
    throw new Error(`Schedule event contained an invalid time: ${event.time}`);
  }

  const runId = event.id ?? randomUUID();
  const observedAt = event.time ?? new Date().toISOString();
  const highLevelVenues = (await venues()).filter(venue => !venue.isClosed);

  if (highLevelVenues.length === 0) {
    throw new Error('Wetherspoons returned zero open pubs');
  }

  const shouldPublish = await beginRun(
    runId,
    observedAt,
    highLevelVenues.map(venue => venue.venueRef.toString()),
  );

  if (!shouldPublish) {
    console.log(`RUN_ALREADY_COMPLETE runId=${runId}`);
    return;
  }

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
    try {
      await markPublishFailed(runId, errorMessage(error));
    } catch (ledgerError) {
      if ((ledgerError as { name?: string }).name !== 'ConditionalCheckFailedException') {
        console.error(`RUN_FAILURE_STATUS_UPDATE_FAILED runId=${runId}`, ledgerError);
      }
    }
    throw error;
  }
};
