import IORedis from "ioredis";

import type { EnvConfig } from "../config/index.js";

type IORedisConstructor = new (
  url: string,
  options?: {
    tls?: Record<string, never>;
    maxRetriesPerRequest?: number;
    lazyConnect?: boolean;
    connectTimeout?: number;
  },
) => {
  connect(): Promise<void>;
  quit(): Promise<string>;
};

export type RedisClient = InstanceType<IORedisConstructor>;

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
