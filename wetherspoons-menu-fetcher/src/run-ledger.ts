import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

export type TerminalOutcome = 'written' | 'unavailable';
export type ClaimOutcome = 'claimed' | 'terminal' | 'busy';

type LedgerCommand = GetItemCommand | UpdateItemCommand;
type LedgerResponse = {
  Attributes?: Record<string, { N?: string }>
  Item?: Record<string, { N?: string, S?: string, SS?: string[], M?: Record<string, unknown> }>
};
export type SendLedger = (command: LedgerCommand) => Promise<LedgerResponse>;

function isConditionalFailure(error: unknown): boolean {
  return (error as { name?: string }).name === 'ConditionalCheckFailedException';
}

export function isRunComplete(processedCount: number, expectedCount: number): boolean {
  return expectedCount > 0 && processedCount === expectedCount;
}

async function readRun(
  send: SendLedger,
  tableName: string,
  runId: string,
): Promise<LedgerResponse['Item']> {
  const response = await send(new GetItemCommand({
    TableName: tableName,
    Key: { runId: { S: runId } },
    ConsistentRead: true,
  }));
  return response.Item;
}

export async function claimVenueWith(
  send: SendLedger,
  tableName: string,
  runId: string,
  venueId: string,
  leaseToken: string,
  observedAt: string,
  now = Date.now(),
  leaseDurationMs = 5 * 60_000,
): Promise<ClaimOutcome> {
  const tryClaim = () => send(new UpdateItemCommand({
    TableName: tableName,
    Key: { runId: { S: runId } },
    ConditionExpression: [
      'attribute_exists(runId)',
      'observedAt = :observedAt',
      'contains(expectedVenues, :venueId)',
      '(attribute_not_exists(processedVenues) OR NOT contains(processedVenues, :venueId))',
      '(attribute_not_exists(venueLeases.#venueId) OR venueLeases.#venueId.expiresAt < :now)',
    ].join(' AND '),
    UpdateExpression: 'SET venueLeases.#venueId = :lease, lastUpdatedAt = :now',
    ExpressionAttributeNames: { '#venueId': venueId },
    ExpressionAttributeValues: {
      ':venueId': { S: venueId },
      ':observedAt': { S: observedAt },
      ':lease': { M: {
        token: { S: leaseToken },
        expiresAt: { N: (now + leaseDurationMs).toString() },
      } },
      ':now': { N: now.toString() },
    },
  }));

  try {
    await tryClaim();
    return 'claimed';
  } catch (error) {
    if (!isConditionalFailure(error)) {
      // Runs created before lease support do not have the parent map, and
      // DynamoDB rejects a nested SET with ValidationException. Initialize it
      // conditionally, then retry the same membership-protected claim.
      if ((error as { name?: string }).name !== 'ValidationException') throw error;
      await send(new UpdateItemCommand({
        TableName: tableName,
        Key: { runId: { S: runId } },
        ConditionExpression: [
          'attribute_exists(runId)',
          'observedAt = :observedAt',
          'contains(expectedVenues, :venueId)',
          '(attribute_not_exists(processedVenues) OR NOT contains(processedVenues, :venueId))',
        ].join(' AND '),
        UpdateExpression: 'SET venueLeases = if_not_exists(venueLeases, :emptyMap)',
        ExpressionAttributeValues: {
          ':venueId': { S: venueId },
          ':observedAt': { S: observedAt },
          ':emptyMap': { M: {} },
        },
      }));
      await tryClaim();
      return 'claimed';
    }
  }

  const item = await readRun(send, tableName, runId);
  if (!item) throw new Error(`Run ${runId} does not exist`);
  if (item.observedAt?.S !== observedAt) {
    throw new Error(`Run ${runId} message has a non-canonical observedAt`);
  }
  if (!item.expectedVenues?.SS?.includes(venueId)) {
    throw new Error(`Venue ${venueId} is not part of run ${runId}`);
  }
  if (item.processedVenues?.SS?.includes(venueId)) return 'terminal';
  return 'busy';
}

export async function completeRunIfReady(
  send: SendLedger,
  tableName: string,
  runId: string,
): Promise<boolean> {
  try {
    await send(new UpdateItemCommand({
      TableName: tableName,
      Key: { runId: { S: runId } },
      ConditionExpression: 'processedCount = expectedCount AND (attribute_not_exists(#status) OR #status <> :complete)',
      UpdateExpression: 'SET #status = :complete, completedAt = :now, lastUpdatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':complete': { S: 'COMPLETE' },
        ':now': { N: Date.now().toString() },
      },
    }));
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function markTerminalWith(
  send: SendLedger,
  tableName: string,
  runId: string,
  venueId: string,
  leaseToken: string,
  outcome: TerminalOutcome,
): Promise<void> {
  const counter = outcome === 'written' ? 'writtenCount' : 'unavailableCount';
  let shouldCheckCompletion = false;
  try {
    const response = await send(new UpdateItemCommand({
      TableName: tableName,
      Key: { runId: { S: runId } },
      ConditionExpression: [
        'contains(expectedVenues, :venueId)',
        '(attribute_not_exists(processedVenues) OR NOT contains(processedVenues, :venueId))',
        'venueLeases.#venueId.#token = :leaseToken',
      ].join(' AND '),
      UpdateExpression: `SET lastUpdatedAt = :now REMOVE venueLeases.#venueId ADD processedVenues :venueSet, processedCount :one, ${counter} :one`,
      ExpressionAttributeNames: { '#venueId': venueId, '#token': 'token' },
      ExpressionAttributeValues: {
        ':venueId': { S: venueId },
        ':venueSet': { SS: [venueId] },
        ':leaseToken': { S: leaseToken },
        ':one': { N: '1' },
        ':now': { N: Date.now().toString() },
      },
      ReturnValues: 'ALL_NEW',
    }));
    shouldCheckCompletion = isRunComplete(
      Number(response.Attributes?.processedCount?.N),
      Number(response.Attributes?.expectedCount?.N),
    );
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
    const item = await readRun(send, tableName, runId);
    if (!item?.processedVenues?.SS?.includes(venueId)) {
      throw new Error(`Lease for venue ${venueId} in run ${runId} was lost before completion`);
    }
    shouldCheckCompletion = true;
    console.log(`RUN_VENUE_ALREADY_TERMINAL runId=${runId} venueId=${venueId}`);
  }

  const completed = shouldCheckCompletion
    ? await completeRunIfReady(send, tableName, runId)
    : false;
  if (completed) console.log(`RUN_COMPLETE runId=${runId}`);
}

const client = new DynamoDBClient({ region: 'eu-west-2' });
const send: SendLedger = command => client.send(command as UpdateItemCommand);

export function claimVenue(
  runId: string,
  venueId: string,
  leaseToken: string,
  observedAt: string,
): Promise<ClaimOutcome> {
  return claimVenueWith(send, process.env.RUN_TABLE_NAME!, runId, venueId, leaseToken, observedAt);
}

export function markTerminal(
  runId: string,
  venueId: string,
  leaseToken: string,
  outcome: TerminalOutcome,
): Promise<void> {
  return markTerminalWith(send, process.env.RUN_TABLE_NAME!, runId, venueId, leaseToken, outcome);
}
