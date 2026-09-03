import { describe, expect, it, vi } from 'vitest';
import { handle, type PublicApi } from './app';

const venue = { franchise: 'jdw', id: 1, isClosed: false, name: 'Test', venueRef: 123, address: {} };
const secret = 'cloudfront-origin-secret';

function event(rawPath: string, venueId?: string) {
  return {
    rawPath,
    pathParameters: venueId === undefined ? undefined : { venueId },
    headers: { 'x-origin-verify': secret },
  } as never;
}

function api(): PublicApi {
  return {
    venues: vi.fn(async () => [venue]),
    drinks: vi.fn(async () => ({ status: 'available' as const, drinks: [] })),
  };
}

describe('public menu API', () => {
  it('rejects requests that bypass CloudFront origin verification', async () => {
    const dependency = api();
    const result = await handle({ rawPath: '/v2/venues', headers: {} } as never, dependency, secret);
    expect(result).toMatchObject({ statusCode: 403, headers: { 'cache-control': 'no-store' } });
    expect(dependency.venues).not.toHaveBeenCalled();
  });

  it('serves a cacheable venue list', async () => {
    const result = await handle(event('/v2/venues'), api(), secret);
    expect(result).toMatchObject({ statusCode: 200, headers: { 'cache-control': expect.stringContaining('max-age=3600') } });
  });

  it('validates a venue against the cached known list before fetching drinks', async () => {
    const dependency = api();
    const result = await handle(event('/v2/drinks/123', '123'), dependency, secret);
    expect(result.statusCode).toBe(200);
    expect(dependency.drinks).toHaveBeenCalledWith(venue);
    expect(dependency.venues).toHaveBeenCalledOnce();
  });

  it('rejects unknown numeric venue references without calling the menu upstream', async () => {
    const dependency = api();
    const result = await handle(event('/v2/drinks/999', '999'), dependency, secret);
    expect(result).toMatchObject({ statusCode: 404 });
    expect(dependency.drinks).not.toHaveBeenCalled();
  });

  it('reuses the venue cache across drinks requests', async () => {
    const dependency = api();
    await handle(event('/v2/drinks/123', '123'), dependency, secret);
    await handle(event('/v2/drinks/123', '123'), dependency, secret);
    expect(dependency.venues).toHaveBeenCalledOnce();
    expect(dependency.drinks).toHaveBeenCalledTimes(2);
  });

  it('adds EUR during a rolling upgrade from a package without currency', async () => {
    const dependency = api();
    dependency.venues = vi.fn(async () => [{
      ...venue,
      address: { country: { name: 'Ireland', code: 'IE' } },
    }]);
    dependency.drinks = vi.fn(async () => ({
      status: 'available' as const,
      drinks: [{ name: 'Lager', units: 2, productId: 4, price: 4, ppu: 2 }] as never,
    }));
    const result = await handle(event('/v2/drinks/123', '123'), dependency, secret);
    expect(JSON.parse(result.body).drinks[0].currency).toBe('EUR');
    expect(dependency.venues).toHaveBeenCalledOnce();
  });

  it('rejects malformed venue references without calling upstream', async () => {
    const dependency = api();
    const result = await handle(event('/v2/drinks/bad', 'bad'), dependency, secret);
    expect(result).toMatchObject({ statusCode: 400, headers: { 'cache-control': 'no-store' } });
    expect(dependency.drinks).not.toHaveBeenCalled();
    expect(dependency.venues).not.toHaveBeenCalled();
  });

  it('contains upstream errors and prevents caching them', async () => {
    const dependency = api();
    dependency.venues = vi.fn(async () => { throw new Error('secret upstream detail'); });
    const result = await handle(event('/v2/venues'), dependency, secret);
    expect(result).toMatchObject({ statusCode: 502, headers: { 'cache-control': 'no-store' } });
    expect(result.body).not.toContain('secret upstream detail');
  });
});
