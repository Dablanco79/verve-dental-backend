import type {
  ReviewCandidateReason,
  ReviewProductCandidate,
} from "../../types/masterProduct.js";

const REASON_LABELS: Record<ReviewCandidateReason, string> = {
  confirmed_supplier_mapping: "Confirmed supplier mapping",
  family_relevance: "Same product family",
  size_match: "Size matches",
  pack_count_match: "Pack matches",
  colour_match: "Colour matches",
};

type ProductReviewCandidateCardProps = {
  candidate: ReviewProductCandidate;
  onAccept: () => void;
};

/**
 * Read-only human-review candidate presentation. It intentionally does not
 * display relevance as automatic match confidence.
 */
export function ProductReviewCandidateCard({
  candidate,
  onAccept,
}: ProductReviewCandidateCardProps) {
  return (
    <div className="match-suggestion" data-testid="review-candidate-card">
      <div className="match-suggestion__header">
        <span className="match-suggestion__label">Review candidate</span>
        <span className="match-suggestion__confidence">Human review</span>
      </div>

      <div className="match-suggestion__product">
        <span className="match-suggestion__name">{candidate.displayName}</span>
        <span className="match-suggestion__meta">
          SKU: {candidate.sku}
          {candidate.brand ? ` · ${candidate.brand}` : ""}
          {" · "}
          {candidate.category}
        </span>
      </div>

      {candidate.reasons.length > 0 ? (
        <div className="match-suggestion__reasons" aria-label="Candidate reasons">
          {candidate.reasons.map((reason) => (
            <span key={reason} className="match-suggestion__reason-tag">
              {REASON_LABELS[reason]}
            </span>
          ))}
        </div>
      ) : null}

      <div className="match-suggestion__actions">
        <button
          type="button"
          className="button-primary match-suggestion__action"
          onClick={onAccept}
          data-testid="match-accept"
        >
          Accept Match
        </button>
      </div>
    </div>
  );
}
