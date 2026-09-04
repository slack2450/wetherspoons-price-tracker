import { Point } from '@influxdata/influxdb-client';
import { describe, expect, it, vi } from 'vitest';
import { processRecord } from './app';
import { record, unavailableDependencies, venue } from './test-fixtures';

describe('menu record processing', () => {
  it('records a legitimate unavailable menu without opening an Influx writer', async () => {
    const dependencies = unavailableDependencies();
    await processRecord(record('one'), dependencies);

    expect(dependencies.createWriteApi).not.toHaveBeenCalled();
  });

  it('retries a venue when the Influx flush fails', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: vi.fn(),
      close: vi.fn(async () => { throw new Error('Influx timeout'); }),
    }));

    await expect(processRecord(record('one'), dependencies)).rejects.toThrow('Influx timeout');
  });

  it('does not persist a partial upstream menu', async () => {
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      partial: true,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));

    await expect(processRecord(record('one'), dependencies)).rejects.toThrow('partial menu');
    expect(dependencies.createWriteApi).not.toHaveBeenCalled();
  });

  it('uses the run timestamp so retries write the identical Influx point', async () => {
    const lines: string[] = [];
    const dependencies = unavailableDependencies();
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: (point: Point) => { lines.push(point.toLineProtocol()!); },
      close: vi.fn(async () => undefined),
    }));

    await processRecord(record('first'), dependencies);
    await processRecord(record('retry'), dependencies);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(lines[1]);
    expect(dependencies.getDrinks).toHaveBeenCalledTimes(2);
  });

  it('keeps stable series identity when retry metadata changes', async () => {
    const dependencies = unavailableDependencies();
    const lines: string[] = [];
    dependencies.getDrinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Beer', units: 2, productId: 99, price: 3, ppu: 1.5, currency: 'GBP' }],
    }));
    dependencies.createWriteApi = vi.fn(() => ({
      writePoint: (point: Point) => { lines.push(point.toLineProtocol()!); },
      close: vi.fn(async () => undefined),
    }));
    await processRecord(record('first'), dependencies);

    const renamed = record('retry');
    const envelope = JSON.parse(renamed.body) as { Message: string };
    const message = JSON.parse(envelope.Message) as {
      runId: string
      observedAt: string
      venue: typeof venue
    };
    message.venue.name = 'Renamed Pub';
    envelope.Message = JSON.stringify(message);
    renamed.body = JSON.stringify(envelope);

    await expect(processRecord(renamed, dependencies)).resolves.toBeUndefined();
    expect(dependencies.getDrinks).toHaveBeenCalledTimes(2);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.split(' ')[0]).toBe(lines[1]?.split(' ')[0]);
    expect(lines[1]).toContain('venueName="Renamed Pub"');
    expect(lines[1]).toContain('currency="GBP"');
  });
});
