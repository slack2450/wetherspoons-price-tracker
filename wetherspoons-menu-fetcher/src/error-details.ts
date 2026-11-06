/** Bounded error metadata: keep causes and schema paths without logging payloads. */
export function errorDetails(error: unknown, depth = 0): Record<string, unknown> {
  if (depth >= 4) return { truncated: true };
  if (typeof error !== 'object' || error === null) return { message: String(error).slice(0, 1000) };
  const value = error as Record<string, unknown>;
  const details: Record<string, unknown> = {
    name: typeof value.name === 'string' ? value.name : 'Error',
    message: typeof value.message === 'string' ? value.message.slice(0, 1000) : 'Unknown failure',
  };
  if (typeof value.status === 'number') details.status = value.status;
  if (typeof value.context === 'object' && value.context !== null) {
    const context = value.context as Record<string, unknown>;
    details.context = Object.fromEntries(
      ['stage', 'venueRef', 'salesAreaId', 'menuId', 'menuName']
        .filter(key => typeof context[key] === 'number' || typeof context[key] === 'string')
        .map(key => [key, typeof context[key] === 'string' ? context[key].slice(0, 200) : context[key]]),
    );
  }
  if (Array.isArray(value.issues)) {
    details.issues = value.issues.slice(0, 8).map(issue => ({
      path: issue.path, code: issue.code, message: String(issue.message).slice(0, 300),
    }));
  }
  if (Array.isArray(value.errors)) details.errors = value.errors.slice(0, 8).map(item => errorDetails(item, depth + 1));
  if (value.cause !== undefined) details.cause = errorDetails(value.cause, depth + 1);
  return details;
}
