import { GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  claimVenueWith,
  completeRunIfReady,
  isRunComplete,
  markTerminalWith,
} from './run-ledger';

function conditionalFailure(): Error {
  return Object.assign(new Error('condition failed'), { name: 'ConditionalCheckFailedException' });
}

const observedAt = '2026-08-12T21:00:00.000Z';

describe('run ledger', () => {
  it('recognises completion only at the exact expected count', () => {
    expect(isRunComplete(793, 794)).toBe(false);
    expect(isRunComplete(794, 794)).toBe(true);
    expect(isRunComplete(795, 794)).toBe(false);
    expect(isRunComplete(0, 0)).toBe(false);
  });

  it('claims an expected venue with an expiring lease', async () => {
    const send = vi.fn().mockResolvedValue({});
    await expect(claimVenueWith(
      send, 'runs', 'run-1', '1234', 'lease-1', observedAt, 1_000, 5_000,
    ))
      .resolves.toBe('claimed');
    const command = send.mock.calls[0]?.[0] as UpdateItemCommand;
    expect(command.input.ConditionExpression).toContain('contains(expectedVenues, :venueId)');
    expect(command.input.ConditionExpression).toContain('observedAt = :observedAt');
    expect(command.input.ExpressionAttributeValues?.[':lease']).toEqual({ M: {
      token: { S: 'lease-1' }, expiresAt: { N: '6000' },
    } });
  });

  it('recognises a completed duplicate after a rejected claim', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['1234'] }, processedVenues: { SS: ['1234'] },
      } });
    await expect(claimVenueWith(send, 'runs', 'run-1', '1234', 'lease-2', observedAt))
      .resolves.toBe('terminal');
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetItemCommand);
  });

  it('initializes the lease map for a pre-deployment in-flight run', async () => {
    const validation = Object.assign(new Error('document path invalid'), { name: 'ValidationException' });
    const send = vi.fn()
      .mockRejectedValueOnce(validation)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    await expect(claimVenueWith(send, 'runs', 'run-1', '1234', 'lease-2', observedAt))
      .resolves.toBe('claimed');
    const migration = send.mock.calls[1]?.[0] as UpdateItemCommand;
    expect(migration.input.UpdateExpression).toContain('if_not_exists(venueLeases, :emptyMap)');
    expect(migration.input.ConditionExpression).toContain('contains(expectedVenues, :venueId)');
  });

  it('rejects a venue that is not in the immutable expected set', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: { observedAt: { S: observedAt }, expectedVenues: { SS: ['5678'] } } });
    await expect(claimVenueWith(send, 'runs', 'run-1', '1234', 'lease-2', observedAt))
      .rejects.toThrow('not part of run');
  });

  it('reports an in-flight lease as busy', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: { observedAt: { S: observedAt }, expectedVenues: { SS: ['1234'] } } });
    await expect(claimVenueWith(send, 'runs', 'run-1', '1234', 'lease-2', observedAt))
      .resolves.toBe('busy');
  });

  it('rejects a message timestamp that differs from the canonical run timestamp', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['1234'] },
      } });
    await expect(claimVenueWith(
      send, 'runs', 'run-1', '1234', 'lease-2', '2026-08-12T22:00:00.000Z',
    )).rejects.toThrow('non-canonical observedAt');
  });

  it('retries completion after a duplicate terminal delivery', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        expectedVenues: { SS: ['1234'] }, processedVenues: { SS: ['1234'] },
      } })
      .mockResolvedValueOnce({});

    await markTerminalWith(send, 'runs', 'run-1', '1234', 'lease-1', 'written');

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(UpdateItemCommand);
    expect(send.mock.calls[2]?.[0].input.ConditionExpression).toContain('processedCount = expectedCount');
  });

  it('does not swallow a lost lease as a duplicate completion', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: { expectedVenues: { SS: ['1234'] } } });
    await expect(markTerminalWith(send, 'runs', 'run-1', '1234', 'old-lease', 'written'))
      .rejects.toThrow('was lost');
  });

  it('propagates a transient completion failure so SQS retries the record', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Attributes: { processedCount: { N: '1' }, expectedCount: { N: '1' } } })
      .mockRejectedValueOnce(new Error('DynamoDB unavailable'));
    await expect(markTerminalWith(send, 'runs', 'run-1', '1234', 'lease-1', 'written'))
      .rejects.toThrow('DynamoDB unavailable');
  });

  it('does not issue a completion write before the final venue', async () => {
    const send = vi.fn().mockResolvedValue({
      Attributes: { processedCount: { N: '3' }, expectedCount: { N: '4' } },
    });
    await markTerminalWith(send, 'runs', 'run-1', '1234', 'lease-1', 'written');
    expect(send).toHaveBeenCalledOnce();
  });

  it('treats an already-complete run as a successful no-op', async () => {
    const send = vi.fn().mockRejectedValue(conditionalFailure());
    await expect(completeRunIfReady(send, 'runs', 'run-1')).resolves.toBe(false);
  });
});
