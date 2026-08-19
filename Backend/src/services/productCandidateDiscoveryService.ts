/**
 * Human-assisted product candidate discovery.
 *
 * This service is intentionally separate from strict automatic identity
 * resolution. Its relevance scores are ordering hints for a human reviewer
 * only and must never be consumed as ProductMatchResult confidence.
 */
import type { CatalogRepository } from "../repositories/catalogRepository.js";
import type { SupplierCatalogueRepository } from "../repositories/supplierCatalogueRepository.js";
import type { MasterCatalogItem } from "../types/inventory.js";
import type {
  DiscoverReviewCandidatesInput,
  DiscoverReviewCandidatesResult,
  ReviewCandidateAttribute,
  ReviewCandidateEvidence,
  ReviewCandidateReason,
  ReviewProductCandidate,
  UnresolvedReviewAttribute,
} from "../types/supplier.js";

type CanonicalSize = "extra-small" | "small" | "medium" | "large" | "extra-large";

export type ReviewCandidateProfile = {
  familyTokens: string[];
  size: CanonicalSize | null;
  packCount: number | null;
  colour: string | null;
  protectedVariantTokens: string[];
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "at", "to", "by",
]);

const PACK_WORDS = new Set(["pack", "packs", "pk", "box"]);

const COLOUR_ALIASES: Readonly<Record<string, string>> = {
  black: "black",
  blue: "blue",
  brown: "brown",
  clear: "clear",
  gold: "gold",
  gray: "grey",
  green: "green",
  grey: "grey",
  navy: "navy",
  orange: "orange",
  pink: "pink",
  purple: "purple",
  red: "red",
  silver: "silver",
  white: "white",
  yellow: "yellow",
};

const SIZE_LABELS: Readonly<Record<CanonicalSize, string>> = {
  "extra-small": "Extra Small",
  small: "Small",
  medium: "Medium",
  large: "Large",
  "extra-large": "Extra Large",
};

function normaliseDiscoveryText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SINGULAR_WORDS_ENDING_IN_S = new Set([
  "forceps",
  "lens",
  "means",
  "news",
  "scissors",
  "series",
  "species",
]);

/**
 * Conservative regular-plural canonicalisation for review-family tokens.
 * Short words, protected suffixes and known singular/invariant s-words stay
 * untouched. This is deliberately not a general stemmer.
 */
