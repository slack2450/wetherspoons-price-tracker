import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

export type SendLedgerCommand = (
  command: PutItemCommand | GetItemCommand | UpdateItemCommand,
) => Promise<unknown>;

function isConditionalFailure(error: unknown): boolean {
  return (error as { name?: string }).name === 'ConditionalCheckFailedException';
}

function sameVenueSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  const actual = new Set(right);
  return expected.size === left.length
    && actual.size === right.length
    && actual.size === expected.size
    && [...actual].every(id => expected.has(id));
}

const RUN_RETENTION_SECONDS = 21 * 24 * 60 * 60;

function assertUniqueVenueIds(venueIds: string[]): void {
  if (venueIds.length === 0) throw new Error('A run must contain at least one venue');
  if (new Set(venueIds).size !== venueIds.length) {
    throw new Error('A run cannot contain duplicate venue IDs');
  }
}

export async function beginRunWith(
  send: SendLedgerCommand,
  tableName: string,
  runId: string,
  observedAt: string,
  expectedVenueIds: string[],
): Promise<boolean> {
  // DynamoDB string sets silently collapse duplicates. Reject them before
  // expectedCount is persisted so the counter and immutable set cannot drift.
  assertUniqueVenueIds(expectedVenueIds);
  try {
    await send(new PutItemCommand({
      TableName: tableName,
      ConditionExpression: 'attribute_not_exists(runId)',
      Item: {
        runId: { S: runId },
        observedAt: { S: observedAt },
        startedAt: { N: Date.now().toString() },
        // Keep recovery state beyond the 14-day DLQ window. The additional
        // week also accounts for DynamoDB TTL's asynchronous deletion lag.
        expiresAt: { N: Math.floor(Date.now() / 1000 + RUN_RETENTION_SECONDS).toString() },
        status: { S: 'PROCESSING' },
        expectedCount: { N: expectedVenueIds.length.toString() },
        expectedVenues: { SS: expectedVenueIds },
        venueLeases: { M: {} },
        processedCount: { N: '0' },
        writtenCount: { N: '0' },
        unavailableCount: { N: '0' },
      },
    }));
    return true;
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }

  const existing = await send(new GetItemCommand({
    TableName: tableName,
    Key: { runId: { S: runId } },
    ConsistentRead: true,
  })) as { Item?: Record<string, { S?: string, SS?: string[] }> };
  const item = existing.Item;
  if (!item) throw new Error(`Run ${runId} disappeared while resuming`);
  if (item.observedAt?.S !== observedAt) {
    throw new Error(`Run ${runId} was retried with a different observedAt`);
  }
  const persistedVenueIds = item.expectedVenues?.SS;
  if (!persistedVenueIds || !sameVenueSet(persistedVenueIds, expectedVenueIds)) {
    throw new Error(`Venue set changed while retrying run ${runId}; refusing to publish drifted data`);
  }
  if (item.status?.S === 'COMPLETE') return false;

  try {
    await send(new UpdateItemCommand({
      TableName: tableName,
      Key: { runId: { S: runId } },
      ConditionExpression: 'attribute_not_exists(#status) OR #status <> :complete',
      UpdateExpression: 'SET #status = :processing, lastUpdatedAt = :now, venueLeases = if_not_exists(venueLeases, :emptyMap)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':processing': { S: 'PROCESSING' },
        ':complete': { S: 'COMPLETE' },
        ':emptyMap': { M: {} },
        ':now': { N: Date.now().toString() },
      },
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function markPublishFailedWith(
  send: SendLedgerCommand,
  tableName: string,
  runId: string,
  message: string,
): Promise<boolean> {
  try {
    await send(new UpdateItemCommand({
      TableName: tableName,
      Key: { runId: { S: runId } },
      ConditionExpression: 'attribute_not_exists(#status) OR #status <> :complete',
      UpdateExpression: 'SET #status = :failed, lastError = :error, lastUpdatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':complete': { S: 'COMPLETE' },
        ':failed': { S: 'PUBLISH_FAILED' },
        ':error': { S: message.slice(0, 1000) },
        ':now': { N: Date.now().toString() },
      },
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

const client = new DynamoDBClient({ region: 'eu-west-2' });

export function beginRun(
  runId: string,
  observedAt: string,
  expectedVenueIds: string[],
): Promise<boolean> {
  return beginRunWith(
    command => client.send(command as PutItemCommand),
    process.env.RUN_TABLE_NAME!,
    runId,
    observedAt,
    expectedVenueIds,
  );
}

export function markPublishFailed(runId: string, message: string): Promise<boolean> {
  return markPublishFailedWith(
    command => client.send(command as UpdateItemCommand),
    process.env.RUN_TABLE_NAME!,
    runId,
    message,
  );
}
