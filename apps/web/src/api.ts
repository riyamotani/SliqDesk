import type { ApiError } from '@sliqdesk/shared';

/** An error response from the API, with its machine-readable code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Calls the API on the same origin. The session cookie is httpOnly, so this
 * code never sees it: the browser attaches it automatically.
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new HttpError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? res.statusText,
      err?.details,
    );
  }
  return data as T;
}

/** A human-readable message for any error thrown by `api`. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) {
    const details = Array.isArray(err.details)
      ? (err.details as { path: string; message: string }[])
          .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
          .join(', ')
      : '';
    return details ? `${err.message} (${details})` : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
