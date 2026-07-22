export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(payload?.error?.code ?? "REQUEST_FAILED", payload?.error?.message ?? "Request failed.", response.status);
  }
  return await response.json() as T;
}

export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

