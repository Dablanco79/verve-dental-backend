export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}
