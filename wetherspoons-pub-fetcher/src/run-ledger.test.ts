import { GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { beginRunWith, markPublishFailedWith } from './run-ledger';

function conditionalFailure(): Error {
  return Object.assign(new Error('condition failed'), { name: 'ConditionalCheckFailedException' });
}

const observedAt = '2026-01-01T00:00:00Z';

describe('beginRunWith', () => {
  it('creates a new run with an initialized lease map', async () => {
    const send = vi.fn().mockResolvedValue({});
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1']))
      .resolves.toBe(true);
    const command = send.mock.calls[0]?.[0] as PutItemCommand;
    expect(command).toBeInstanceOf(PutItemCommand);
    expect(command.input.Item?.venueLeases).toEqual({ M: {} });
  });

  it('resumes an incomplete run only after validating its immutable inputs', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['2', '1'] }, status: { S: 'PROCESSING' },
      } })
      .mockResolvedValueOnce({});
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1', '2']))
      .resolves.toBe(true);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetItemCommand);
    const resume = send.mock.calls[2]?.[0] as UpdateItemCommand;
    expect(resume.input.UpdateExpression).toContain('if_not_exists(venueLeases, :emptyMap)');
  });

  it('refuses to substitute a changed venue list on retry', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['1', '2'] }, status: { S: 'PROCESSING' },
      } });
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1', '3']))
      .rejects.toThrow('Venue set changed');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate venue IDs before writing a run', async () => {
    const send = vi.fn();
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1', '1']))
      .rejects.toThrow('duplicate venue IDs');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not accept duplicate substitution in a retry set', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['1', '2'] }, status: { S: 'PROCESSING' },
      } });
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1', '1']))
      .rejects.toThrow('duplicate venue IDs');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a retry with a different observation timestamp', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['1'] }, status: { S: 'PROCESSING' },
      } });
    await expect(beginRunWith(send, 'runs', 'run-1', '2026-01-01T01:00:00Z', ['1']))
      .rejects.toThrow('different observedAt');
  });

  it('does not reopen or republish a completed run', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['1'] }, status: { S: 'COMPLETE' },
      } });
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1']))
      .resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('handles completion racing the resume update', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: {
        observedAt: { S: observedAt }, expectedVenues: { SS: ['1'] }, status: { S: 'PROCESSING' },
      } })
      .mockRejectedValueOnce(conditionalFailure());
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1']))
      .resolves.toBe(false);
  });

  it('propagates infrastructure failures', async () => {
    const send = vi.fn().mockRejectedValue(new Error('DynamoDB unavailable'));
    await expect(beginRunWith(send, 'runs', 'run-1', observedAt, ['1']))
      .rejects.toThrow('DynamoDB unavailable');
  });

  it('does not overwrite COMPLETE with PUBLISH_FAILED', async () => {
    const send = vi.fn().mockRejectedValue(conditionalFailure());
    await expect(markPublishFailedWith(send, 'runs', 'run-1', 'SNS failed'))
      .resolves.toBe(false);
    const command = send.mock.calls[0]?.[0] as UpdateItemCommand;
    expect(command.input.ConditionExpression).toContain('#status <> :complete');
  });
});
