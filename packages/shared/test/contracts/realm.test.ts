import { Kind, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import * as contracts from '../../src/contracts/index.js'
import { ErrorResponse } from '../../src/contracts/common.js'
import { REQUEST_BODY_SCHEMAS } from '../../src/contracts/index.js'

function isSchema(value: unknown): value is TSchema {
  return typeof value === 'object' && value !== null && Kind in value
}

/**
 * Every schema node reachable from `schema`, walking `properties`, `items`
 * (array or tuple), `anyOf`/`oneOf`/`allOf` and a schema-valued
 * `additionalProperties`. Visits each node once even under shared references.
 */
function reachableSchemas(schema: TSchema, seen: Set<TSchema> = new Set()): TSchema[] {
  if (seen.has(schema)) return []
  seen.add(schema)

  const nodes: TSchema[] = [schema]
  const anyOf = (schema as { anyOf?: TSchema[] }).anyOf
  const oneOf = (schema as { oneOf?: TSchema[] }).oneOf
  const allOf = (schema as { allOf?: TSchema[] }).allOf
  const items = (schema as { items?: TSchema | TSchema[] }).items
  const properties = (schema as { properties?: Record<string, TSchema> }).properties
  const additionalProperties = (schema as { additionalProperties?: unknown }).additionalProperties

  for (const list of [anyOf, oneOf, allOf]) {
    if (list) for (const member of list) nodes.push(...reachableSchemas(member, seen))
  }
  if (Array.isArray(items)) {
    for (const member of items) nodes.push(...reachableSchemas(member, seen))
  } else if (items && isSchema(items)) {
    nodes.push(...reachableSchemas(items, seen))
  }
  if (properties) {
    for (const propertySchema of Object.values(properties)) {
      nodes.push(...reachableSchemas(propertySchema, seen))
    }
  }
  if (isSchema(additionalProperties)) {
    nodes.push(...reachableSchemas(additionalProperties, seen))
  }
  return nodes
}

/**
 * Every top-level export of `contracts/index.ts` named `*Response` — the
 * barrel's naming convention for a route's response schema (`MeResponse`,
 * `SessionResponse`, `ErrorResponse`, ...). Deliberately narrower than "every
 * exported schema": that broader set also contains schemas like
 * `IdempotencyKeyHeader`, which legitimately carries `additionalProperties:
 * true` because it is a header schema, not a request or response body.
 */
function everyResponseSchema(): TSchema[] {
  const schemas: TSchema[] = []
  for (const [name, value] of Object.entries(contracts)) {
    if (name.endsWith('Response') && isSchema(value)) schemas.push(value)
  }
  return schemas
}

describe('contracts/realm', () => {
  it('for every entry in REQUEST_BODY_SCHEMAS the example passes, and the example plus `realm: "pilot"` fails with an error whose path is /realm', () => {
    const entries = Object.entries(REQUEST_BODY_SCHEMAS)
    expect(entries.length).toBe(15)
    for (const [name, { schema, example }] of entries) {
      expect(Value.Check(schema, example), `${name} example should pass`).toBe(true)

      const withRealm = { ...(example as Record<string, unknown>), realm: 'pilot' }
      expect(Value.Check(schema, withRealm), `${name} + realm should fail`).toBe(false)
      const errors = [...Value.Errors(schema, withRealm)]
      expect(
        errors.some((error) => error.path === '/realm'),
        `${name} + realm should report an error at /realm`,
      ).toBe(true)
    }
  })

  it('the example plus `userId` fails likewise', () => {
    for (const [name, { schema, example }] of Object.entries(REQUEST_BODY_SCHEMAS)) {
      const withUserId = { ...(example as Record<string, unknown>), userId: 'local-demo' }
      expect(Value.Check(schema, withUserId), `${name} + userId should fail`).toBe(false)
      const errors = [...Value.Errors(schema, withUserId)]
      expect(
        errors.some((error) => error.path === '/userId'),
        `${name} + userId should report an error at /userId`,
      ).toBe(true)
    }
  })

  it('nested: EventInput inside EventsBatchBody with `realm` fails; FinalizeBody.review with `realm` fails', () => {
    const { schema: eventsBatchSchema, example: eventsBatchExample } =
      REQUEST_BODY_SCHEMAS['EventsBatch']!
    const batch = eventsBatchExample as { events: Record<string, unknown>[] }
    const eventWithRealm = {
      ...batch,
      events: [{ ...batch.events[0]!, realm: 'pilot' }],
    }
    expect(Value.Check(eventsBatchSchema, eventWithRealm)).toBe(false)

    const { schema: finalizeSchema, example: finalizeExample } = REQUEST_BODY_SCHEMAS['Finalize']!
    const finalize = finalizeExample as { review: Record<string, unknown> }
    const reviewWithRealm = { ...finalize, review: { ...finalize.review, realm: 'pilot' } }
    expect(Value.Check(finalizeSchema, reviewWithRealm)).toBe(false)
  })

  it('every object schema reachable from REQUEST_BODY_SCHEMAS and from every response schema has additionalProperties === false, with ErrorResponse.details as the single open object (D18)', () => {
    const detailsSchema = (ErrorResponse.properties as { details: TSchema }).details

    const roots: TSchema[] = [
      ...Object.values(REQUEST_BODY_SCHEMAS).map((entry) => entry.schema),
      ...everyResponseSchema(),
    ]

    const seen = new Set<TSchema>()
    const openObjects: TSchema[] = []
    for (const root of roots) {
      for (const node of reachableSchemas(root, seen)) {
        if (node[Kind] !== 'Object') continue
        if (node === detailsSchema) continue
        if ((node as { additionalProperties?: unknown }).additionalProperties !== false) {
          openObjects.push(node)
        }
      }
    }
    expect(openObjects).toEqual([])
  })

  it('no request body schema declares a `realm` or `userId` property at any depth', () => {
    const offenders: string[] = []
    for (const [name, { schema }] of Object.entries(REQUEST_BODY_SCHEMAS)) {
      for (const node of reachableSchemas(schema)) {
        const properties = (node as { properties?: Record<string, TSchema> }).properties
        if (!properties) continue
        if ('realm' in properties || 'userId' in properties) offenders.push(name)
      }
    }
    expect(offenders).toEqual([])
  })
})
