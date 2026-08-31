/** Shared API contracts live here once T003 defines the protocol. */
export const CONTRACTS_PACKAGE_NAME = "@digital-family-tree/contracts";

export interface ApiSuccess<T, TMeta = never> {
  data: T;
  meta?: TMeta;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  traceId: string;
}

export interface ApiFailure {
  error: ApiErrorPayload;
}

export interface HealthData {
  status: "ok";
}
