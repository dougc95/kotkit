import type { ResearchCardValue } from '@attention-lab/shared'

/**
 * One curated evidence card (research-cards: every card SHALL show title,
 * authors and year, study design, provenance, one finding, one limitation,
 * one relevance note, and the original source link). Finding and
 * Limitation share the same `dt`/`dd` treatment deliberately — a study's
 * limitation carries the same visual weight as its finding, never demoted
 * to fine print.
 */
export interface ResearchCardProps {
  readonly card: ResearchCardValue
}

const PEER_REVIEW_LABEL: Record<ResearchCardValue['provenance']['peerReview'], string> = {
  peer_reviewed: 'Peer-reviewed',
  preprint: 'Preprint',
  unknown: 'Peer-review status unknown',
}

const REVIEWED_LABEL: Record<ResearchCardValue['provenance']['reviewed'], string> = {
  full_text: 'Full text reviewed',
  abstract: 'Abstract reviewed',
}

/**
 * research-cards: "External sources open deliberately" — SHALL accept only
 * HTTP(S) URLs. `new URL()` throws on a malformed string (not only on a
 * non-http(s) scheme like `javascript:`), so both cases fall through to
 * `false` here rather than throwing out of the render.
 */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function ResearchCard({ card }: ResearchCardProps) {
  const sourceIsHttp = isHttpUrl(card.sourceUrl)

  return (
    <article className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{card.title}</h2>
        <p className="text-sm text-ink-muted">
          {card.authors}, {card.year}
        </p>
      </div>

      <p className="text-sm text-ink-muted">{card.studyDesign}</p>

      <p className="text-sm text-ink-muted">
        {PEER_REVIEW_LABEL[card.provenance.peerReview]}, {REVIEWED_LABEL[card.provenance.reviewed]}
      </p>

      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="font-medium text-ink">Finding</dt>
          <dd className="text-ink-muted">{card.finding}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Limitation</dt>
          <dd className="text-ink-muted">{card.limitation}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Relevance here</dt>
          <dd className="text-ink-muted">{card.relevance}</dd>
        </div>
      </dl>

      {sourceIsHttp ? (
        <a
          href={card.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-sm font-medium text-signal underline underline-offset-2"
        >
          Read source
        </a>
      ) : (
        <span className="text-sm text-ink-muted">Source link unavailable</span>
      )}
    </article>
  )
}
