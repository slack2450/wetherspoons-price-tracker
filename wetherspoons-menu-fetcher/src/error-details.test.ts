import { describe, expect, it } from 'vitest';
import { errorDetails } from './error-details';

describe('failure diagnostics', () => {
  it('preserves the menu and HTTP cause through a partial-menu aggregate', () => {
    const upstream = Object.assign(new Error('Upstream returned Z556'), { name: 'UpstreamHttpError', status: 500 });
    const contextual = Object.assign(new Error('menu-detail failed'), {
      context: { stage: 'menu-detail', venueRef: 7578, salesAreaId: 1111, menuId: 10287, menuName: 'Specials' },
      cause: upstream,
    });
    expect(errorDetails(new AggregateError([contextual], 'partial menu'))).toMatchObject({
      name: 'AggregateError', errors: [{
        context: { menuId: 10287, menuName: 'Specials', venueRef: 7578 },
        cause: { name: 'UpstreamHttpError', status: 500, message: 'Upstream returned Z556' },
      }],
    });
  });

  it('retains schema paths but excludes arbitrary payload fields', () => {
    const error = Object.assign(new Error('Invalid menu'), {
      name: 'ZodError',
      issues: [{ path: ['data', 'categories'], code: 'invalid_type', message: 'Expected array', input: 'raw payload' }],
      requestHeaders: { Authorization: 'secret' },
    });
    const serialized = JSON.stringify(errorDetails(error));
    expect(serialized).toContain('categories');
    expect(serialized).not.toContain('raw payload');
    expect(serialized).not.toContain('secret');
  });

  it('bounds nested, circular and large error output', () => {
    const error: Error & { cause?: unknown } = new Error('x'.repeat(5000));
    error.cause = error;
    const serialized = JSON.stringify(errorDetails(error));
    expect(serialized).toContain('"truncated":true');
    expect(serialized.length).toBeLessThan(4500);
  });
});
