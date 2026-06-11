/**
 * Database client layer.
 * PostgreSQL + RLS policies will be wired in Module 02 (Security & Multi-Tenant).
 */

export interface DatabaseClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
