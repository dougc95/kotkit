/**
 * `/sessions` route group registrar (task 5.1.1). Every sessions route
 * (start, read, active, events, void, transitions, clock-gap, agent-plan,
 * recall, finalize, amendments — groups 5a and 5b) is its own file under this
 * directory; this barrel registers them all under one Fastify plugin so
 * `app.ts` adds exactly one `api.register(sessionsRoutes)` line for the
 * whole group, the same shape as `routes/programs.ts`.
 */
import type { FastifyPluginAsync } from 'fastify'
import startRoute from './start.js'
import activeRoute from './active.js'
import readRoute from './read.js'
import eventsRoute from './events.js'
import voidRoute from './void.js'
import transitionsRoute from './transitions.js'
import clockGapRoute from './clockGap.js'
import agentPlanRoute from './agentPlan.js'
import recallRoute from './recall.js'
import finalizeRoute from './finalize.js'
import amendmentsRoute from './amendments.js'

const sessionsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(startRoute)
  // `active` must register before the `/:id` route so the literal path
  // segment `active` is never parsed as a `SessionIdParams.id` (5.2.3).
  await app.register(activeRoute)
  await app.register(readRoute)
  await app.register(eventsRoute)
  await app.register(voidRoute)
  await app.register(transitionsRoute)
  await app.register(clockGapRoute)
  await app.register(agentPlanRoute)
  await app.register(recallRoute)
  await app.register(finalizeRoute)
  await app.register(amendmentsRoute)
}

export default sessionsRoutes