function canonicaliseFamilyToken(token: string): string {
  if (
    token.length >= 4 &&
    /^[a-z]+s$/.test(token) &&
    !/(?:ss|us|is|as|os|ics|ness)$/.test(token) &&
    !SINGULAR_WORDS_ENDING_IN_S.has(token)
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function extractPackCount(value: string): number | null {
  const patterns = [
    /\b(\d{1,5})\s*(?:pk|pack|packs)\b/i,
    /\b(?:pack|box)\s+of\s+(\d{1,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const parsed = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function extractColour(tokens: string[]): string | null {
  for (const token of tokens) {
    const colour = COLOUR_ALIASES[token];
    if (colour) return colour;
  }
  return null;
}

function extractLongSize(normalised: string, tokens: string[]): CanonicalSize | null {
  if (/\b(?:extra\s+small|x\s+small)\b/.test(normalised) || tokens.includes("xs")) {
    return "extra-small";
  }
  if (/\b(?:extra\s+large|x\s+large)\b/.test(normalised) || tokens.includes("xl")) {
    return "extra-large";
  }
  if (tokens.includes("small") || tokens.includes("sm")) return "small";
  if (tokens.includes("medium") || tokens.includes("med")) return "medium";
  if (tokens.includes("large") || tokens.includes("lg")) return "large";
  return null;
}

function extractContextualSingleLetterSize(
  tokens: string[],
  packCount: number | null,
  colour: string | null,
): CanonicalSize | null {
  const singleLetterSizes: Readonly<Record<string, CanonicalSize>> = {
    s: "small",
    m: "medium",
    l: "large",
  };
  const index = tokens.findIndex((token) => singleLetterSizes[token] !== undefined);
  if (index === -1) return null;

  const familyTokenCount = tokens.filter(
    (token) =>
      token.length >= 2 &&
      !STOP_WORDS.has(token) &&
      !PACK_WORDS.has(token) &&
      COLOUR_ALIASES[token] === undefined &&
      !/^\d+(?:pk|pack|packs)$/.test(token),
  ).length;
  const hasVariantContext =
    familyTokenCount >= 2 &&
    (packCount !== null || colour !== null || index === tokens.length - 1);
  return hasVariantContext ? (singleLetterSizes[tokens[index] ?? ""] ?? null) : null;
}

function sizeTokensFor(size: CanonicalSize | null): Set<string> {
  if (size === null) return new Set();
  const values: Record<CanonicalSize, string[]> = {
    "extra-small": ["xs", "extra", "x", "small"],
    small: ["s", "sm", "small"],
    medium: ["m", "med", "medium"],
    large: ["l", "lg", "large"],
    "extra-large": ["xl", "extra", "x", "large"],
  };
  return new Set(values[size]);
}

export function deriveReviewCandidateProfile(value: string): ReviewCandidateProfile {
  const normalised = normaliseDiscoveryText(value);
  const tokens = normalised.length > 0 ? normalised.split(" ") : [];
  const packCount = extractPackCount(value);
  const colour = extractColour(tokens);
  const longSize = extractLongSize(normalised, tokens);
  const size = longSize ?? extractContextualSingleLetterSize(tokens, packCount, colour);
  const excludedSizeTokens = sizeTokensFor(size);
  const protectedVariantTokens = Array.from(value.matchAll(/\((0+)\)/g), (match) => match[1] ?? "")
    .filter((token) => token.length > 0);

  const familyTokens = tokens
    .filter((token) => {
      if (STOP_WORDS.has(token) || PACK_WORDS.has(token)) return false;
      if (COLOUR_ALIASES[token] !== undefined || excludedSizeTokens.has(token)) return false;
      if (/^\d+(?:pk|pack|packs)$/.test(token)) return false;
      if (packCount !== null && token === String(packCount)) return false;
      return token.length >= 2 || /^\d+$/.test(token);
    })
    .map(canonicaliseFamilyToken);

  return {
    familyTokens: Array.from(new Set(familyTokens)),
    size,
    packCount,
    colour,
    protectedVariantTokens,
  };
}

function familyRelevance(source: ReviewCandidateProfile, candidate: ReviewCandidateProfile): number {
  if (candidate.familyTokens.length === 0) return 0;
  const sourceTokens = new Set(source.familyTokens);
  const matched = candidate.familyTokens.filter((token) => sourceTokens.has(token)).length;
  if (candidate.familyTokens.length === 1) return matched === 1 ? 1 : 0;
  if (matched < 2) return 0;
  return matched / candidate.familyTokens.length;
}

function protectedVariantsConflict(
  source: ReviewCandidateProfile,
  candidate: ReviewCandidateProfile,
): boolean {
  if (
    source.protectedVariantTokens.length === 0 ||
    candidate.protectedVariantTokens.length === 0
  ) {
    return false;
  }
  const sourceValues = new Set(source.protectedVariantTokens);
  return candidate.protectedVariantTokens.some((value) => !sourceValues.has(value));
}

function hasExplicitConflict(
  source: ReviewCandidateProfile,
  candidate: ReviewCandidateProfile,
): boolean {
  return (
    (source.size !== null && candidate.size !== null && source.size !== candidate.size) ||
    (source.packCount !== null &&
      candidate.packCount !== null &&
      source.packCount !== candidate.packCount) ||
    (source.colour !== null &&
      candidate.colour !== null &&
      source.colour !== candidate.colour) ||
    protectedVariantsConflict(source, candidate)
  );
}

function scoreCandidate(
  source: ReviewCandidateProfile,
  candidate: ReviewCandidateProfile,
  relevance: number,
): { score: number; reasons: ReviewCandidateReason[] } {
  const reasons: ReviewCandidateReason[] = ["family_relevance"];
  let score = Math.round(relevance * 50);
  if (source.size !== null && source.size === candidate.size) {
    score += 25;
    reasons.push("size_match");
  }
  if (source.packCount !== null && source.packCount === candidate.packCount) {
    score += 20;
    reasons.push("pack_count_match");
  }
  if (source.colour !== null && source.colour === candidate.colour) {
    score += 5;
    reasons.push("colour_match");
  }
  return { score: Math.min(score, 100), reasons };
}

function toCandidate(
  item: MasterCatalogItem,
  relevanceScore: number,
  reasons: ReviewCandidateReason[],
): ReviewProductCandidate {
  return {
    masterProductId: item.id,
    displayName: item.name,
    sku: item.sku,
    category: item.category,
    brand: item.brand,
    stockUnit: item.stockUnit,
    relevanceScore,
    reasons,
  };
}

function isActive(item: MasterCatalogItem | null): item is MasterCatalogItem {
  return item !== null && item.isActive && item.status !== "archived";
}

function titleCase(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}

function buildEvidence(
  source: ReviewCandidateProfile,
  candidateProfiles: ReviewCandidateProfile[],
): ReviewCandidateEvidence[] {
  const evidence: ReviewCandidateEvidence[] = [];
  if (source.size !== null && candidateProfiles.some((profile) => profile.size === source.size)) {
    evidence.push({ attribute: "size", label: "Size", value: SIZE_LABELS[source.size] });
  }
  if (
    source.packCount !== null &&
    candidateProfiles.some((profile) => profile.packCount === source.packCount)
  ) {
    evidence.push({
      attribute: "pack_count",
      label: "Pack",
      value: `${String(source.packCount)}pk`,
    });
  }
  if (
    source.colour !== null &&
    candidateProfiles.some((profile) => profile.colour === source.colour)
  ) {
    evidence.push({
      attribute: "colour",
      label: "Colour",
      value: titleCase(source.colour),
    });
  }
  return evidence;
}

function unresolvedMessage(attribute: ReviewCandidateAttribute): UnresolvedReviewAttribute {
  if (attribute === "colour") {
    return {
      attribute,
      label: "Colour",
      message: "Colour was not provided by the supplier. Choose the correct variant.",
    };
  }
  if (attribute === "size") {
    return {
      attribute,
      label: "Size",
      message: "Size was not provided by the supplier. Choose the correct variant.",
    };
  }
  return {
    attribute,
    label: "Pack",
    message: "Pack count was not provided by the supplier. Choose the correct variant.",
  };
}

function buildUnresolvedAttributes(
  source: ReviewCandidateProfile,
  candidateProfiles: ReviewCandidateProfile[],
): UnresolvedReviewAttribute[] {
  const unresolved: UnresolvedReviewAttribute[] = [];
  if (source.size === null && candidateProfiles.some((profile) => profile.size !== null)) {
    unresolved.push(unresolvedMessage("size"));
  }
  if (
    source.packCount === null &&
    candidateProfiles.some((profile) => profile.packCount !== null)
  ) {
    unresolved.push(unresolvedMessage("pack_count"));
  }
  if (source.colour === null && candidateProfiles.some((profile) => profile.colour !== null)) {
    unresolved.push(unresolvedMessage("colour"));
  }
  return unresolved;
}

export function createProductCandidateDiscoveryService(
  catalogRepository: CatalogRepository,
  supplierCatalogueRepository?: SupplierCatalogueRepository,
) {
  return {
    async discoverReviewCandidates(
      input: DiscoverReviewCandidatesInput,
    ): Promise<DiscoverReviewCandidatesResult> {
      const source = deriveReviewCandidateProfile(input.supplierDescription?.trim() ?? "");
      const scored = new Map<
        string,
        { item: MasterCatalogItem; score: number; reasons: ReviewCandidateReason[] }
      >();

      if (
        supplierCatalogueRepository &&
        input.supplierId.trim() &&
        input.supplierSku?.trim()
      ) {
        const mapping = await supplierCatalogueRepository.findSupplierProductBySupplierSku(
          input.supplierId.trim(),
          input.supplierSku.trim(),
        );
        if (mapping) {
          const item = await catalogRepository.findMasterItemById(mapping.productId);
          if (isActive(item)) {
            const profile = deriveReviewCandidateProfile(item.name);
            const relevance = familyRelevance(source, profile);
            if (
              (source.familyTokens.length === 0 || relevance >= 0.6) &&
              !hasExplicitConflict(source, profile)
            ) {
              scored.set(item.id, {
                item,
                score: 100,
                reasons: ["confirmed_supplier_mapping"],
              });
            }
          }
        }
      }

      if (source.familyTokens.length > 0) {
        const allItems = await catalogRepository.listMasterItems();
        for (const item of allItems) {
          if (!isActive(item) || scored.has(item.id)) continue;
          const profile = deriveReviewCandidateProfile(
            `${item.name} ${item.variantAttributes ?? ""}`,
          );
          if (hasExplicitConflict(source, profile)) continue;
          const relevance = familyRelevance(source, profile);
          if (relevance < 0.6) continue;
          const result = scoreCandidate(source, profile, relevance);
          scored.set(item.id, { item, score: result.score, reasons: result.reasons });
        }
      }

      const candidates = Array.from(scored.values())
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.item.name.localeCompare(b.item.name) ||
            a.item.id.localeCompare(b.item.id),
        )
        .slice(0, 5)
        .map(({ item, score, reasons }) => toCandidate(item, score, reasons));
      const candidateProfiles = candidates.map((candidate) =>
        deriveReviewCandidateProfile(candidate.displayName),
      );
      const firstProfile = candidateProfiles[0];
      const familyLabel =
        firstProfile && firstProfile.familyTokens.length >= 2
          ? firstProfile.familyTokens.map(titleCase).join(" ")
          : null;

      return {
        candidates,
        familyLabel,
        matchedAttributes: buildEvidence(source, candidateProfiles),
        unresolvedAttributes: buildUnresolvedAttributes(source, candidateProfiles),
        selectionRequired: true,
      };
    },
  };
}

export type ProductCandidateDiscoveryService = ReturnType<
  typeof createProductCandidateDiscoveryService
>;
