import request from "supertest";

import { SEED_CLINIC_A_ID } from "../src/repositories/userRepository.js";
import { loginAndGetAccessToken } from "./helpers/auth.js";
import { createTestApp } from "./helpers/testApp.js";

const PO_ID = "10000000-0000-4000-8000-000000000001";
const PO_LINE_A = "10000000-0000-4000-8000-000000000002";
const PO_LINE_B = "10000000-0000-4000-8000-000000000003";
const INVOICE_ID = "20000000-0000-4000-8000-000000000001";
const INVOICE_LINE_A = "20000000-0000-4000-8000-000000000002";
const INVOICE_LINE_B = "20000000-0000-4000-8000-000000000003";
const FOREIGN_LINE_ID = "30000000-0000-4000-8000-000000000001";

describe("record-derived collection validation", () => {
  it("rejects duplicate, excessive, and foreign PO receiving line IDs before mutation", async () => {
    let receiveCalled = false;
    const app = await createTestApp({
      configureDependencies: (deps) => {
        deps.purchaseOrderService = {
          ...deps.purchaseOrderService,
          getPurchaseOrderLineIds: () =>
            Promise.resolve(new Set([PO_LINE_A, PO_LINE_B])),
          receivePurchaseOrder: () => {
            receiveCalled = true;
            return Promise.reject(new Error("receivePurchaseOrder must not be called"));
          },
        };
      },
    });
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const url = `/api/v1/clinics/${SEED_CLINIC_A_ID}/purchase-orders/${PO_ID}/receive`;

    const duplicate = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          { poLineId: PO_LINE_A, quantityDelta: 1 },
          { poLineId: PO_LINE_A, quantityDelta: 1 },
        ],
      });
    expect(duplicate.status).toBe(400);

    const excessive = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          { poLineId: PO_LINE_A, quantityDelta: 1 },
          { poLineId: PO_LINE_B, quantityDelta: 1 },
          { poLineId: FOREIGN_LINE_ID, quantityDelta: 1 },
        ],
      });
    expect(excessive.status).toBe(400);

    const foreign = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ poLineId: FOREIGN_LINE_ID, quantityDelta: 1 }] });
    expect(foreign.status).toBe(400);
    expect(receiveCalled).toBe(false);
  });

  it("rejects duplicate, overlapping, and foreign supplier-invoice confirmation IDs", async () => {
    let confirmCalled = false;
    const app = await createTestApp({
      configureDependencies: (deps) => {
        deps.supplierInvoiceService = {
          ...deps.supplierInvoiceService,
          getInvoice: () =>
            Promise.resolve({
              invoice: {} as never,
              lines: [
                { id: INVOICE_LINE_A } as never,
                { id: INVOICE_LINE_B } as never,
              ],
            }),
          confirmImport: () => {
            confirmCalled = true;
            return Promise.reject(new Error("confirmImport must not be called"));
          },
        };
      },
    });
    const token = await loginAndGetAccessToken(app, "manager@clinic-a.au");
    const url = `/api/v1/clinics/${SEED_CLINIC_A_ID}/supplier-invoices/${INVOICE_ID}/confirm`;

    const duplicate = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({ readyToCreateLineIds: [INVOICE_LINE_A, INVOICE_LINE_A] });
    expect(duplicate.status).toBe(400);

    const overlap = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        readyToCreateLineIds: [INVOICE_LINE_A],
        skippedLineIds: [INVOICE_LINE_A],
      });
    expect(overlap.status).toBe(400);

    const foreign = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({ skippedLineIds: [FOREIGN_LINE_ID] });
    expect(foreign.status).toBe(400);

    const excessive = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({
        skippedLineIds: [INVOICE_LINE_A, INVOICE_LINE_B, FOREIGN_LINE_ID],
      });
    expect(excessive.status).toBe(400);
    expect(confirmCalled).toBe(false);
  });
});
