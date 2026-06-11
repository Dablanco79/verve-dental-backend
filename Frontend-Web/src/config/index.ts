export type AppConfig = {
  apiBaseUrl: string;
};

export function loadConfig(): AppConfig {
  return {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  };
}
