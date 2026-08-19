import { jest } from "@jest/globals";

import { createInMemoryCatalogRepository } from "../src/repositories/catalogRepository.js";
import { createInMemorySupplierCatalogueRepository } from "../src/repositories/supplierCatalogueRepository.js";
import {
  createProductCandidateDiscoveryService,
  deriveReviewCandidateProfile,
} from "../src/services/productCandidateDiscoveryService.js";
import { createProductMatchingService } from "../src/services/productMatchingService.js";

const SUPPLIER_A = "aaaaaaa1-aaaa-4000-8000-000000000001";
const SUPPLIER_B = "bbbbbbbb-bbbb-4000-8000-000000000001";

function productInput(sku: string, name: string) {
  return {
    sku,
    name,
    description: null,
    category: "PPE",
    stockUnit: "box",
    receivingUnit: "box",
    unitsPerReceivingUnit: 1,
    defaultUnitCostCents: 1000,
  };
}

async function buildGloveFixture() {
  const catalog = createInMemoryCatalogRepository();
  const supplierCatalogue = createInMemorySupplierCatalogueRepository();
  const names = [
    "Nitrile Gloves Black M 100pk",
    "Nitrile Gloves Blue M 100pk",
    "Nitrile Gloves Blue S 100pk",
    "Nitrile Gloves Blue L 100pk",
    "Nitrile Gloves Blue XL 100pk",
    "Nitrile Gloves Blue XS 100pk",
    "Nitrile Gloves Blue M 200pk",
  ];
  const products = await Promise.all(
    names.map((name, index) =>
      catalog.createMasterItem(productInput(`NITRILE-${String(index + 1)}`, name)),
    ),
  );
  const service = createProductCandidateDiscoveryService(catalog, supplierCatalogue);
  return { catalog, supplierCatalogue, service, products };
}

const EEDMGM_INPUT = {
  supplierId: SUPPLIER_A,
  supplierSku: "EEDMGM",
  supplierDescription: "Erskine Everyday Dental Nitrile Glove Medium,100pk",
};

