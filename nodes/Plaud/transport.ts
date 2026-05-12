import {
  type IExecuteFunctions,
  type IHookFunctions,
  type ILoadOptionsFunctions,
  type IPollFunctions,
  type IHttpRequestMethods,
  type IDataObject,
  type IRequestOptions,
  type JsonObject,
  NodeApiError,
} from 'n8n-workflow';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Shared transport for the Plaud nodes.
 *
 * - Computes the regional API base URL from the credential.
 * - Adds the headers web.plaud.ai sends on every request, including ones that
 *   require real crypto (sha256, sha1) and which therefore can't live in the
 *   credential's declarative `authenticate` hook.
 * - Unwraps the Plaud response envelope `{status, msg, data, ...}` and surfaces
 *   non-zero `status` as `NodeApiError` so n8n's error UX works.
 */

export type PlaudExecuteContext = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions | IHookFunctions;

export interface PlaudCredentials {
  accessToken: string;
  region: 'euc1' | 'use1' | 'apse1' | 'custom';
  customHost?: string;
}

export interface PlaudJwtClaims {
  sub: string;
  exp: number;
  iat: number;
  region?: string;
}

const REGION_HOSTS: Record<string, string> = {
  euc1: 'api-euc1.plaud.ai',
  use1: 'api-use1.plaud.ai',
  apse1: 'api-apse1.plaud.ai',
};

export function plaudBaseUrl(creds: PlaudCredentials): string {
  if (creds.region === 'custom') {
    if (!creds.customHost) throw new Error('Custom region selected but no Custom API Host configured');
    return `https://${creds.customHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  }
  const host = REGION_HOSTS[creds.region];
  if (!host) throw new Error(`Unknown region "${creds.region}"`);
  return `https://${host}`;
}

export function decodeJwt(token: string): PlaudJwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as PlaudJwtClaims;
  } catch {
    return null;
  }
}

export function pldUserFromJwt(token: string): string {
  const claims = decodeJwt(token);
  if (!claims?.sub) return '';
  return createHash('sha256').update(claims.sub).digest('hex');
}

export function deviceIdFromJwt(token: string): string {
  const parts = token.split('.');
  if (parts.length < 2) return 'n8nplaud00000000';
  return createHash('sha1').update(parts[1]!).digest('hex').slice(0, 16);
}

function newRequestId(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Internal: adds the common Plaud headers on top of whatever the caller passed.
 * The credential's `authenticate` hook also sets `Authorization` / `Origin` /
 * `Referer`, but we add them here too so callers that bypass the credential
 * (e.g. presigned-S3 follow-ups skipped via `skipAuth`) still get a valid set.
 */
function buildHeaders(creds: PlaudCredentials, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `bearer ${creds.accessToken}`,
    'x-device-id': deviceIdFromJwt(creds.accessToken),
    'x-request-id': newRequestId(),
    'x-pld-user': pldUserFromJwt(creds.accessToken),
    Origin: 'https://web.plaud.ai',
    Referer: 'https://web.plaud.ai/',
    Accept: 'application/json, text/plain, */*',
    ...extra,
  };
}

export interface PlaudRequestOptions {
  qs?: IDataObject;
  body?: IDataObject | string | Buffer;
  headers?: Record<string, string>;
  /** When true, returns the raw response body instead of unwrapping the envelope. */
  raw?: boolean;
  /** When set, overrides the base URL (used for follow-up calls to presigned S3 URLs). */
  fullUrl?: string;
  /** When true, returns a Buffer for binary downloads (audio, gzipped content). */
  asBuffer?: boolean;
}

/**
 * Make an authenticated request to the Plaud API and return the unwrapped
 * `data` field of the response envelope. Throws NodeApiError if the envelope
 * `status` is non-zero or the HTTP call itself fails.
 */
export async function plaudRequest<T = unknown>(
  ctx: PlaudExecuteContext,
  method: IHttpRequestMethods,
  path: string,
  opts: PlaudRequestOptions = {},
): Promise<T> {
  const creds = (await ctx.getCredentials('plaudApi')) as unknown as PlaudCredentials;
  const url = opts.fullUrl ?? `${plaudBaseUrl(creds)}${path.startsWith('/') ? path : `/${path}`}`;

  const requestOptions: IRequestOptions = {
    method,
    uri: url,
    qs: opts.qs,
    headers: buildHeaders(creds, opts.headers ?? {}),
    json: !opts.asBuffer && !opts.raw,
    encoding: opts.asBuffer ? null : undefined,
    body: opts.body,
  };

  let response: unknown;
  try {
    response = await ctx.helpers.request(requestOptions);
  } catch (error) {
    throw new NodeApiError(ctx.getNode(), error as JsonObject, {
      message: `Plaud request failed: ${method} ${path}`,
    });
  }

  if (opts.asBuffer || opts.raw) return response as T;

  // Plaud wraps successful responses as { status: 0, msg: "success", request_id, data?, ...payload }.
  // Some endpoints put the payload at the top level (alongside status), others under `data`.
  const env = response as { status?: number; msg?: string; data?: T };
  if (typeof env?.status === 'number' && env.status !== 0) {
    throw new NodeApiError(
      ctx.getNode(),
      response as JsonObject,
      { message: `Plaud API error: ${env.msg ?? 'unknown'} (status ${env.status})` },
    );
  }
  // If `data` exists, return it; otherwise the whole envelope (some endpoints lift fields up).
  return (env?.data !== undefined ? env.data : response) as T;
}

/**
 * Fetch a presigned S3 URL (used for transcript / summary / audio downloads).
 * Skips the Plaud envelope and Plaud auth headers — S3 expects clean requests.
 */
export async function fetchPresignedS3<T = Buffer>(
  ctx: PlaudExecuteContext,
  url: string,
  asBuffer = true,
): Promise<T> {
  const requestOptions: IRequestOptions = {
    method: 'GET',
    uri: url,
    encoding: asBuffer ? null : undefined,
    json: !asBuffer,
  };
  try {
    return (await ctx.helpers.request(requestOptions)) as T;
  } catch (error) {
    throw new NodeApiError(ctx.getNode(), error as JsonObject, {
      message: `S3 fetch failed: ${url.split('?')[0]}`,
    });
  }
}
