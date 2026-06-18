import IORedis from "ioredis";

import type { EnvConfig } from "../config/index.js";

/**
 * Narrowed pipeline type — only the commands used by the refresh-token store.
 * All command methods return the pipeline itself for chaining; call exec() to flush.
 */
type RedisPipeline = {
  set(key: string, value: string, expiryMode: "EX", ttl: number): RedisPipeline;
  del(key: string): RedisPipeline;
  sadd(key: string, member: string): RedisPipeline;
  srem(key: string, member: string): RedisPipeline;
  expire(key: string, seconds: number): RedisPipeline;
  exec(): Promise<[Error | null, unknown][] | null>;
};

type IORedisInstance = {
  connect(): Promise<void>;
  quit(): Promise<string>;
  ping(): Promise<string>;
  /** Subset of the EventEmitter API — used to register the error guard. */
  on(event: "error", listener: (err: Error & { code?: string }) => void): IORedisInstance;

  // Standalone key–value commands.
  set(key: string, value: string, expiryMode: "EX", ttl: number): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;

  // Standalone set commands — smembers still used as a standalone read in revokeAllUserTokens.
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;

  // Pipeline — batches multiple commands into a single round-trip.
  pipeline(): RedisPipeline;
};

type IORedisConstructor = new (
  url: string,
  options?: {
    tls?: Record<string, never>;
    maxRetriesPerRequest?: number;
    lazyConnect?: boolean;
    connectTimeout?: number;
  },
) => IORedisInstance;

export type RedisClient = IORedisInstance;

const RedisClientCtor = IORedis as unknown as IORedisConstructor;

function shouldUseRedisTls(config: EnvConfig): boolean {
  if (!config.REDIS_URL) {
    return false;
  }

  if (config.REDIS_TLS === "true") {
    return true;
  }

  if (config.REDIS_TLS === "false") {
    return false;
  }

  return config.REDIS_URL.startsWith("rediss://");
}

/**
 * Creates a Redis client configured for cloud TLS (`rediss://`) when required.
 */
export function createRedisClient(config: EnvConfig): RedisClient | null {
  if (!config.REDIS_URL) {
    return null;
  }

  const useTls = shouldUseRedisTls(config);

  return new RedisClientCtor(config.REDIS_URL, {
    tls: useTls ? {} : undefined,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectTimeout: 10_000,
  });
}
