import { useQuery } from '@tanstack/react-query'

import { api } from '../../lib/api/client.js'
import { queryKeys } from '../../lib/query/keys.js'
import { ResearchCard } from './ResearchCard.js'

/**
 * The Research screen, mounted at `/research` under `RailLayout`.
 * research-cards: "Three finite curated cards" — exactly three cards, no
 * pagination, no load-more, no refetch interval; "Content is labeled as
 * demonstration content" — the curation date plus "Automated discovery not
 * enabled" is always shown.
 *
 * `GET /research/cards` is a static fixture, not a feed: `staleTime:
 * Infinity` and `refetchInterval: false` mean it is fetched once per app
 * session and never polled, `refetchOnWindowFocus: false` keeps returning to
 * the tab from being read as a reason to refresh it, and `retry: false`
 * turns a failure into a single terse message rather than a retry loop.
 *
 * Each card is a hairline-separated log entry, not a boxed card — the
 * hairline lives on the `<li>` (true list siblings), not inside
 * `ResearchCard` itself.
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
        <h1 className="text-lg font-semibold text-ink">Research</h1>
        {query.data ? (
          <p className="text-sm text-ink-muted">Curated demonstration content, curated {query.data.curatedOn}</p>
        ) : null}
        {query.data ? <p className="text-sm text-ink-muted">{query.data.discoveryNote}</p> : null}
        {query.data ? <p className="text-sm text-ink-muted">{query.data.note}</p> : null}
      </header>

      {query.isError ? (
        <p role="alert" className="text-sm">
          Cards unavailable
        </p>
      ) : null}

      {query.data ? (
        <ul className="flex flex-col" aria-label="Curated research cards">
          {query.data.cards.map((card) => (
            <li key={card.id} className="border-b border-rule py-6 first:pt-0 last:border-b-0 last:pb-0">
              <ResearchCard card={card} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
