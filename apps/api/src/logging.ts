/**
 * The one privacy-safe pino logger every code path in this API is built on
 * (design.md D40 / identity-realm "Private data is never written to logs or
 * stored insecurely"). Every request/response log line goes through the
 * `req`/`res` serializers below, which emit only a handful of named fields —
 * never headers, query, params or body, which is where free-text notes
 * (intended outputs, recall points, review notes, disruption notes) live.
 */

import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino'

/**
 * Belt-and-braces guard on top of the serializers below: the `req`
 * serializer never includes `headers` in its output at all, so nothing
 * should ever reach this path in practice, but any future call site that
 * logs a raw request object under a different key still gets an
 * Authorization header or session cookie stripped before it is written.
 */
export const LOG_REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie'] as const

interface ReqLike {
  id?: string
  method?: string
  url?: string
  routeOptions?: { url?: string | undefined } | undefined
}

interface ReqSerialized {
  id: string | undefined
  method: string | undefined
  url: string | undefined
  route: string | null
}

interface ResLike {
  statusCode?: number
}

interface ResSerialized {
  statusCode: number | undefined
}

/**
 * `id`, `method`, `url` and `route` only. `route` reads
 * `routeOptions?.url` — Fastify 5 has no `routerPath` — which is `undefined`
 * for an unmatched (404) request, so `route` is `null` there rather than a
 * stray `undefined` key. Never headers, query, params or body.
 */
export function reqSerializer(req: ReqLike): ReqSerialized {
  return {
    id: req.id,
    method: req.method,
    url: req.url,
    route: req.routeOptions?.url ?? null,
  }
}

/** `statusCode` only — never headers or body. */
export function resSerializer(res: ResLike): ResSerialized {
  return { statusCode: res.statusCode }
}

export interface CreateLoggerOptions {
  level: string
  /** Tests point this at an in-memory `captureLogs()` destination. */
  destination?: DestinationStream
}

/**
 * No `err` serializer is configured here: 3.2.4's error plugin logs errors
 * through its own `sanitizeErrorForLog`, never through pino's `err` key, so
 * an `err` serializer would be dead configuration that invites someone to
 * start logging raw errors (and their embedded row/detail text) later.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    serializers: {
      req: reqSerializer,
      res: resSerializer,
    },
    redact: [...LOG_REDACT_PATHS],
  }

  return options.destination ? pino(loggerOptions, options.destination) : pino(loggerOptions)
}
