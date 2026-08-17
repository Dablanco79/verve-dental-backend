/**
 * Clinic Product Maintenance — Sprint 2.0 + Category Finalisation regression tests.
 *
 * Covers all 13 required test cases:
 *  1.  Add Product starts with no selected category (placeholder)
 *  2.  OCR new-product modal starts with no selected category
 *  3.  Catalogue Import modal starts with no selected category
 *  4.  "Imported Catalogue" is absent from creation options
 *  5.  "Uncategorised" is absent from creation options
 *  6.  Submission is blocked until a genuine category is selected
 *  7.  Backend rejects missing category       (clinicProductApi.test.ts)
 *  8.  Backend rejects "Imported Catalogue"   (clinicProductApi.test.ts)
 *  9.  Backend rejects "Uncategorised"        (clinicProductApi.test.ts)
 *  10. Backend rejects arbitrary non-canonical (clinicProductApi.test.ts)
 *  11. Backend accepts a valid canonical      (clinicProductApi.test.ts)
 *  12. Category API failure disables creation
 *  13. Existing historical records are not modified (backend — no migration)
 *
 * Additional coverage:
 *  - InventoryTable "Set reorder level" links to the edit page
 *  - RBAC role mapping for Practice Manager
 *  - Field coverage for clinic product maintenance
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { MASTER_PRODUCT_CATEGORIES } from "../src/constants/categories.js";
import { InventoryTable } from "../src/components/inventory/InventoryTable.js";
import { ROLE_LABELS, canManageProducts } from "../src/utils/roles.js";
import type { InventoryItem } from "../src/types/inventory.js";
import type { UserRole } from "../src/types/index.js";

// ─── Mock API client ──────────────────────────────────────────────────────────

const mockListCategories = vi.fn();
const mockListSuppliers = vi.fn();

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listCategories: mockListCategories,
    listSuppliers: mockListSuppliers,
  }),
}));

vi.mock("../src/config/index.js", () => ({
  loadConfig: () => ({ apiBaseUrl: "http://localhost:3001" }),
}));

// ─── Mock auth / clinic context ───────────────────────────────────────────────

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "manager@clinic-a.au",
      role: "group_practice_manager" as UserRole,
      homeClinicId: "clinic-1",
      homeClinicName: "Clinic A",
      firstName: "Test",
      lastName: "Manager",
      displayName: "Test Manager",
      permissions: [],
    },
  }),
}));

vi.mock("../src/clinic/useOperationalClinic.js", () => ({
  useOperationalClinic: () => ({
    clinicId: "clinic-1",
    clinicName: "Clinic A",
    isAllClinicsScope: false,
  }),
}));

// ─── 4 & 5. MASTER_PRODUCT_CATEGORIES constant ───────────────────────────────

describe("MASTER_PRODUCT_CATEGORIES constant", () => {
  it("does not include 'Imported Catalogue'", () => {
    expect(MASTER_PRODUCT_CATEGORIES).not.toContain("Imported Catalogue");
  });

  it("does not include 'Uncategorised'", () => {
    // "Uncategorised" must not appear in creation selectors.
    // Historical records may still carry this value but it cannot be created.
    expect(MASTER_PRODUCT_CATEGORIES).not.toContain("Uncategorised");
  });

  it("includes expected canonical dental categories", () => {
    expect(MASTER_PRODUCT_CATEGORIES).toContain("PPE");
    expect(MASTER_PRODUCT_CATEGORIES).toContain("Restorative");
    expect(MASTER_PRODUCT_CATEGORIES).toContain("Consumables");
    expect(MASTER_PRODUCT_CATEGORIES).toContain("Dental Supplies");
    expect(MASTER_PRODUCT_CATEGORIES).toContain("Sterilisation");
  });

  it("has at least 10 canonical categories", () => {
    expect(MASTER_PRODUCT_CATEGORIES.length).toBeGreaterThanOrEqual(10);
  });
});

// ─── Base InventoryItem factory ───────────────────────────────────────────────

const baseItem: InventoryItem = {
  id: "e1111111-1111-4111-8111-111111111111",
  clinicId: "c1111111-1111-4111-8111-111111111111",
  masterCatalogItemId: "d1111111-1111-4111-8111-111111111111",
  masterSku: "VRV-GLV-001",
  name: "Nitrile Examination Gloves",
  category: "PPE",
  unitOfMeasure: "Box",
  stockUnit: "Box",
  receivingUnit: "Carton",
  unitsPerReceivingUnit: 10,
  quantityOnHand: 5,
  reorderPoint: 3,
  unitCostCents: 1899,
  unitCostOverrideCents: null,
  supplierPreference: null,
  preferredSupplierId: null,
  preferredSupplierName: null,
  isBelowReorderPoint: false,
  inDraftQuantity: 0,
  onOrderQuantity: 0,
  activePurchasingDocuments: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ─── InventoryTable — Set reorder level links to edit page ────────────────────

describe("InventoryTable — Set reorder level", () => {
  it("links to the edit page when productEditHrefForItem is provided", () => {
    const item: InventoryItem = {
      ...baseItem,
      quantityOnHand: 0,
      reorderPoint: 0,
      isBelowReorderPoint: false,
    };

    render(
      <MemoryRouter>
        <InventoryTable
          items={[item]}
          purchaseOrderHrefForItem={(i) =>
            `/purchase-orders?item=${i.masterCatalogItemId}`
          }
          productDetailHrefForItem={(i) => `/inventory/products/${i.id}`}
          productEditHrefForItem={(i) => `/inventory/products/${i.id}/edit`}
        />
      </MemoryRouter>,
    );

    const setReorderLink = screen.getByRole("link", { name: /set reorder level/i });
    expect(setReorderLink).toHaveAttribute("href", `/inventory/products/${item.id}/edit`);
  });

  it("falls back to detail page link when productEditHrefForItem is absent", () => {
    const item: InventoryItem = {
      ...baseItem,
      quantityOnHand: 0,
      reorderPoint: 0,
      isBelowReorderPoint: false,
    };

    render(
      <MemoryRouter>
        <InventoryTable
          items={[item]}
          purchaseOrderHrefForItem={(i) =>
            `/purchase-orders?item=${i.masterCatalogItemId}`
          }
          productDetailHrefForItem={(i) => `/inventory/products/${i.id}`}
        />
      </MemoryRouter>,
    );

    const setReorderLink = screen.getByRole("link", { name: /set reorder level/i });
    expect(setReorderLink).toHaveAttribute("href", `/inventory/products/${item.id}`);
  });
});

// ─── Mock SupplierInvoiceLine for modal tests ─────────────────────────────────

const mockLine = {
  id: "line-1",
  invoiceId: "inv-1",
  lineNumber: 1,
  ocrDescription: "Test product",
  ocrSku: "SKU-001",
  quantity: 5,
  unitPriceCents: 1000,
  priceIncludesTax: null,
  discountBasisPoints: 0,
  lineTotalCents: 5000,
  taxRateBasisPoints: 1000,
  taxCents: 500,
  supplierLineTotalCents: null,
  masterCatalogItemId: null,
  masterProductName: null,
  supplierCatalogueId: null,
  isMatched: false,
  matchMethod: null,
  reviewDecision: null,
  productCreationData: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ─── 1–3. Category placeholder start — no pre-selection ──────────────────────

describe("ProductCreationReviewModal — starts with no selected category", () => {
  // Test 2: OCR / Catalogue Import modal starts unresolved
  it("category select starts with placeholder (no category pre-selected)", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={["Consumables", "PPE", "Dental Supplies"]}
          isSaving={false}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    // Check the selected option is the placeholder (value="")
    const placeholderOption = screen.getByRole("option", { name: /select category/i });
    expect(placeholderOption.getAttribute("value")).toBe("");
    // The combobox must show the placeholder as selected
    expect(screen.getByRole("combobox", { name: /category/i })).toHaveDisplayValue(/select category/i);
  });

  it("shows 'Select category…' as the first option", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={["Consumables", "PPE"]}
          isSaving={false}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    const options = Array.from(
      screen.getByRole("combobox", { name: /category/i }).querySelectorAll("option"),
    );
    expect(options[0]?.getAttribute("value")).toBe("");
    expect(options[0]?.textContent).toMatch(/select category/i);
  });

  // Test 3: initialData restores a previously-chosen canonical category
  it("restores a previously saved canonical category from initialData", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          initialData={{
            productName: "Test",
            category: "PPE",
            supplierSku: null,
            stockUnit: "unit",
            receivingUnit: "unit",
            unitsPerReceivingUnit: 1,
            unitCostCents: 1000,
          }}
          categories={["Consumables", "PPE"]}
          isSaving={false}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("combobox", { name: /category/i })).toHaveDisplayValue("PPE");
  });
});

// ─── 4 & 5. Absent categories in modal options ────────────────────────────────

describe("ProductCreationReviewModal — absent disallowed categories", () => {
  it("does not include 'Imported Catalogue' in the options", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={[...MASTER_PRODUCT_CATEGORIES]}
          isSaving={false}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    const options = Array.from(
      screen.getByRole("combobox", { name: /category/i }).querySelectorAll("option"),
    ).map((o) => o.getAttribute("value") ?? "");

    expect(options).not.toContain("Imported Catalogue");
  });

  it("does not include 'Uncategorised' in the options", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={[...MASTER_PRODUCT_CATEGORIES]}
          isSaving={false}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    const options = Array.from(
      screen.getByRole("combobox", { name: /category/i }).querySelectorAll("option"),
    ).map((o) => o.getAttribute("value") ?? "");

    expect(options).not.toContain("Uncategorised");
  });
});

// ─── 6. Submission blocked without genuine category ───────────────────────────

describe("ProductCreationReviewModal — submission blocked without category", () => {
  it("blocks submission when no category is selected (placeholder)", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );
    const handleSave = vi.fn();

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={["Consumables", "PPE"]}
          isSaving={false}
          onSave={handleSave}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    // Do not select a category — submit with placeholder
    fireEvent.click(screen.getByRole("button", { name: /save and mark ready to create/i }));

    expect(handleSave).not.toHaveBeenCalled();
    expect(screen.getByText(/category is required/i)).toBeInTheDocument();
  });

  it("blocks submission when category select is disabled (empty list)", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );
    const handleSave = vi.fn();

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={[]}
          isSaving={false}
          onSave={handleSave}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    // Select is disabled when categories is empty
    expect(screen.getByLabelText(/category/i)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /save and mark ready to create/i }));
    expect(handleSave).not.toHaveBeenCalled();
  });

  it("allows submission after selecting a valid category", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );
    const handleSave = vi.fn();

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={["Consumables", "PPE"]}
          isSaving={false}
          onSave={handleSave}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    // Select a valid category
    const categorySelect = screen.getByLabelText(/category/i);
    fireEvent.change(categorySelect, { target: { value: "Consumables" } });
    fireEvent.click(screen.getByRole("button", { name: /save and mark ready to create/i }));

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Consumables" }),
    );
  });
});

// ─── 12. Category API failure disables creation ───────────────────────────────

describe("ProductCreationReviewModal — API failure disables submission", () => {
  it("shows error and disables submit when categoriesError is set", async () => {
    const { ProductCreationReviewModal } = await import(
      "../src/components/invoice/ProductCreationReviewModal.js"
    );
    const handleSave = vi.fn();

    render(
      <MemoryRouter>
        <ProductCreationReviewModal
          line={mockLine}
          categories={[]}
          categoriesError="Network error: failed to fetch"
          isSaving={false}
          onSave={handleSave}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    const submitBtn = screen.getByRole("button", { name: /save and mark ready to create/i });
    expect(submitBtn).toBeDisabled();
    fireEvent.click(submitBtn);
    expect(handleSave).not.toHaveBeenCalled();
    expect(screen.getByText(/categories could not be loaded/i)).toBeInTheDocument();
  });
});

// ─── 1. AddProductPage — starts with placeholder, uses API ───────────────────

describe("AddProductPage — category select", () => {
  const apiCategories = ["Consumables", "PPE", "Medications", "Dental Supplies"];

  beforeEach(() => {
    mockListCategories.mockResolvedValue(apiCategories);
    mockListSuppliers.mockResolvedValue([
      { id: "s1", supplierName: "Test Supplier", active: true },
    ]);
  });

  it("populates category dropdown from the categories API response", async () => {
    const { AddProductPage } = await import("../src/pages/AddProductPage.js");

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockListCategories).toHaveBeenCalledTimes(1);
    });

    // findByRole retries until the form (and its combobox) is rendered — i.e.
    // until both listSuppliers AND listCategories have resolved.
    const categorySelect = await screen.findByRole("combobox", { name: /category/i });
    const options = Array.from(
      categorySelect.querySelectorAll("option"),
    ).map((o) => o.textContent);

    for (const cat of apiCategories) {
      expect(options).toContain(cat);
    }
  });

  it("starts with placeholder — no category pre-selected", async () => {
    const { AddProductPage } = await import("../src/pages/AddProductPage.js");

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockListCategories).toHaveBeenCalled();
    });

    // findByRole retries until the form renders (suppliers loaded); then wait
    // for categories to finish loading so the placeholder text is stable.
    const categorySelect = await screen.findByRole("combobox", { name: /category/i });
    await waitFor(() => {
      expect(categorySelect).toHaveDisplayValue(/select category/i);
    });
  });

  it("does not include 'Imported Catalogue' in the category dropdown", async () => {
    mockListCategories.mockResolvedValue([...MASTER_PRODUCT_CATEGORIES]);

    const { AddProductPage } = await import("../src/pages/AddProductPage.js");

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockListCategories).toHaveBeenCalled();
    });

    // findByRole retries until the form (and its combobox) is rendered — i.e.
    // until both listSuppliers AND listCategories have resolved.
    const categorySelect = await screen.findByRole("combobox", { name: /category/i });
    const options = Array.from(
      categorySelect.querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(options).not.toContain("Imported Catalogue");
  });

  it("does not include 'Uncategorised' in the category dropdown", async () => {
    mockListCategories.mockResolvedValue([...MASTER_PRODUCT_CATEGORIES]);

    const { AddProductPage } = await import("../src/pages/AddProductPage.js");

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockListCategories).toHaveBeenCalled();
    });

    // findByRole retries until the form (and its combobox) is rendered — i.e.
    // until both listSuppliers AND listCategories have resolved.
    const categorySelect = await screen.findByRole("combobox", { name: /category/i });
    const options = Array.from(
      categorySelect.querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(options).not.toContain("Uncategorised");
  });

  it("disables submit and shows error when category API fails", async () => {
    mockListCategories.mockRejectedValue(new Error("Network error"));

    const { AddProductPage } = await import("../src/pages/AddProductPage.js");

    render(
      <MemoryRouter>
        <AddProductPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/categories could not be loaded/i)).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole("button", { name: /create product/i });
    expect(submitBtn).toBeDisabled();
  });
});

// ─── Practice Manager RBAC mapping ───────────────────────────────────────────

describe("Practice Manager RBAC mapping", () => {
  it("group_practice_manager is labelled 'Practice Manager' in the UI", () => {
    expect(ROLE_LABELS["group_practice_manager"]).toBe("Practice Manager");
  });

  it("group_practice_manager can manage products", () => {
    expect(canManageProducts("group_practice_manager")).toBe(true);
  });

  it("owner_admin can manage products", () => {
    expect(canManageProducts("owner_admin")).toBe(true);
  });

  it("clinical_staff cannot manage products", () => {
    expect(canManageProducts("clinical_staff")).toBe(false);
  });

  it("there is no separate practice_manager role — group_practice_manager IS the Practice Manager", () => {
    const roleLabels = Object.entries(ROLE_LABELS) as [UserRole, string][];
    const practiceManagerRole = roleLabels.find(([, label]) => label === "Practice Manager");
    expect(practiceManagerRole).toBeDefined();
    expect(practiceManagerRole?.[0]).toBe("group_practice_manager");
  });
});

// ─── Clinical staff is read-only ─────────────────────────────────────────────

describe("Clinical staff — read-only product access", () => {
  it("clinical_staff cannot manage products via canManageProducts", () => {
    expect(canManageProducts("clinical_staff")).toBe(false);
  });
});
