import type { DatabasePool } from "../db/pool.js";
import { AppError } from "../types/errors.js";
import type {
  CreatePayRateInput,
  EffectivePayRate,
  StaffPayRate,
} from "../types/payRate.js";
import type { StaffPayRateRepository } from "./staffPayRateRepository.js";

function toStaffPayRate(row: Record<string, unknown>): StaffPayRate {
  return {
    id: row.id as string,
    staffUserId: row.staff_user_id as string,
    baseHourlyRateCents: Number(row.base_hourly_rate_cents),
    employmentType: row.employment_type as StaffPayRate["employmentType"],
    contractedWeeklyHours:
      row.contracted_weekly_hours !== null && row.contracted_weekly_hours !== undefined
        ? Number(row.contracted_weekly_hours)
        : null,
    superRatePercent: Number(row.super_rate_percent),
    effectiveFrom: (row.effective_from as Date).toISOString().slice(0, 10),
    effectiveTo:
      row.effective_to != null
        ? (row.effective_to as Date).toISOString().slice(0, 10)
        : null,
    createdByUserId: row.created_by_user_id as string,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export function createPostgresStaffPayRateRepository(
  pool: DatabasePool,
): StaffPayRateRepository {
  return {
    async findEffectiveRate(staffUserId: string, date: string): Promise<EffectivePayRate | null> {
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT *
           FROM staff_pay_rates
          WHERE staff_user_id = $1
            AND effective_from <= $2
            AND (effective_to IS NULL OR effective_to > $2)
          ORDER BY effective_from DESC
          LIMIT 1`,
        [staffUserId, date],
      );
      if (!rows[0]) return null;
      return { ...toStaffPayRate(rows[0]), isConfigured: true as const };
    },

    async listByStaff(staffUserId: string): Promise<StaffPayRate[]> {
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT *
           FROM staff_pay_rates
          WHERE staff_user_id = $1
          ORDER BY effective_from DESC`,
        [staffUserId],
      );
      return rows.map(toStaffPayRate);
    },

    async createRate(input: CreatePayRateInput): Promise<StaffPayRate> {
      // Use a transaction to atomically close the previous open rate and insert the new one.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Lock and check for existing open rate.
        const { rows: openRows } = await client.query<Record<string, unknown>>(
          `SELECT * FROM staff_pay_rates WHERE staff_user_id = $1 AND effective_to IS NULL FOR UPDATE`,
          [input.staffUserId],
        );

        const openRate = openRows[0];
        if (openRate) {
          const existingEffectiveFrom = (openRate.effective_from as Date).toISOString().slice(0, 10);
          if (input.effectiveFrom <= existingEffectiveFrom) {
            await client.query("ROLLBACK");
            throw new AppError(
              409,
              "RATE_OVERLAP",
              "New rate's effective-from date must be after the existing active rate's effective-from date.",
            );
          }
          // Close the previous open rate.
          await client.query(
            `UPDATE staff_pay_rates
                SET effective_to = $1, updated_at = now()
              WHERE id = $2`,
            [input.effectiveFrom, openRate.id as string],
          );
        }

        // Insert the new rate.
        const { rows: newRows } = await client.query<Record<string, unknown>>(
          `INSERT INTO staff_pay_rates
             (staff_user_id, base_hourly_rate_cents, employment_type,
              contracted_weekly_hours, super_rate_percent,
              effective_from, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            input.staffUserId,
            input.baseHourlyRateCents,
            input.employmentType,
            input.contractedWeeklyHours ?? null,
            input.superRatePercent,
            input.effectiveFrom,
            input.createdByUserId,
          ],
        );

        await client.query("COMMIT");
        const row = newRows[0];
        if (!row) throw new Error("INSERT did not return a row");
        return toStaffPayRate(row);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
