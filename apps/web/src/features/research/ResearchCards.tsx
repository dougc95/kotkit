import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { ResearchCard } from './ResearchCard.js'

/**
 * The Research screen (task 8.9.1), mounted at `/research` under `RailLayout`
 * (7.1.3). Self-contained: no props, no cross-task children.
 *
 * research-cards: "Three finite curated cards" — exactly three cards, no
 * pagination, no load-more, no refetch interval; "Content is labeled as
 * demonstration content" — the curation date plus "Automated discovery not
 * enabled" is always shown; "Never surfaced in session mode" — this route is
 * never linked from `SessionLayout` (7.1.4) and 7.4's route-leave guard
 * covers it while a session is active, so nothing here needs its own
 * session-mode check.
 *
 * `GET /research/cards` (D13) is a static fixture, not a feed: `staleTime:
 * Infinity` and `refetchInterval: false` mean it is fetched once per app
 * session and never polled, `refetchOnWindowFocus: false` keeps returning to
 * the tab from being read as a reason to refresh it, and `retry: false`
 * turns a failure into a single terse message rather than a retry loop.
 */
export function ResearchCards() {
  const query = useQuery({
    queryKey: queryKeys.research.cards,
    queryFn: api.research.cards,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false,
  })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Research</h1>
        {query.data ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Curated demonstration content · curated {query.data.curatedOn}
          </p>
        ) : null}
        {query.data ? <p className="text-sm text-[var(--color-text-muted)]">{query.data.discoveryNote}</p> : null}
        {query.data ? <p className="text-sm text-[var(--color-text-muted)]">{query.data.note}</p> : null}
      </header>

      {query.isError ? <p role="alert">Cards unavailable</p> : null}

      {query.data ? (
        <ul className="flex flex-col gap-6" aria-label="Curated research cards">
          {query.data.cards.map((card) => (
            <li key={card.id}>
              <ResearchCard card={card} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
