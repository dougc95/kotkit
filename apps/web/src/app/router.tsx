import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { Root } from './Root.js'
import { RouteError } from './RouteError.js'
import { NotFound } from './NotFound.js'
import { RailLayout } from './layouts/RailLayout.js'
import { SessionLayout } from './layouts/SessionLayout.js'
import { PlanForm } from '../features/setup/PlanForm.js'
import { ReadinessForm } from '../features/setup/ReadinessForm.js'
import { Today } from '../features/today/Today.js'
import { CheckinForm } from '../features/checkin/CheckinForm.js'
import { Progress } from '../features/progress/Progress.js'
import { ResearchCards } from '../features/research/ResearchCards.js'
import { Settings } from '../features/settings/Settings.js'
import { BenchmarkRoute } from '../features/benchmark/BenchmarkRoute.js'
import { Recall } from '../features/benchmark/Recall.js'
import { BenchmarkReviewPage } from '../features/benchmark/BenchmarkReviewPage.js'
import { Focus } from '../features/focus/Focus.js'
import { PracticeReview } from '../features/review/PracticeReview.js'

/**
 * design.md's route map, read literally (7.1.1's binding brief):
 *
 *  /setup                 -> /setup/readiness -> /today
 *  /benchmark/:slotId     ready -> running -> /benchmark/:sessionId/recall -> /scoring -> /today (or next slot)
 *  /today                 -> /focus/:sessionId -> /review/:sessionId -> /today
 *  /today (check-in card) -> /checkin/:date -> /today
 *  /progress  /research  /settings
 *  Session layout (no nav): /benchmark/*, /focus/*, /review/*
 *
 * Benchmark Running has no route of its own — it is the same
 * /benchmark/:slotId screen after Start is pressed (the lifecycle machine
 * transitions client-side; the URL does not change). The scoring step is
 * nested under the session id, matching design.md's relative '-> /scoring'
 * arrow read literally as a child of /benchmark/:sessionId/recall's
 * sibling — i.e. /benchmark/:sessionId/scoring.
 *
 * Group 8 replaced every ScreenPlaceholder below with its real screen.
 */
const railRoutes: RouteObject[] = [
  { path: 'setup', element: <PlanForm /> },
  { path: 'setup/readiness', element: <ReadinessForm /> },
  { path: 'today', element: <Today /> },
  { path: 'checkin/:date', element: <CheckinForm /> },
  { path: 'progress', element: <Progress /> },
  { path: 'research', element: <ResearchCards /> },
  { path: 'settings', element: <Settings /> },
  { path: '*', element: <NotFound /> },
]

const sessionRoutes: RouteObject[] = [
  { path: 'benchmark/:slotId', element: <BenchmarkRoute /> },
  { path: 'benchmark/:sessionId/recall', element: <Recall /> },
  { path: 'benchmark/:sessionId/scoring', element: <BenchmarkReviewPage /> },
  { path: 'focus/:sessionId', element: <Focus /> },
  { path: 'review/:sessionId', element: <PracticeReview /> },
]

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { id: 'rail', element: <RailLayout />, children: railRoutes },
      { id: 'session', element: <SessionLayout />, children: sessionRoutes },
    ],
  },
]

export const router = createBrowserRouter(routes)
