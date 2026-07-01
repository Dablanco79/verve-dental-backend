export const STOCK_UNIT_OPTIONS = [
  "Unit",
  "Box",
  "Bottle",
  "Syringe",
  "Roll",
  "Pair",
  "Kit",
  "Tray",
  "Pack",
] as const;

export const RECEIVING_UNIT_OPTIONS = [
  "Box",
  "Carton",
  "Pack",
  "Case",
  "Pallet",
  "Bottle",
] as const;

export type StockUnitOption = (typeof STOCK_UNIT_OPTIONS)[number];
export type ReceivingUnitOption = (typeof RECEIVING_UNIT_OPTIONS)[number];
