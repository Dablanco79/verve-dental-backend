import { SEED_CLINIC_A_ID, SEED_CLINIC_B_ID } from "../userRepository.js";
import type {
  BarcodeFormat,
  BarcodeMapping,
  ClinicInventoryItem,
  MasterCatalogItem,
} from "../../types/inventory.js";

export const SEED_MASTER_CATALOG_IDS = {
  nitrileGloves: "d1111111-1111-4111-8111-111111111111",
  diamondBurs: "d2222222-2222-4222-8222-222222222222",
  compositeResin: "d3333333-3333-4333-8333-333333333333",
  salivaEjectors: "d4444444-4444-4444-8444-444444444444",
  faceMasks: "d5555555-5555-4555-8555-555555555555",
  // Sprint 4G — added for negotiated pricing seed data.
  matrixBands: "d6666666-6666-4666-8666-666666666666",
} as const;

export const SEED_BARCODE_IDS = {
  glovesEan13: "b1111111-1111-4111-8111-111111111111",
  glovesGs1: "b1111111-1111-4111-8111-111111111112",
  bursEan13: "b2222222-2222-4222-8222-222222222222",
  compositeQr: "b3333333-3333-4333-8333-333333333333",
  ejectorsCode128: "b4444444-4444-4444-8444-444444444444",
  masksDataMatrix: "b5555555-5555-4555-8555-555555555555",
} as const;

export const SEED_CLINIC_INVENTORY_IDS = {
  clinicAGloves: "e1111111-1111-4111-8111-111111111111",
  clinicABurs: "e1111111-1111-4111-8111-111111111112",
  clinicAComposite: "e1111111-1111-4111-8111-111111111113",
  clinicAEjectors: "e1111111-1111-4111-8111-111111111114",
  clinicAMasks: "e1111111-1111-4111-8111-111111111115",
  clinicBGloves: "e2222222-2222-4222-8222-222222222221",
  clinicBBurs: "e2222222-2222-4222-8222-222222222222",
  clinicBComposite: "e2222222-2222-4222-8222-222222222223",
  clinicBEjectors: "e2222222-2222-4222-8222-222222222224",
  clinicBMasks: "e2222222-2222-4222-8222-222222222225",
} as const;

const SEED_TIMESTAMP = new Date("2026-06-01T00:00:00.000Z");

