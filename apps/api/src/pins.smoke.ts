// D3 compatibility gate: importing a public type from each pinned package
// forces `typecheck` to exercise its type entry point and peer relations
// before any feature code depends on it. Delete once real imports of every
// package exist elsewhere.
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { Static } from '@sinclair/typebox'
import type { InferSelectModel } from 'drizzle-orm'
import type Postgres from 'postgres'
import type Pino from 'pino'

type _FastifyCheck = FastifyInstance
type _TypeboxProviderCheck = TypeBoxTypeProvider
type _TypeboxStaticCheck = Static<any>
type _DrizzleCheck = InferSelectModel<any>
type _PostgresCheck = Postgres.Sql
type _PinoCheck = Pino.Logger

export type PinsSmoke = true
