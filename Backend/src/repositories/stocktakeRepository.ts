import { randomUUID } from "node:crypto";

import type {
  CreateStocktakeSessionInput,
  StocktakeLine,
  StocktakeLineView,
  StocktakeSession,
  StocktakeSessionView,
  StocktakeSessionsPage,
  StocktakeStatus,
  UpdateStocktakeLineInput,
  UpdateStocktakeSessionInput,
} from "../types/stocktake.js";

// ── Repository interface ──────────────────────────────────────────────────────

/**
 * Create-line input omits fields that are assigned by the repository:
 *  - id, variance, createdAt, updatedAt  (server-generated)
 *  - primaryBarcode  (the Postgres repo looks this up from barcode_mappings;
 *                     the in-memory repo sets it to null)
 */
export type CreateStocktakeLineInput = Omit<
  StocktakeLine,
  "id" | "variance" | "createdAt" | "updatedAt" | "primaryBarcode"
>;

export interface StocktakeRepository {
  createSession(
    input: CreateStocktakeSessionInput,
  ): Promise<StocktakeSession>;

  findSessionById(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeSession | null>;

  listSessions(
    clinicId: string,
    options?: { limit?: number; offset?: number; status?: StocktakeStatus },
  ): Promise<StocktakeSessionsPage>;

  updateSession(
    clinicId: string,
    sessionId: string,
    input: UpdateStocktakeSessionInput,
  ): Promise<StocktakeSession | null>;

  updateSessionStatus(
    clinicId: string,
    sessionId: string,
    status: StocktakeStatus,
    actor: {
      field: "started" | "completed" | "cancelled";
      userId: string;
      email: string;
      timestamp: Date;
    },
  ): Promise<StocktakeSession | null>;

  /** Bulk-create lines from current inventory snapshot. */
  createLines(
    lines: CreateStocktakeLineInput[],
  ): Promise<StocktakeLine[]>;

  listLines(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeLineView[]>;

  findLineById(
    clinicId: string,
    lineId: string,
  ): Promise<StocktakeLine | null>;

  updateLine(
    clinicId: string,
    lineId: string,
    input: UpdateStocktakeLineInput,
  ): Promise<StocktakeLine | null>;

  /** Returns lines that have a non-zero variance for completion processing. */
  listVarianceLines(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeLineView[]>;
}

// ── In-memory implementation ──────────────────────────────────────────────────

export function createInMemoryStocktakeRepository(): StocktakeRepository {
  const sessions: StocktakeSession[] = [];
  const lines: StocktakeLine[] = [];

  function computeVariance(line: StocktakeLine): number | null {
    if (line.countedQuantity === null) return null;
    return line.countedQuantity - line.expectedQuantity;
  }

  function toLineView(line: StocktakeLine): StocktakeLineView {
    const variance = computeVariance(line);
    return {
      ...line,
      variance,
      masterSku: "UNKNOWN",
      varianceValueCents:
        variance !== null ? variance * line.unitCostCents : null,
    };
  }

  function toSessionView(session: StocktakeSession): StocktakeSessionView {
    const sessionLines = lines.filter((l) => l.sessionId === session.id);
    const totalLines = sessionLines.length;
    const countedLines = sessionLines.filter(
      (l) => l.countedQuantity !== null,
    ).length;
    return { ...session, totalLines, countedLines };
  }

  return {
    createSession(input: CreateStocktakeSessionInput): Promise<StocktakeSession> {
      const now = new Date();
      const session: StocktakeSession = {
        id: randomUUID(),
        clinicId: input.clinicId,
        name: input.name,
        status: "draft",
        createdByUserId: input.createdByUserId,
        createdByEmail: input.createdByEmail,
        startedByUserId: null,
        startedByEmail: null,
        completedByUserId: null,
        completedByEmail: null,
        cancelledByUserId: null,
        cancelledByEmail: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      };
      sessions.push(session);
      return Promise.resolve({ ...session });
    },

    findSessionById(clinicId: string, sessionId: string): Promise<StocktakeSession | null> {
      const s = sessions.find(
        (x) => x.clinicId === clinicId && x.id === sessionId,
      );
      return Promise.resolve(s ? { ...s } : null);
    },

    listSessions(
      clinicId: string,
      options?: { limit?: number; offset?: number; status?: StocktakeStatus },
    ): Promise<StocktakeSessionsPage> {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const filtered = sessions
        .filter(
          (s) =>
            s.clinicId === clinicId &&
            (!options?.status || s.status === options.status),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const total = filtered.length;
      const page = filtered
        .slice(offset, offset + limit)
        .map((s) => toSessionView(s));
      return Promise.resolve({ items: page, total, limit, offset });
    },

    updateSession(
      clinicId: string,
      sessionId: string,
      input: UpdateStocktakeSessionInput,
    ): Promise<StocktakeSession | null> {
      const idx = sessions.findIndex(
        (s) => s.clinicId === clinicId && s.id === sessionId,
      );
      if (idx === -1) return Promise.resolve(null);
      const existing = sessions[idx];
      if (!existing) return Promise.resolve(null);
      const updated: StocktakeSession = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name } : {}),
        updatedAt: new Date(),
      };
      sessions[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    updateSessionStatus(
      clinicId: string,
      sessionId: string,
      status: StocktakeStatus,
      actor: {
        field: "started" | "completed" | "cancelled";
        userId: string;
        email: string;
        timestamp: Date;
      },
    ): Promise<StocktakeSession | null> {
      const idx = sessions.findIndex(
        (s) => s.clinicId === clinicId && s.id === sessionId,
      );
      if (idx === -1) return Promise.resolve(null);
      const existing = sessions[idx];
      if (!existing) return Promise.resolve(null);
      const patch: Partial<StocktakeSession> = { status, updatedAt: new Date() };
      if (actor.field === "started") {
        patch.startedByUserId = actor.userId;
        patch.startedByEmail = actor.email;
        patch.startedAt = actor.timestamp;
      } else if (actor.field === "completed") {
        patch.completedByUserId = actor.userId;
        patch.completedByEmail = actor.email;
        patch.completedAt = actor.timestamp;
      } else {
        patch.cancelledByUserId = actor.userId;
        patch.cancelledByEmail = actor.email;
        patch.cancelledAt = actor.timestamp;
      }
      const updated: StocktakeSession = { ...existing, ...patch };
      sessions[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    createLines(inputs: CreateStocktakeLineInput[]): Promise<StocktakeLine[]> {
      const now = new Date();
      const created: StocktakeLine[] = inputs.map((input) => ({
        ...input,
        // primaryBarcode is set to null in the in-memory repo (no barcode lookup).
        primaryBarcode: null,
        id: randomUUID(),
        variance:
          input.countedQuantity !== null
            ? input.countedQuantity - input.expectedQuantity
            : null,
        createdAt: now,
        updatedAt: now,
      }));
      lines.push(...created);
      return Promise.resolve(created.map((l) => ({ ...l })));
    },

    listLines(clinicId: string, sessionId: string): Promise<StocktakeLineView[]> {
      return Promise.resolve(
        lines
          .filter((l) => l.clinicId === clinicId && l.sessionId === sessionId)
          .map((l) => toLineView(l)),
      );
    },

    findLineById(clinicId: string, lineId: string): Promise<StocktakeLine | null> {
      const l = lines.find((x) => x.clinicId === clinicId && x.id === lineId);
      return Promise.resolve(l ? { ...l } : null);
    },

    updateLine(
      clinicId: string,
      lineId: string,
      input: UpdateStocktakeLineInput,
    ): Promise<StocktakeLine | null> {
      const idx = lines.findIndex(
        (l) => l.clinicId === clinicId && l.id === lineId,
      );
      if (idx === -1) return Promise.resolve(null);
      const existing = lines[idx];
      if (!existing) return Promise.resolve(null);
      const updated: StocktakeLine = {
        ...existing,
        countedQuantity: input.countedQuantity,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        variance:
          input.countedQuantity !== null
            ? input.countedQuantity - existing.expectedQuantity
            : null,
        updatedAt: new Date(),
      };
      lines[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    listVarianceLines(clinicId: string, sessionId: string): Promise<StocktakeLineView[]> {
      return Promise.resolve(
        lines
          .filter(
            (l) =>
              l.clinicId === clinicId &&
              l.sessionId === sessionId &&
              l.countedQuantity !== null &&
              l.countedQuantity !== l.expectedQuantity,
          )
          .map((l) => toLineView(l)),
      );
    },
  };
}
