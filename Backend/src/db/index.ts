/**
 * Database client layer.
 * PostgreSQL pool + RLS policies will be wired in Module 13 (Database Schema).
 * Auth services use an in-memory repository until the database layer is connected.
 */

export { createDatabasePool, resolvePostgresSsl } from "./pool.js";
export type { DatabasePool } from "./pool.js";

export interface DatabaseClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
