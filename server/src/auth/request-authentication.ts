import type { FastifyRequest } from "fastify";

import { ApiError } from "../http/errors.js";
import type { AuthService, AuthUser } from "./service.js";

export function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "需要登录后访问");
  }
  const token = authorization.slice("Bearer ".length);
  if (!token) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "需要登录后访问");
  }
  return token;
}

export function authenticateRequest(
  request: FastifyRequest,
  authService: AuthService,
): Promise<AuthUser> {
  return authService.authenticate(bearerToken(request));
}
