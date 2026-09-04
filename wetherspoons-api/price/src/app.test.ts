import { describe, expect, it, vi } from 'vitest';
import { handle } from './app';
import { buildPriceQuery, latestPerHour } from './history';
import { parsePriceRequest, RequestError } from './request';

const event = {
  pathParameters: { venueId: '123', productId: '456' },
  queryStringParameters: { range: '24h' },
  headers: { 'x-origin-verify': 'cloudfront-secret' },
};

describe('price request validation', () => {
  it('accepts allow-listed numeric inputs', () => {
    expect(parsePriceRequest(event.pathParameters, event.queryStringParameters)).toEqual({
      venueId: '123', productId: '456', range: '24h',
    });
  });

  it('accepts current 11-digit Wetherspoons product IDs', () => {
    expect(parsePriceRequest(
      { venueId: '7618', productId: '10000009517' },
      { range: '24h' },
    )).toEqual({ venueId: '7618', productId: '10000009517', range: '24h' });
  });

  it.each([
    [{ venueId: '1\") |> die()', productId: '2' }, { range: '24h' }],
    [{ venueId: '12345678901', productId: '2' }, { range: '24h' }],
    [{ venueId: '1', productId: '9007199254740992' }, { range: '24h' }],
    [{ venueId: '1', productId: '10000000000000000' }, { range: '24h' }],
    [{ venueId: '1', productId: '0' }, { range: '24h' }],
    [{ venueId: '1', productId: '2' }, { range: 'forever' }],
  ])('rejects unsafe input', (path, query) => {
    expect(() => parsePriceRequest(path, query)).toThrow(RequestError);
  });
});

describe('price history handler', () => {
  it('rejects direct API Gateway requests without the CloudFront origin secret', async () => {
    const reader = { read: vi.fn() };
    const response = await handle({ ...event, headers: {} } as never, reader, 'cloudfront-secret');
    expect(response).toMatchObject({ statusCode: 403 });
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('rejects an incorrect origin secret', async () => {
    const reader = { read: vi.fn() };
    const response = await handle(event as never, reader, 'different-secret');
    expect(response).toMatchObject({ statusCode: 403 });
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('returns fresh cache policy and reader data', async () => {
    const reader = { read: vi.fn(async () => [{ time: '2026-01-01T00:00:00Z', price: 3.5 }]) };
    const response = await handle(event as never, reader, 'cloudfront-secret');
    expect(response).toMatchObject({
      statusCode: 200,
      headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=60' },
    });
    expect(JSON.parse(response.body ?? '')).toHaveLength(1);
  });

  it('does not cache validation errors', async () => {
    const response = await handle(
      { ...event, queryStringParameters: { range: 'bad' } } as never,
      { read: vi.fn() },
      'cloudfront-secret',
    );
    expect(response).toMatchObject({ statusCode: 400, headers: { 'cache-control': 'no-store' } });
  });
});

it('builds a narrowly filtered Flux query without fragile server-side aggregation', () => {
  const query = buildPriceQuery('raw', '123', '456', '7d');
  expect(query).toContain('r["_measurement"] == "drink"');
  expect(query).toContain('r["venueId"] == "123"');
  expect(query).toContain('r["productId"] == "456"');
  expect(query).not.toContain('aggregateWindow');
  expect(query).not.toContain('group(columns: [])');
});

it('keeps the exact latest observation in each hour and sorts the result', () => {
  expect(latestPerHour([
    { time: '2026-09-04T11:05:00Z', price: 3.2 },
    { time: '2026-09-04T10:55:00Z', price: 3.0 },
    { time: '2026-09-04T11:59:00Z', price: 3.4 },
    { time: '2026-09-04T10:10:00Z', price: 2.9 },
    { time: 'invalid', price: 99 },
  ])).toEqual([
    { time: '2026-09-04T10:55:00Z', price: 3.0 },
    { time: '2026-09-04T11:59:00Z', price: 3.4 },
  ]);
});
