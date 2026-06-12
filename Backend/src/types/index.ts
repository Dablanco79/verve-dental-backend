export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export { AppError } from "./errors.js";
