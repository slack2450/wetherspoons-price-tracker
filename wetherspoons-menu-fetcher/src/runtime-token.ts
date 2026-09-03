const nativeFetch = globalThis.fetch;

globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : input.toString();
  if (new URL(url).hostname !== 'ca.jdw-apps.net') return nativeFetch(input, init);

  const token = process.env.WETHERSPOONS_API_TOKEN;
  if (!token) return Promise.reject(new Error('WETHERSPOONS_API_TOKEN is required'));
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', `Bearer ${token}`);
  return nativeFetch(input, { ...init, headers });
};
