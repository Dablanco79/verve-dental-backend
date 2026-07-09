/**
 * ProductMatchSuggestionCard — Product Matching Engine v1.
 *
 * Displays a single ranked suggestion from the matching engine with:
 *   — Confidence score (colour-coded)
 *   — Human-readable reason labels
 *   — Accept Match / Choose Different / Create New / Skip actions
 */
import type { ProductMatchSuggestion } from "../../types/masterProduct.js";

// ─── Reason label map ─────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  supplier_sku_mapping: "Supplier SKU matched",
  exact_name: "Exact name match",
  token_similarity: "Similar name",
  category_boost: "Same category",
  brand_boost: "Same brand",
  unit_boost: "Same unit",
};

function confidenceClass(confidence: number): string {
  if (confidence >= 90) return "match-suggestion__confidence--high";
  if (confidence >= 60) return "match-suggestion__confidence--medium";
  return "match-suggestion__confidence--low";
}

// ─── Component ────────────────────────────────────────────────────────────────

type ProductMatchSuggestionCardProps = {
  suggestion: ProductMatchSuggestion;
  onAccept: () => void;
  onChooseDifferent: () => void;
  onCreateNew: () => void;
  onSkip: () => void;
};

export function ProductMatchSuggestionCard({
  suggestion,
  onAccept,
  onChooseDifferent,
  onCreateNew,
  onSkip,
}: ProductMatchSuggestionCardProps) {
  return (
    <div className="match-suggestion" data-testid="match-suggestion-card">
      <div className="match-suggestion__header">
        <span className="match-suggestion__label">Suggested Master Product</span>
        <span
          className={`match-suggestion__confidence ${confidenceClass(suggestion.confidence)}`}
          aria-label={`Confidence: ${String(suggestion.confidence)}%`}
        >
          {String(suggestion.confidence)}% match
        </span>
      </div>

      <div className="match-suggestion__product">
        <span className="match-suggestion__name">{suggestion.displayName}</span>
        <span className="match-suggestion__meta">
          SKU: {suggestion.sku}
          {suggestion.brand ? ` · ${suggestion.brand}` : ""}
          {" · "}{suggestion.category}
        </span>
      </div>

      {suggestion.reasons.length > 0 ? (
        <div className="match-suggestion__reasons" aria-label="Match reasons">
          {suggestion.reasons.map((reason) => (
            <span key={reason} className="match-suggestion__reason-tag">
              {REASON_LABELS[reason] ?? reason}
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
        <button
          type="button"
          className="link-button match-suggestion__action"
          onClick={onChooseDifferent}
          data-testid="match-choose-different"
        >
          Choose Different
        </button>
        <button
          type="button"
          className="link-button match-suggestion__action"
          onClick={onCreateNew}
          data-testid="match-create-new"
        >
          Create New Product
        </button>
        <button
          type="button"
          className="link-button match-suggestion__action"
          onClick={onSkip}
          data-testid="match-skip"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
