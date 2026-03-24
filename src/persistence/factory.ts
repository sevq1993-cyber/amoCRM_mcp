import { Pool } from "pg";
import { loadConfig } from "../config.js";
import type { AppStore } from "../types.js";
import { MemoryAppStore } from "./memory-store.js";
import { PostgresAppStore } from "./postgres-store.js";

export const createAppStore = async (): Promise<AppStore> => {
  const { env } = loadConfig();

  if (!env.POSTGRES_URL) {
    return new MemoryAppStore();
  }

  const pool = new Pool({
    connectionString: env.POSTGRES_URL,
  });

  return new PostgresAppStore(pool);
};
