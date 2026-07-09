/**
 * Product Matching Engine v1 — Frontend tests.
 *
 * Tests:
 *   — ProductMatchSuggestionCard renders suggestion correctly
 *   — Accept match fires onAccept callback
 *   — Choose Different fires onChooseDifferent callback
 *   — Create New fires onCreateNew callback
 *   — Skip fires onSkip callback
 *   — MasterProductSearchModal shows results and fires onSelect
 *   — MasterProductSearchModal hides when isOpen is false
 *   — Import button enable/disable logic
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductMatchSuggestionCard } from "../src/components/masterProduct/ProductMatchSuggestionCard.js";
import { MasterProductSearchModal } from "../src/components/masterProduct/MasterProductSearchModal.js";
import type { MasterProduct, MasterProductsPage, ProductMatchSuggestion } from "../src/types/masterProduct.js";

// ─── Mock api/client and config ───────────────────────────────────────────────

const { mockListMasterProducts } = vi.hoisted(() => ({
  mockListMasterProducts: vi.fn(),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listMasterProducts: mockListMasterProducts,
  }),
}));

vi.mock("../src/config/index.js", () => ({
  loadConfig: () => ({ apiBaseUrl: "http://localhost:4000" }),
}));

// ─── Test fixtures ────────────────────────────────────────────────────────────

const SUGGESTION: ProductMatchSuggestion = {
  masterProductId: "11111111-1111-4111-8111-111111111111",
  displayName: "Nitrile Examination Gloves (Box 100)",
  sku: "VRV-GLV-001",
  category: "PPE",
  brand: null,
  stockUnit: "Box",
  confidence: 95,
  reasons: ["exact_name", "category_boost"],
};

const MASTER_PRODUCT: MasterProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Nitrile Examination Gloves (Box 100)",
  sku: "VRV-GLV-001",
  category: "PPE",
  subcategory: null,
  brand: null,
  variantAttributes: null,
  stockUnit: "Box",
  receivingUnit: "Carton",
  status: "active",
  notes: null,
  isActive: true,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const MASTER_PRODUCTS_PAGE: MasterProductsPage = {
  items: [MASTER_PRODUCT],
  total: 1,
  limit: 20,
  offset: 0,
};

// ─── ProductMatchSuggestionCard ───────────────────────────────────────────────

describe("ProductMatchSuggestionCard", () => {
  it("renders the suggestion card with product name and confidence", () => {
    render(
      <ProductMatchSuggestionCard
        suggestion={SUGGESTION}
        onAccept={vi.fn()}
        onChooseDifferent={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByTestId("match-suggestion-card")).toBeInTheDocument();
    expect(screen.getByText("Nitrile Examination Gloves (Box 100)")).toBeInTheDocument();
    expect(screen.getByText("95% match")).toBeInTheDocument();
  });

  it("renders human-readable reason labels", () => {
    render(
      <ProductMatchSuggestionCard
        suggestion={SUGGESTION}
        onAccept={vi.fn()}
        onChooseDifferent={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText("Exact name match")).toBeInTheDocument();
    expect(screen.getByText("Same category")).toBeInTheDocument();
  });

  it("calls onAccept when Accept Match is clicked", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <ProductMatchSuggestionCard
        suggestion={SUGGESTION}
        onAccept={onAccept}
        onChooseDifferent={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("match-accept"));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("calls onChooseDifferent when Choose Different is clicked", async () => {
    const user = userEvent.setup();
    const onChooseDifferent = vi.fn();
    render(
      <ProductMatchSuggestionCard
        suggestion={SUGGESTION}
        onAccept={vi.fn()}
        onChooseDifferent={onChooseDifferent}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("match-choose-different"));
    expect(onChooseDifferent).toHaveBeenCalledOnce();
  });

  it("calls onCreateNew when Create New Product is clicked", async () => {
    const user = userEvent.setup();
    const onCreateNew = vi.fn();
    render(
      <ProductMatchSuggestionCard
        suggestion={SUGGESTION}
        onAccept={vi.fn()}
        onChooseDifferent={vi.fn()}
        onCreateNew={onCreateNew}
        onSkip={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("match-create-new"));
    expect(onCreateNew).toHaveBeenCalledOnce();
  });

  it("calls onSkip when Skip is clicked", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(
      <ProductMatchSuggestionCard
        suggestion={SUGGESTION}
        onAccept={vi.fn()}
        onChooseDifferent={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={onSkip}
      />,
    );

    await user.click(screen.getByTestId("match-skip"));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("shows supplier_sku_mapping reason label", () => {
    render(
      <ProductMatchSuggestionCard
        suggestion={{ ...SUGGESTION, reasons: ["supplier_sku_mapping"] }}
        onAccept={vi.fn()}
        onChooseDifferent={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText("Supplier SKU matched")).toBeInTheDocument();
  });

  it("renders high confidence with correct class", () => {
    render(
      <ProductMatchSuggestionCard
        suggestion={{ ...SUGGESTION, confidence: 100 }}
        onAccept={vi.fn()}
        onChooseDifferent={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    const confidenceBadge = screen.getByText("100% match");
    expect(confidenceBadge).toHaveClass("match-suggestion__confidence--high");
  });

  it("renders low confidence with correct class for score < 60", () => {
    render(
      <ProductMatchSuggestionCard
        suggestion={{ ...SUGGESTION, confidence: 40 }}
        onAccept={vi.fn()}
        onChooseDifferent={vi.fn()}
        onCreateNew={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    const confidenceBadge = screen.getByText("40% match");
    expect(confidenceBadge).toHaveClass("match-suggestion__confidence--low");
  });
});

// ─── MasterProductSearchModal ─────────────────────────────────────────────────

describe("MasterProductSearchModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(
      <MemoryRouter>
        <MasterProductSearchModal
          isOpen={false}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the modal dialog when isOpen is true", () => {
    mockListMasterProducts.mockResolvedValue(MASTER_PRODUCTS_PAGE);

    render(
      <MemoryRouter>
        <MasterProductSearchModal
          isOpen={true}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("master-product-search-input")).toBeInTheDocument();
  });

  it("searches and renders product results", async () => {
    mockListMasterProducts.mockResolvedValue(MASTER_PRODUCTS_PAGE);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <MasterProductSearchModal
          isOpen={true}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.type(screen.getByTestId("master-product-search-input"), "Nitrile");

    await waitFor(() => {
      expect(mockListMasterProducts).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Nitrile" }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("Nitrile Examination Gloves (Box 100)"),
      ).toBeInTheDocument();
    });
  });

  it("calls onSelect with selected product", async () => {
    mockListMasterProducts.mockResolvedValue(MASTER_PRODUCTS_PAGE);
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <MasterProductSearchModal
          isOpen={true}
          onClose={vi.fn()}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );

    await user.type(screen.getByTestId("master-product-search-input"), "Nitrile");

    await waitFor(() =>
      screen.getByTestId(`search-result-${MASTER_PRODUCT.id}`),
    );

    await user.click(screen.getByTestId(`search-result-${MASTER_PRODUCT.id}`));

    expect(onSelect).toHaveBeenCalledWith(MASTER_PRODUCT);
  });

  it("shows empty state when no results found", async () => {
    mockListMasterProducts.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    } satisfies MasterProductsPage);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <MasterProductSearchModal
          isOpen={true}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.type(screen.getByTestId("master-product-search-input"), "ZZZ");

    await waitFor(() => {
      expect(screen.getByText(/No active master products found/)).toBeInTheDocument();
    });
  });

  it("calls onClose when Escape is pressed", () => {
    mockListMasterProducts.mockResolvedValue(MASTER_PRODUCTS_PAGE);
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <MasterProductSearchModal
          isOpen={true}
          onClose={onClose}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Cancel button is clicked", async () => {
    mockListMasterProducts.mockResolvedValue(MASTER_PRODUCTS_PAGE);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <MasterProductSearchModal
          isOpen={true}
          onClose={onClose}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
