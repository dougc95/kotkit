import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import {
  DISCOVERY_NOTE,
  RESEARCH_CARDS,
  RESEARCH_CURATED_ON,
  RESEARCH_NOTE,
  type ResearchCardsResponseValue,
  type ResearchCardValue,
} from '@attention-lab/shared'

import { queryKeys } from '../../lib/query/keys.js'
import { respond } from '../../test/mockClient.js'
import { renderWithProviders } from '../../test/renderWithProviders.js'
import { ResearchCards } from './ResearchCards.js'

/**
 * task 8.9.1's verify list, all 7 named cases. `ResearchCards` is
 * self-contained (no `useMeContext()`), so — unlike DemoBanner/RailLayout —
 * every case mounts it directly, stubbing only `research.cards`
 * (mockClient.ts, 7.1.1).
 */
const MOCK_RESPONSE: ResearchCardsResponseValue = {
  cards: RESEARCH_CARDS,
  curatedOn: RESEARCH_CURATED_ON,
  note: RESEARCH_NOTE,
  discoveryNote: DISCOVERY_NOTE,
}

const JS_URL_CARD: ResearchCardValue = { ...RESEARCH_CARDS[0]!, sourceUrl: 'javascript:alert(1)' }
const MOCK_RESPONSE_WITH_JS_URL: ResearchCardsResponseValue = {
  ...MOCK_RESPONSE,
  cards: [JS_URL_CARD, RESEARCH_CARDS[1]!, RESEARCH_CARDS[2]!],
}

// See DemoBanner.test.tsx's header comment: this harness does not run with
// `test.globals: true`, so Testing Library's auto-cleanup never activates.
afterEach(() => {
  cleanup()
})

function mount(response: ResearchCardsResponseValue = MOCK_RESPONSE) {
  respond('research.cards', response)
  return renderWithProviders(<ResearchCards />)
}

describe('ResearchCards', () => {
  it('renders exactly three cards with every required field', async () => {
    mount()

    const articles = await screen.findAllByRole('article')
    expect(articles).toHaveLength(3)

    articles.forEach((article, index) => {
      const card = RESEARCH_CARDS[index]!
      const within_ = within(article)
      expect(within_.getByRole('heading', { level: 2, name: card.title })).toBeInTheDocument()
      expect(article.textContent).toContain(card.authors)
      expect(article.textContent).toContain(String(card.year))
      expect(article.textContent).toContain(card.studyDesign)
      expect(article.textContent).toContain('Peer-reviewed')
      expect(article.textContent).toContain('Abstract reviewed')
      expect(article.textContent).toContain(card.finding)
      expect(article.textContent).toContain(card.limitation)
      expect(article.textContent).toContain(card.relevance)
      expect(within_.getByRole('link', { name: 'Read source' })).toHaveAttribute('href', card.sourceUrl)
    })
  })

  it('shows the curation date and Automated discovery not enabled', async () => {
    mount()

    await screen.findAllByRole('article')
    expect(screen.getByText(`Curated demonstration content · curated ${RESEARCH_CURATED_ON}`)).toBeInTheDocument()
    expect(screen.getByText('Automated discovery not enabled')).toBeInTheDocument()
  })

  it('shows the Up to three reviewed updates note', async () => {
    mount()

    await screen.findAllByRole('article')
    expect(
      screen.getByText('Up to three reviewed updates. Plan changes are your choice.'),
    ).toBeInTheDocument()
  })

  it('Read source has target _blank and rel noopener noreferrer', async () => {
    mount()

    const links = await screen.findAllByRole('link', { name: 'Read source' })
    expect(links).toHaveLength(3)
    links.forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  it('a javascript: URL is not rendered as a link', async () => {
    mount(MOCK_RESPONSE_WITH_JS_URL)

    const articles = await screen.findAllByRole('article')
    expect(articles).toHaveLength(3)

    const jsUrlArticle = articles[0]!
    expect(within(jsUrlArticle).queryByRole('link', { name: 'Read source' })).not.toBeInTheDocument()
    expect(within(jsUrlArticle).getByText('Source link unavailable')).toBeInTheDocument()
    expect(screen.queryByText('javascript:alert(1)')).not.toBeInTheDocument()

    // The other two cards keep their real link.
    expect(screen.getAllByRole('link', { name: 'Read source' })).toHaveLength(2)
  })

  it('query options have refetchInterval false, staleTime Infinity and retry false', async () => {
    const { queryClient } = mount()

    await screen.findAllByRole('article')

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.research.cards })
    expect(query).toBeDefined()
    // `Query.options` is typed as the base `QueryOptions`, but at runtime it
    // is the full merged `QueryObserverOptions` ResearchCards.tsx passed to
    // `useQuery` (query-core's `QueryObserver.setOptions` writes the whole
    // observer options object onto the underlying `Query`) — the observer-
    // only fields below are read through this widened view.
    const options = query?.options as
      | { staleTime?: number; refetchInterval?: number | false; refetchOnWindowFocus?: boolean | 'always' }
      | undefined
    expect(options?.staleTime).toBe(Infinity)
    expect(options?.refetchInterval).toBe(false)
    expect(options?.refetchOnWindowFocus).toBe(false)
    expect(query?.options.retry).toBe(false)
  })

  it('no pagination control is rendered', async () => {
    mount()

    await screen.findAllByRole('article')
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load more|next|previous|more/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/load more/i)).not.toBeInTheDocument()
  })
})