export function buildMasterCatalogSeed(): MasterCatalogItem[] {
  return [
    {
      id: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      sku: "VRV-GLV-001",
      name: "Nitrile Examination Gloves (Box 100)",
      description: "Powder-free nitrile gloves, size M",
      category: "PPE",
      unitOfMeasure: "box",
      defaultUnitCostCents: 1899,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_MASTER_CATALOG_IDS.diamondBurs,
      sku: "VRV-BUR-001",
      name: "Diamond Burs FG Round #2 (Pack 5)",
      description: "High-speed diamond burs for crown prep",
      category: "Rotary",
      unitOfMeasure: "pack",
      defaultUnitCostCents: 4599,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_MASTER_CATALOG_IDS.compositeResin,
      sku: "VRV-CMP-001",
      name: "Universal Composite Resin A2 (4g syringe)",
      description: "Light-cure universal composite, shade A2",
      category: "Restorative",
      unitOfMeasure: "syringe",
      defaultUnitCostCents: 3299,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_MASTER_CATALOG_IDS.salivaEjectors,
      sku: "VRV-EJT-001",
      name: "Saliva Ejectors (Box 100)",
      description: "Disposable saliva ejectors, white",
      category: "Consumables",
      unitOfMeasure: "box",
      defaultUnitCostCents: 1299,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_MASTER_CATALOG_IDS.faceMasks,
      sku: "VRV-MSK-001",
      name: "Level 2 Surgical Masks (Box 50)",
      description: "ASTM Level 2 ear-loop surgical masks",
      category: "PPE",
      unitOfMeasure: "box",
      defaultUnitCostCents: 1599,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_MASTER_CATALOG_IDS.matrixBands,
      sku: "VRV-MTX-001",
      name: "Sectional Matrix Bands (Box 100)",
      description: "Stainless steel sectional matrix bands for Class II restorations",
      category: "Restorative",
      unitOfMeasure: "box",
      defaultUnitCostCents: 2799,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
  ];
}

export function buildBarcodeMappingSeed(): BarcodeMapping[] {
  const mappings: Array<{
    id: string;
    masterCatalogItemId: string;
    barcodeValue: string;
    barcodeFormat: BarcodeFormat;
    isPrimary: boolean;
  }> = [
    {
      id: SEED_BARCODE_IDS.glovesEan13,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      barcodeValue: "9301234567890",
      barcodeFormat: "ean13",
      isPrimary: true,
    },
    {
      id: SEED_BARCODE_IDS.glovesGs1,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      barcodeValue: "01093012345678901724123110",
      barcodeFormat: "gs1",
      isPrimary: false,
    },
    {
      id: SEED_BARCODE_IDS.bursEan13,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      barcodeValue: "9301234567891",
      barcodeFormat: "ean13",
      isPrimary: true,
    },
    {
      id: SEED_BARCODE_IDS.compositeQr,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.compositeResin,
      barcodeValue: "VRV-CMP-001",
      barcodeFormat: "qr",
      isPrimary: true,
    },
    {
      id: SEED_BARCODE_IDS.ejectorsCode128,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.salivaEjectors,
      barcodeValue: "VRVEJT001",
      barcodeFormat: "code128",
      isPrimary: true,
    },
    {
      id: SEED_BARCODE_IDS.masksDataMatrix,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.faceMasks,
      barcodeValue: "9301234567894",
      barcodeFormat: "data_matrix",
      isPrimary: true,
    },
  ];

  return mappings.map((mapping) => ({
    ...mapping,
    createdAt: SEED_TIMESTAMP,
  }));
}

export function buildClinicInventorySeed(): ClinicInventoryItem[] {
  return [
    // Clinic A — gloves below reorder point (3 on hand, reorder 5)
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicAGloves,
      clinicId: SEED_CLINIC_A_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      quantityOnHand: 3,
      reorderPoint: 5,
      unitCostOverrideCents: 1799,
      supplierPreference: "DentalCo AU",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicABurs,
      clinicId: SEED_CLINIC_A_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      quantityOnHand: 12,
      reorderPoint: 4,
      unitCostOverrideCents: null,
      supplierPreference: "BurDirect",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicAComposite,
      clinicId: SEED_CLINIC_A_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.compositeResin,
      quantityOnHand: 8,
      reorderPoint: 3,
      unitCostOverrideCents: 3199,
      supplierPreference: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicAEjectors,
      clinicId: SEED_CLINIC_A_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.salivaEjectors,
      quantityOnHand: 20,
      reorderPoint: 6,
      unitCostOverrideCents: null,
      supplierPreference: "DentalCo AU",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicAMasks,
      clinicId: SEED_CLINIC_A_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.faceMasks,
      quantityOnHand: 2,
      reorderPoint: 4,
      unitCostOverrideCents: null,
      supplierPreference: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    // Clinic B — different stock profile
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicBGloves,
      clinicId: SEED_CLINIC_B_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.nitrileGloves,
      quantityOnHand: 15,
      reorderPoint: 5,
      unitCostOverrideCents: null,
      supplierPreference: "MedSupply QLD",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicBBurs,
      clinicId: SEED_CLINIC_B_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.diamondBurs,
      quantityOnHand: 1,
      reorderPoint: 3,
      unitCostOverrideCents: 4499,
      supplierPreference: "BurDirect",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicBComposite,
      clinicId: SEED_CLINIC_B_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.compositeResin,
      quantityOnHand: 6,
      reorderPoint: 2,
      unitCostOverrideCents: null,
      supplierPreference: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicBEjectors,
      clinicId: SEED_CLINIC_B_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.salivaEjectors,
      quantityOnHand: 10,
      reorderPoint: 5,
      unitCostOverrideCents: null,
      supplierPreference: "MedSupply QLD",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: SEED_CLINIC_INVENTORY_IDS.clinicBMasks,
      clinicId: SEED_CLINIC_B_ID,
      masterCatalogItemId: SEED_MASTER_CATALOG_IDS.faceMasks,
      quantityOnHand: 7,
      reorderPoint: 4,
      unitCostOverrideCents: 1499,
      supplierPreference: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
  ];
}
