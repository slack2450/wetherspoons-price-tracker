const UNAVAILABLE_REASONS = new Set([
  'venue-closed',
  'ordering-unavailable',
  'no-sales-area',
  'no-orderable-menus',
  'no-usable-drinks',
]);

export function londonHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/London',
  }).format(date);
  return Number(hour);
}

export function collectorsAreOperational(date = new Date()) {
  const hour = londonHour(date);
  return hour >= 8 && hour <= 23;
}

export function validateDrinksResult(result) {
  if (!result || !Array.isArray(result.drinks)) {
    throw new Error('Deployed drinks route returned an invalid result');
  }
  if (result.partial === true) {
    throw new Error('Deployed drinks route returned a partial menu');
  }

  if (result.status === 'available') {
    if (result.drinks.length === 0) throw new Error('Available drinks result was empty');
    return;
  }

  if (result.status !== 'unavailable' || !UNAVAILABLE_REASONS.has(result.reason)) {
    throw new Error('Deployed drinks route returned an invalid availability status');
  }
  if (result.drinks.length !== 0) {
    throw new Error('Unavailable drinks result contained drinks');
  }
}
