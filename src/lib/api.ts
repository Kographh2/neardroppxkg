export class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : null;
    throw new HttpError(response.status, message || (response.status === 404
      ? 'The NearDrop API is missing from this deployment. Deploy the server routes and configure the database.'
      : response.status === 503 ? 'The NearDrop server is not ready. Check its database configuration.' : 'Could not reach the NearDrop server. Try again.'),
      result && typeof result === 'object' && 'code' in result && typeof result.code === 'string' ? result.code : undefined);
  }
  if (!result || typeof result !== 'object') throw new HttpError(502, 'The NearDrop server returned an invalid response.');
  return result as T;
}
