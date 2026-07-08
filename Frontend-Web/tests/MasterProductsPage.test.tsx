import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MasterProductsPage } from "../src/pages/MasterProductsPage.js";
import type { MasterProduct, MasterProductsPage as MasterProductsPageResult } from "../src/types/masterProduct.js";
import { createAdminUser, createManagerUser, createStaffUser } from "./helpers/auth.js";
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
  type AuthTestState,
} from "./helpers/mockUseAuth.js";

const {
  authTestState,
  mockListMasterProducts,
  mockCreateMasterProduct,
  mockUpdateMasterProduct,
  mockArchiveMasterProduct,
  mockReactivateMasterProduct,
} = vi.hoisted(() => {
  const authTestState: AuthTestState = { user: null, isLoading: false };
  return {
    authTestState,
    mockListMasterProducts: vi.fn(),
    mockCreateMasterProduct: vi.fn(),
    mockUpdateMasterProduct: vi.fn(),
    mockArchiveMasterProduct: vi.fn(),
    mockReactivateMasterProduct: vi.fn(),
  };
});

vi.mock("../src/auth/useAuth.js", () => ({
  useAuth: () => ({
    user: authTestState.user,
    isLoading: authTestState.isLoading,
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../src/api/client.js", () => ({
  createApiClient: () => ({
    listMasterProducts: mockListMasterProducts,
    createMasterProduct: mockCreateMasterProduct,
    updateMasterProduct: mockUpdateMasterProduct,
    archiveMasterProduct: mockArchiveMasterProduct,
    reactivateMasterProduct: mockReactivateMasterProduct,
    getHealth: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getMe: vi.fn(),
  }),
}));

const gloves: MasterProduct = {
  id: "mp-1111-1111-1111-111111111111",
  displayName: "Nitrile Examination Gloves (Medium)",
  sku: "GLV-MED-001",
  category: "PPE",
  subcategory: "Gloves",
  brand: "SafeHands",
  variantAttributes: "Size: Medium",
  stockUnit: "Box",
  receivingUnit: "Carton",
  status: "active",
  notes: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const suctionTips: MasterProduct = {
  id: "mp-2222-2222-2222-222222222222",
  displayName: "Surgical Suction Tips",
  sku: "SUC-001",
  category: "Surgical",
  subcategory: null,
  brand: null,
  variantAttributes: null,
  stockUnit: "Unit",
  receivingUnit: "Unit",
  status: "archived",
  notes: null,
  isActive: false,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

function makePage(items: MasterProduct[], overrides: Partial<MasterProductsPageResult> = {}): MasterProductsPageResult {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MasterProductsPage />
    </MemoryRouter>,
  );
}

describe("MasterProductsPage", () => {
  beforeEach(() => {
    clearAuthenticatedUser(authTestState);
    mockListMasterProducts.mockReset();
    mockCreateMasterProduct.mockReset();
    mockUpdateMasterProduct.mockReset();
    mockArchiveMasterProduct.mockReset();
    mockReactivateMasterProduct.mockReset();

    setAuthenticatedUser(authTestState, createManagerUser());
    mockListMasterProducts.mockResolvedValue(makePage([gloves]));
  });

  // ── List rendering ───────────────────────────────────────────────────────────

  it("shows loading state then renders the master products table", async () => {
    renderPage();

    expect(screen.getByText("Loading master products…")).toBeInTheDocument();

    expect(await screen.findByText("Nitrile Examination Gloves (Medium)")).toBeInTheDocument();
    expect(screen.getByText("PPE")).toBeInTheDocument();
  });

  it("defaults to the active status filter on first load", async () => {
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    expect(mockListMasterProducts).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", limit: 20, offset: 0 }),
    );
  });

  it("shows an error message when the API call fails", async () => {
    mockListMasterProducts.mockRejectedValue(new Error("Network error"));
    renderPage();

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("shows empty state when no master products match", async () => {
    mockListMasterProducts.mockResolvedValue(makePage([]));
    renderPage();

    expect(await screen.findByText("No master products found")).toBeInTheDocument();
  });

  it("does not call the API when user is not authenticated", async () => {
    clearAuthenticatedUser(authTestState);
    renderPage();

    await waitFor(() => {
      expect(screen.queryByText("Loading master products…")).not.toBeInTheDocument();
    });

    expect(mockListMasterProducts).not.toHaveBeenCalled();
  });

  // ── Search / filter controls ─────────────────────────────────────────────────

  it("calls the API with the search term after debounce", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");
    mockListMasterProducts.mockClear();

    const searchInput = screen.getByPlaceholderText("Display name, internal code, category, or brand…");
    await user.type(searchInput, "Nitrile");

    await waitFor(
      () => {
        expect(mockListMasterProducts).toHaveBeenCalledWith(
          expect.objectContaining({ search: "Nitrile" }),
        );
      },
      { timeout: 2000 },
    );
  });

  it("calls the API with the category filter", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");
    mockListMasterProducts.mockClear();

    const categoryInput = screen.getByPlaceholderText("e.g. PPE");
    await user.type(categoryInput, "PPE");

    await waitFor(() => {
      expect(mockListMasterProducts).toHaveBeenCalledWith(
        expect.objectContaining({ category: "PPE" }),
      );
    });
  });

  it("calls the API with the status filter", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");
    mockListMasterProducts.mockClear();
    mockListMasterProducts.mockResolvedValue(makePage([suctionTips]));

    const statusSelect = screen.getByDisplayValue("Active only");
    await user.selectOptions(statusSelect, "archived");

    await waitFor(() => {
      expect(mockListMasterProducts).toHaveBeenCalledWith(
        expect.objectContaining({ status: "archived" }),
      );
    });

    expect(await screen.findByText("Surgical Suction Tips")).toBeInTheDocument();
  });

  it("clears filters on Clear button click", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    const categoryInput = screen.getByPlaceholderText("e.g. PPE");
    await user.type(categoryInput, "PPE");

    const clearButton = await screen.findByRole("button", { name: "Clear" });
    await user.click(clearButton);

    expect(categoryInput).toHaveValue("");
  });

  // ── Pagination ───────────────────────────────────────────────────────────────

  it("shows pagination summary and disables Previous on the first page", async () => {
    mockListMasterProducts.mockResolvedValue(makePage([gloves], { total: 1, limit: 20, offset: 0 }));
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    expect(screen.getByText(/1–1 of 1 master products/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previous page/i })).toBeDisabled();
  });

  it("requests the next page when Next is clicked", async () => {
    const user = userEvent.setup();
    mockListMasterProducts.mockResolvedValue(makePage([gloves], { total: 40, limit: 20, offset: 0 }));
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: /Next page/i }));

    await waitFor(() => {
      expect(mockListMasterProducts).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 20 }),
      );
    });
  });

  // ── RBAC ─────────────────────────────────────────────────────────────────────

  it("shows Add Master Product button for manager role", async () => {
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    expect(screen.getByRole("button", { name: "+ Add Master Product" })).toBeInTheDocument();
  });

  it("shows Add Master Product button for admin role", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createAdminUser());
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    expect(screen.getByRole("button", { name: "+ Add Master Product" })).toBeInTheDocument();
  });

  it("hides Add Master Product button and row actions for clinical_staff (read-only)", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    expect(screen.queryByRole("button", { name: "+ Add Master Product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("still lists master products for clinical_staff (read access)", async () => {
    clearAuthenticatedUser(authTestState);
    setAuthenticatedUser(authTestState, createStaffUser());
    renderPage();

    expect(await screen.findByText("Nitrile Examination Gloves (Medium)")).toBeInTheDocument();
  });

  // ── Add master product ───────────────────────────────────────────────────────

  it("opens the Add Master Product modal", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: "+ Add Master Product" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Add Master Product")).toBeInTheDocument();
  });

  it("validates required fields in the Add form", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: "+ Add Master Product" }));
    await user.click(screen.getByRole("button", { name: "Create Master Product" }));

    expect(await screen.findByText("Display name is required.")).toBeInTheDocument();
    expect(mockCreateMasterProduct).not.toHaveBeenCalled();
  });

  it("validates category is required in the Add form", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: "+ Add Master Product" }));
    await user.type(screen.getByPlaceholderText(/Nitrile Examination Gloves/i), "New Product");
    await user.click(screen.getByRole("button", { name: "Create Master Product" }));

    expect(await screen.findByText("Category is required.")).toBeInTheDocument();
    expect(mockCreateMasterProduct).not.toHaveBeenCalled();
  });

  it("creates a new master product and refreshes the list", async () => {
    const user = userEvent.setup();
    const created: MasterProduct = {
      ...gloves,
      id: "mp-new",
      displayName: "New Master Product",
      category: "Consumables",
    };
    mockCreateMasterProduct.mockResolvedValue(created);

    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Medium)");

    mockListMasterProducts.mockResolvedValue(makePage([gloves, created]));

    await user.click(screen.getByRole("button", { name: "+ Add Master Product" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText(/Nitrile Examination Gloves/i), "New Master Product");
    await user.type(within(dialog).getByPlaceholderText("e.g. PPE"), "Consumables");
    await user.click(screen.getByRole("button", { name: "Create Master Product" }));

    await waitFor(() => {
      expect(mockCreateMasterProduct).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "New Master Product", category: "Consumables" }),
      );
    });

    expect(await screen.findByText("New Master Product")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a duplicate error returned by the API without closing the modal", async () => {
    const user = userEvent.setup();
    mockCreateMasterProduct.mockRejectedValue(
      new Error("A master product with this display name and category already exists."),
    );

    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: "+ Add Master Product" }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByPlaceholderText(/Nitrile Examination Gloves/i),
      "Nitrile Examination Gloves (Medium)",
    );
    await user.type(within(dialog).getByPlaceholderText("e.g. PPE"), "PPE");
    await user.click(screen.getByRole("button", { name: "Create Master Product" }));

    expect(
      await screen.findByText("A master product with this display name and category already exists."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // ── Edit master product ──────────────────────────────────────────────────────

  it("opens the Edit modal pre-populated with the product's values", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Edit Master Product")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nitrile Examination Gloves (Medium)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("GLV-MED-001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("PPE")).toBeInTheDocument();
  });

  it("submits updated values and refreshes the list", async () => {
    const user = userEvent.setup();
    const updated: MasterProduct = { ...gloves, brand: "NewBrand" };
    mockUpdateMasterProduct.mockResolvedValue(updated);

    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Medium)");
    mockListMasterProducts.mockResolvedValue(makePage([updated]));

    await user.click(screen.getByRole("button", { name: "Edit" }));

    const brandInput = screen.getByDisplayValue("SafeHands");
    await user.clear(brandInput);
    await user.type(brandInput, "NewBrand");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateMasterProduct).toHaveBeenCalledWith(
        gloves.id,
        expect.objectContaining({ brand: "NewBrand" }),
      );
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Archive / reactivate ─────────────────────────────────────────────────────

  it("opens a confirmation dialog when Archive is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Archive Master Product")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, Archive" })).toBeInTheDocument();
  });

  it("archives a product and refreshes the list on confirm", async () => {
    const user = userEvent.setup();
    const archived: MasterProduct = { ...gloves, status: "archived", isActive: false };
    mockArchiveMasterProduct.mockResolvedValue(archived);

    renderPage();
    await screen.findByText("Nitrile Examination Gloves (Medium)");
    mockListMasterProducts.mockResolvedValue(makePage([archived]));

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Yes, Archive" }));

    await waitFor(() => {
      expect(mockArchiveMasterProduct).toHaveBeenCalledWith(gloves.id);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows Reactivate button for archived products and calls the API on confirm", async () => {
    const user = userEvent.setup();
    mockListMasterProducts.mockResolvedValue(makePage([suctionTips], { total: 1 }));
    const reactivated: MasterProduct = { ...suctionTips, status: "active", isActive: true };
    mockReactivateMasterProduct.mockResolvedValue(reactivated);

    renderPage();
    await screen.findByText("Surgical Suction Tips");
    mockListMasterProducts.mockResolvedValue(makePage([reactivated], { total: 1 }));

    await user.click(screen.getByRole("button", { name: "Reactivate" }));
    expect(screen.getByText("Reactivate Master Product")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, Reactivate" }));

    await waitFor(() => {
      expect(mockReactivateMasterProduct).toHaveBeenCalledWith(suctionTips.id);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses the confirmation dialog without calling the API when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Nitrile Examination Gloves (Medium)");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockArchiveMasterProduct).not.toHaveBeenCalled();
  });
});
