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
      ProjectionExpression: 'runId, observedAt, startedAt, #status, expectedCount, processedCount',
      ExpressionAttributeNames: { '#status': 'status' },
    }));
    items.push(...(response.Items ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export const handler = async (): Promise<void> => {
  const now = Date.now();
  const runs = await allRuns();
  const staleRuns = runs.filter(run => (
    run.status?.S !== 'COMPLETE'
    && Number(run.startedAt?.N ?? 0) < now - 30 * 60 * 1000
  ));
  const hasRecentRun = runs.some(run => Number(run.startedAt?.N ?? 0) >= now - 90 * 60 * 1000);
  const queue = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: process.env.DLQ_URL!,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
  }));
  const visible = Number(queue.Attributes?.ApproximateNumberOfMessages ?? 0);
  const inFlight = Number(queue.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);

  const problems: string[] = [];
  if (!hasRecentRun) problems.push('No collection run started in the last 90 minutes.');
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
