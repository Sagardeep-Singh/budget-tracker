/**
 * Thin `fetch` wrapper for the client components that talk to `app/api/**`.
 *
 * Deliberately *not* throw-based: several call sites branch on the status code
 * (409 duplicate filename, 413 too large, 428 Google re-auth, 429 daily AI
 * limit) or read fields off the error body, so the result keeps `status` and
 * the parsed `body` around instead of collapsing everything into an `Error`.
 *
 * `error` is `null` when the response had no string `error` field — each call
 * site owns its own user-facing fallback copy, so there is no default message
 * here.
 *
 * A body-less success (the `204`s returned by the DELETE routes) parses to
 * `null`; those call sites only check `ok`.
 */

export type ApiSuccess<T> = { ok: true; status: number; data: T };

export type ApiFailure = {
  ok: false;
  /** `0` when the request never reached the server (see `networkError`). */
  status: number;
  /** The response body's `error` string, when it had one. */
  error: string | null;
  /** Parsed response body, or `null` if it was absent/unparseable. */
  body: unknown;
  /** `fetch` itself rejected — offline, DNS, aborted connection. */
  networkError: boolean;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const errorOf = (body: unknown): string | null => {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body as { error: unknown };
    if (typeof error === 'string') return error;
  }
  return null;
};

const request = async <T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // A pre-serialized string is passed through untouched — the data-import
      // card streams the file's text straight to the route.
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
    });
  } catch {
    return { ok: false, status: 0, error: null, body: null, networkError: true };
  }

  const parsed = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: errorOf(parsed),
      body: parsed,
      networkError: false,
    };
  }

  return { ok: true, status: response.status, data: parsed as T };
};

export const getJSON = async <T>(url: string): Promise<ApiResult<T>> => request<T>(url, 'GET');

export const postJSON = async <T>(url: string, body?: unknown): Promise<ApiResult<T>> =>
  request<T>(url, 'POST', body);

export const putJSON = async <T>(url: string, body?: unknown): Promise<ApiResult<T>> =>
  request<T>(url, 'PUT', body);

export const patchJSON = async <T>(url: string, body?: unknown): Promise<ApiResult<T>> =>
  request<T>(url, 'PATCH', body);

export const deleteJSON = async <T>(url: string, body?: unknown): Promise<ApiResult<T>> =>
  request<T>(url, 'DELETE', body);
