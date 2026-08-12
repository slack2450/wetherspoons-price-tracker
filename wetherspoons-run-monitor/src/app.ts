'use strict';

import { AttributeValue, DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

const region = 'eu-west-2';
const dynamodb = new DynamoDBClient({ region });
const sns = new SNSClient({ region });
const sqs = new SQSClient({ region });

async function allRuns(): Promise<Record<string, AttributeValue>[]> {
  const items: Record<string, AttributeValue>[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;
  do {
    const response = await dynamodb.send(new ScanCommand({
      TableName: process.env.RUN_TABLE_NAME!,
      ExclusiveStartKey: exclusiveStartKey,
      ProjectionExpression: 'runId, observedAt, startedAt, #status, expectedCount, processedCount, writtenCount, unavailableCount',
      ExpressionAttributeNames: { '#status': 'status' },
    }));
    items.push(...(response.Items ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export const handler = async (): Promise<void> => {
  const now = Date.now();
  const londonHour = Number(new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/London',
  }).format(new Date(now)));
  const runs = await allRuns();
  const staleRuns = runs.filter(run => (
    run.status?.S !== 'COMPLETE'
    && Number(run.startedAt?.N ?? 0) < now - 75 * 60 * 1000
  ));
  const hasRecentRun = runs.some(run => Number(run.startedAt?.N ?? 0) >= now - 90 * 60 * 1000);
  const queue = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: process.env.DLQ_URL!,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
  }));
  const visible = Number(queue.Attributes?.ApproximateNumberOfMessages ?? 0);
  const inFlight = Number(queue.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);

  const problems: string[] = [];
  // Collections are scheduled hourly from 08:00 through 23:00 London time.
  // Outside that window, keep checking incomplete runs and the DLQ without
  // reporting the intentional overnight gap as a missed run.
  if (londonHour >= 8 && !hasRecentRun) {
    problems.push('No collection run started in the last 90 minutes during operational hours.');
  }
  const latestRun = runs.reduce<Record<string, AttributeValue> | undefined>((latest, run) => (
    Number(run.startedAt?.N ?? 0) > Number(latest?.startedAt?.N ?? 0) ? run : latest
  ), undefined);
  if (londonHour >= 10 && londonHour <= 21 && latestRun?.status?.S === 'COMPLETE') {
    const expected = Number(latestRun.expectedCount?.N ?? 0);
    const unavailable = Number(latestRun.unavailableCount?.N ?? 0);
    if (expected > 0 && unavailable / expected > 0.25) {
      problems.push(
        `Latest completed run ${latestRun.runId?.S ?? 'unknown'} had ${unavailable}/${expected} venues unavailable.`,
      );
    }
  }
  if (visible + inFlight > 0) {
    problems.push(`Dead-letter queue contains ${visible} visible and ${inFlight} in-flight messages.`);
  }
  for (const run of staleRuns) {
    problems.push(
      `Run ${run.runId?.S ?? 'unknown'} is ${run.status?.S ?? 'UNKNOWN'}: `
      + `${run.processedCount?.N ?? '0'}/${run.expectedCount?.N ?? '?'} venues terminal.`,
    );
  }

  if (problems.length === 0) {
    console.log('PIPELINE_HEALTHY');
    return;
  }

  const message = [
    'The Wetherspoons price collection pipeline is incomplete.',
    '',
    ...problems,
    '',
    'This monitor repeats hourly until the underlying condition is resolved.',
  ].join('\n');
  console.error(`PIPELINE_INCOMPLETE ${message.replaceAll('\n', ' | ')}`);
  await sns.send(new PublishCommand({
    TopicArn: process.env.ALARM_TOPIC_ARN!,
    Subject: 'Wetherspoons pipeline incomplete',
    Message: message,
  }));
};