describe("human-assisted product candidate discovery", () => {
  test.each(["Etch", "Bond", "Composite", "Cement"])(
    "discovers the exact single-term %s family",
    async (family) => {
      const catalog = createInMemoryCatalogRepository();
      const product = await catalog.createMasterItem(
        productInput(`SINGLE-${family.toUpperCase()}`, family),
      );
      const service = createProductCandidateDiscoveryService(catalog);

      const result = await service.discoverReviewCandidates({
        supplierId: SUPPLIER_A,
        supplierDescription: family,
      });

      expect(result.candidates.map((candidate) => candidate.masterProductId)).toContain(product.id);
      expect(result.selectionRequired).toBe(true);
    },
  );

  test.each([
    ["Bib", "Bibs"],
    ["Wipe", "Wipes"],
    ["Mask", "Masks"],
    ["Cup", "Cups"],
    ["Glove", "Gloves"],
  ])(
    "discovers conservative singular/plural family equivalents: %s/%s",
    async (singular, plural) => {
      const catalog = createInMemoryCatalogRepository();
      const product = await catalog.createMasterItem(
        productInput(`PLURAL-${singular.toUpperCase()}`, plural),
      );
      const service = createProductCandidateDiscoveryService(catalog);

      const result = await service.discoverReviewCandidates({
        supplierId: SUPPLIER_A,
        supplierDescription: singular,
      });

      expect(result.candidates.map((candidate) => candidate.masterProductId)).toContain(product.id);
    },
  );

  test("does not return an unrelated single-term family", async () => {
    const catalog = createInMemoryCatalogRepository();
    const bond = await catalog.createMasterItem(productInput("SINGLE-BOND", "Bond"));
    const service = createProductCandidateDiscoveryService(catalog);

    const result = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_A,
      supplierDescription: "Etch",
    });

    expect(result.candidates.map((candidate) => candidate.masterProductId)).not.toContain(bond.id);
  });

  test("keeps conservative protections for singular words ending in s", () => {
    expect(deriveReviewCandidateProfile("Glass").familyTokens).toEqual(["glass"]);
    expect(deriveReviewCandidateProfile("Floss").familyTokens).toEqual(["floss"]);
    expect(deriveReviewCandidateProfile("Forceps").familyTokens).toEqual(["forceps"]);
    expect(deriveReviewCandidateProfile("Lens").familyTokens).toEqual(["lens"]);
    expect(deriveReviewCandidateProfile("Status").familyTokens).toEqual(["status"]);
    expect(deriveReviewCandidateProfile("Basis").familyTokens).toEqual(["basis"]);
  });

  test("single-term family discovery retains explicit size conflict filtering", async () => {
    const catalog = createInMemoryCatalogRepository();
    const smallMask = await catalog.createMasterItem(
      productInput("MASK-S", "Masks Blue Small 100pk"),
    );
    const service = createProductCandidateDiscoveryService(catalog);

    const result = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_A,
      supplierDescription: "Mask Blue Medium 100pk",
    });

    expect(result.candidates.map((candidate) => candidate.masterProductId)).not.toContain(
      smallMask.id,
    );
  });

  test("single-term family discovery retains explicit pack conflict filtering", async () => {
    const catalog = createInMemoryCatalogRepository();
    const twoHundredPack = await catalog.createMasterItem(
      productInput("WIPES-200", "Wipes Blue 200pk"),
    );
    const service = createProductCandidateDiscoveryService(catalog);

    const result = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_A,
      supplierDescription: "Wipe Blue 100pk",
    });

    expect(result.candidates.map((candidate) => candidate.masterProductId)).not.toContain(
      twoHundredPack.id,
    );
  });

  test("single-term family discovery retains explicit colour conflict filtering", async () => {
    const catalog = createInMemoryCatalogRepository();
    const blackCups = await catalog.createMasterItem(
      productInput("CUPS-BLACK", "Cups Black 100pk"),
    );
    const service = createProductCandidateDiscoveryService(catalog);

    const result = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_A,
      supplierDescription: "Cup Blue 100pk",
    });

    expect(result.candidates.map((candidate) => candidate.masterProductId)).not.toContain(
      blackCups.id,
    );
  });

  test("missing source attributes remain neutral for a single-term family", async () => {
    const catalog = createInMemoryCatalogRepository();
    const blueMasks = await catalog.createMasterItem(
      productInput("MASKS-BLUE", "Masks Blue Medium 100pk"),
    );
    const service = createProductCandidateDiscoveryService(catalog);

    const result = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_A,
      supplierDescription: "Mask",
    });

    expect(result.candidates.map((candidate) => candidate.masterProductId)).toContain(blueMasks.id);
    expect(result.unresolvedAttributes.map((attribute) => attribute.attribute)).toEqual(
      expect.arrayContaining(["size", "pack_count", "colour"]),
    );
  });

  test("protected 0, 00 and 000 variants remain distinct during discovery", async () => {
    const catalog = createInMemoryCatalogRepository();
    const zero = await catalog.createMasterItem(productInput("SUTURE-0", "Suture (0) Purple"));
    const doubleZero = await catalog.createMasterItem(
      productInput("SUTURE-00", "Suture (00) Purple"),
    );
    const tripleZero = await catalog.createMasterItem(
      productInput("SUTURE-000", "Suture (000) Purple"),
    );
    const service = createProductCandidateDiscoveryService(catalog);

    const result = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_A,
      supplierDescription: "Suture (0) Purple",
    });
    const ids = result.candidates.map((candidate) => candidate.masterProductId);

    expect(ids).toContain(zero.id);
    expect(ids).not.toContain(doubleZero.id);
    expect(ids).not.toContain(tripleZero.id);
  });

  test("returns both compatible Medium 100pk Nitrile Glove colour variants", async () => {
    const { service } = await buildGloveFixture();

    const result = await service.discoverReviewCandidates(EEDMGM_INPUT);

    expect(result.candidates.map((candidate) => candidate.displayName)).toEqual([
      "Nitrile Gloves Black M 100pk",
      "Nitrile Gloves Blue M 100pk",
    ]);
    expect(result.matchedAttributes).toEqual([
      { attribute: "size", label: "Size", value: "Medium" },
      { attribute: "pack_count", label: "Pack", value: "100pk" },
    ]);
    expect(result.selectionRequired).toBe(true);
  });

  test("excludes explicitly conflicting S, L, XL and XS variants", async () => {
    const { service } = await buildGloveFixture();

    const result = await service.discoverReviewCandidates(EEDMGM_INPUT);

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.displayName.includes(" M "))).toBe(
      true,
    );
  });

  test("reports missing source colour as unresolved without eliminating Black or Blue", async () => {
    const { service } = await buildGloveFixture();

    const result = await service.discoverReviewCandidates(EEDMGM_INPUT);

    expect(result.candidates.map((candidate) => candidate.displayName)).toEqual(
      expect.arrayContaining([
        "Nitrile Gloves Black M 100pk",
        "Nitrile Gloves Blue M 100pk",
      ]),
    );
    expect(result.unresolvedAttributes).toContainEqual({
      attribute: "colour",
      label: "Colour",
      message: "Colour was not provided by the supplier. Choose the correct variant.",
    });
  });

  test("explicit Blue excludes an explicitly Black candidate", async () => {
    const { service } = await buildGloveFixture();

    const result = await service.discoverReviewCandidates({
      ...EEDMGM_INPUT,
      supplierDescription: "Erskine Nitrile Glove Blue Medium 100pk",
    });

    expect(result.candidates.map((candidate) => candidate.displayName)).toEqual([
      "Nitrile Gloves Blue M 100pk",
    ]);
  });

  test("excludes an explicit pack-count mismatch", async () => {
    const { service } = await buildGloveFixture();

    const result = await service.discoverReviewCandidates(EEDMGM_INPUT);

    expect(result.candidates.some((candidate) => candidate.displayName.includes("200pk"))).toBe(
      false,
    );
  });

  test("uses conservative glove/gloves family equivalence", () => {
    const source = deriveReviewCandidateProfile("Nitrile Glove Medium 100pk");
    const candidate = deriveReviewCandidateProfile("Nitrile Gloves Black M 100pk");

    expect(source.familyTokens).toContain("glove");
    expect(candidate.familyTokens).toContain("glove");
    expect(deriveReviewCandidateProfile("Safety Glass M 100pk").familyTokens).toContain("glass");
  });

  test("uses contextual Medium/M size equivalence", () => {
    expect(deriveReviewCandidateProfile("Nitrile Glove Medium 100pk").size).toBe("medium");
    expect(deriveReviewCandidateProfile("Nitrile Gloves Black M 100pk").size).toBe("medium");
  });

  test("does not interpret an uncontextualised single letter as a size", () => {
    expect(deriveReviewCandidateProfile("Dental M Instrument").size).toBeNull();
    expect(deriveReviewCandidateProfile("Model S Handpiece").size).toBeNull();
  });

  test("preserves 0, 00 and 000 as distinct protected variant tokens", () => {
    expect(deriveReviewCandidateProfile("Suture (0) Purple").protectedVariantTokens).toEqual([
      "0",
    ]);
    expect(deriveReviewCandidateProfile("Suture (00) Purple").protectedVariantTokens).toEqual([
      "00",
    ]);
    expect(deriveReviewCandidateProfile("Suture (000) Purple").protectedVariantTokens).toEqual([
      "000",
    ]);
  });

  test("excludes archived Master Products", async () => {
    const { catalog, service, products } = await buildGloveFixture();
    const blueMedium = products.find((product) => product.name === "Nitrile Gloves Blue M 100pk");
    expect(blueMedium).toBeDefined();
    if (!blueMedium) throw new Error("Expected Blue Medium fixture product");
    await catalog.updateMasterItem(blueMedium.id, { status: "archived" });

    const result = await service.discoverReviewCandidates(EEDMGM_INPUT);

    expect(result.candidates.map((candidate) => candidate.displayName)).toEqual([
      "Nitrile Gloves Black M 100pk",
    ]);
  });

  test("keeps same-SKU supplier mappings isolated", async () => {
    const catalog = createInMemoryCatalogRepository();
    const supplierCatalogue = createInMemorySupplierCatalogueRepository();
    const black = await catalog.createMasterItem(
      productInput("NITRILE-BLACK", "Nitrile Gloves Black M 100pk"),
    );
    const blue = await catalog.createMasterItem(
      productInput("NITRILE-BLUE", "Nitrile Gloves Blue M 100pk"),
    );
    await supplierCatalogue.upsertSupplierProduct({
      supplierId: SUPPLIER_A,
      productId: black.id,
      supplierSku: "SHARED",
      supplierDescription: black.name,
      unitCostCents: 1000,
    });
    await supplierCatalogue.upsertSupplierProduct({
      supplierId: SUPPLIER_B,
      productId: blue.id,
      supplierSku: "SHARED",
      supplierDescription: blue.name,
      unitCostCents: 1000,
    });
    const service = createProductCandidateDiscoveryService(catalog, supplierCatalogue);

    const resultA = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_A,
      supplierSku: "SHARED",
      supplierDescription: black.name,
    });
    const resultB = await service.discoverReviewCandidates({
      supplierId: SUPPLIER_B,
      supplierSku: "SHARED",
      supplierDescription: blue.name,
    });

    expect(resultA.candidates[0]?.masterProductId).toBe(black.id);
    expect(resultB.candidates[0]?.masterProductId).toBe(blue.id);
  });

  test("performs no persistence during discovery", async () => {
    const { service, supplierCatalogue } = await buildGloveFixture();
    const upsert = jest.spyOn(supplierCatalogue, "upsertSupplierProduct");
    const create = jest.spyOn(supplierCatalogue, "createSupplierProduct");
    const update = jest.spyOn(supplierCatalogue, "updateSupplierProduct");

    await service.discoverReviewCandidates(EEDMGM_INPUT);

    expect(upsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("candidate relevance cannot become automatic identity confidence", async () => {
    const { service } = await buildGloveFixture();

    const result = await service.discoverReviewCandidates(EEDMGM_INPUT);

    expect(result.candidates[0]).toHaveProperty("relevanceScore");
    expect(result.candidates[0]).not.toHaveProperty("confidence");
    expect(result.selectionRequired).toBe(true);
  });

  test("leaves strict matchProduct behaviour unchanged", async () => {
    const { catalog, supplierCatalogue, service } = await buildGloveFixture();
    const strictService = createProductMatchingService(catalog, supplierCatalogue);

    const beforeHumanReview = await strictService.matchProduct({
      supplierId: SUPPLIER_A,
      supplierSku: "EEDMGM",
      description: EEDMGM_INPUT.supplierDescription,
    });
    const candidates = await service.discoverReviewCandidates(EEDMGM_INPUT);
    const afterHumanReview = await strictService.matchProduct({
      supplierId: SUPPLIER_A,
      supplierSku: "EEDMGM",
      description: EEDMGM_INPUT.supplierDescription,
    });

    expect(candidates.candidates).toHaveLength(2);
    expect(beforeHumanReview).toEqual(afterHumanReview);
    expect(afterHumanReview.matchStatus).toBe("unmatched");
    expect(afterHumanReview.productId).toBeNull();
  });
});
