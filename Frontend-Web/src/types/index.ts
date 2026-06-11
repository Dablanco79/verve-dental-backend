export type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

export type ApiError = {
  message: string;
  status?: number;
};
