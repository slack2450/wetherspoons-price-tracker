import { SQSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { handle } from './app';
import { record, unavailableDependencies } from './test-fixtures';

describe('menu fetcher', () => {
  it('returns only failed SQS records for retry', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async currentVenue => {
      if (currentVenue.venueRef === 5678) throw new Error('upstream failed');
      return {
        status: 'unavailable' as const,
        reason: 'ordering-unavailable' as const,
        drinks: [] as [],
      };
    });
    const event = { Records: [record('success'), record('failure', 5678)] } as SQSEvent;

    await expect(handle(event, dependencies)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'failure' }],
    });
  });

  it('flushes every writable record in an SQS batch through one Influx writer', async () => {
    const dependencies = unavailableDependencies();
    const writePoint = vi.fn();
    const close = vi.fn(async () => undefined);
    dependencies.getDrinks = vi.fn(async currentVenue => ({
      status: 'available' as const,
      drinks: [{
        name: 'Beer',
        units: 2,
        productId: currentVenue.venueRef,
        price: 3,
        ppu: 1.5,
        currency: 'GBP',
      }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({ writePoint, close }));
    const event = {
      Records: [record('one', 1001), record('two', 1002), record('three', 1003)],
    } as SQSEvent;

    await expect(handle(event, dependencies)).resolves.toEqual({ batchItemFailures: [] });

    expect(dependencies.createWriteApi).toHaveBeenCalledTimes(1);
    expect(writePoint).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retries writable records together when their shared Influx flush fails', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async currentVenue => (
      currentVenue.venueRef === 9999
        ? {
          status: 'unavailable' as const,
          reason: 'ordering-unavailable' as const,
          drinks: [] as [],
        }
        : {
          status: 'available' as const,
          drinks: [{
            name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP',
          }],
        }
    ));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: vi.fn(),
      close: vi.fn(async () => { throw new Error('Influx timeout'); }),
    }));
    const event = {
      Records: [record('one', 1001), record('unavailable', 9999), record('two', 1002)],
    } as SQSEvent;

    await expect(handle(event, dependencies)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'one' }, { itemIdentifier: 'two' }],
    });
    expect(dependencies.createWriteApi).toHaveBeenCalledTimes(1);
  });

  it('keeps an upstream failure isolated when the shared Influx flush succeeds', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async currentVenue => {
      if (currentVenue.venueRef === 9999) throw new Error('upstream failed');
      return {
        status: 'available' as const,
        drinks: [{
          name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP',
        }],
      };
    });
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: vi.fn(),
      close: vi.fn(async () => undefined),
    }));
    const event = {
      Records: [record('written', 1001), record('failed', 9999)],
    } as SQSEvent;

    await expect(handle(event, dependencies)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'failed' }],
    });
  });

  it('only logs a record failure after SQS retries are exhausted', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => { throw new Error('upstream failed'); });
    const finalAttempt = record('failure');
    finalAttempt.attributes.ApproximateReceiveCount = '5';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handle({ Records: [finalAttempt] } as SQSEvent, dependencies);

    expect(error).toHaveBeenCalledWith(
      'MENU_RECORD_FAILED messageId=failure attempts=5',
      expect.any(Error),
    );
    error.mockRestore();
  });
});
