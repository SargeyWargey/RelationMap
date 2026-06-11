import { NextResponse } from "next/server";

/** Max accepted JSON body size for POST routes (Enhancement Plan D3). */
export const MAX_BODY_BYTES = 1_000_000; // 1MB

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively scan parsed JSON for prototype-pollution key names.
 * JSON.parse creates these as own properties, so Object.keys sees them.
 */
export function hasDangerousKeys(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousKeys(item, depth + 1));
  }
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/** Standard error response shape (Enhancement Plan D6): `{ ok: false, error }`. */
export function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Read + parse a JSON request body with a size cap and prototype-pollution
 * key rejection. Returns either `{ body }` or `{ error }` (a ready response).
 */
export async function readJsonBody(
  request: Request,
): Promise<{ body: unknown; error?: undefined } | { body?: undefined; error: NextResponse }> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { error: errorResponse("Request body too large.", 413) };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { error: errorResponse("Unable to read request body.", 400) };
  }
  if (raw.length > MAX_BODY_BYTES) {
    return { error: errorResponse("Request body too large.", 413) };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: errorResponse("Invalid JSON body.", 400) };
  }

  if (hasDangerousKeys(body)) {
    return { error: errorResponse("Request contains disallowed keys.", 400) };
  }

  return { body };
}
