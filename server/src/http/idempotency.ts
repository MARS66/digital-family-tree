import { createHash } from "node:crypto";

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onSendHookHandler,
} from "fastify";

import { ApiError } from "./errors.js";

interface StoredResponse {
  fingerprint: string;
  state: "pending" | "completed";
  statusCode?: number;
  contentType?: string;
  payload?: string;
  expiresAt: number;
}

export interface IdempotencyStore {
  get(key: string): StoredResponse | undefined;
  set(key: string, value: StoredResponse): void;
  delete(key: string): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, StoredResponse>();

  get(key: string): StoredResponse | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: StoredResponse): void {
    this.entries.set(key, value);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}

interface Reservation {
  fingerprint: string;
  storageKey: string;
}

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function fingerprint(request: FastifyRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        body: canonicalize(request.body),
        method: request.method,
        url: request.url,
      }),
    )
    .digest("hex");
}

function authenticationScope(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization) return "anonymous";
  return createHash("sha256").update(authorization).digest("hex");
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || !keyPattern.test(value)) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "写请求必须提供有效的 Idempotency-Key",
      { minLength: 8, maxLength: 128 },
    );
  }
  return value;
}

function replay(reply: FastifyReply, stored: StoredResponse): FastifyReply {
  if (stored.contentType) reply.header("content-type", stored.contentType);
  reply.header("idempotency-replayed", "true");
  return reply.code(stored.statusCode ?? 200).send(stored.payload ?? "");
}

function serializePayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  return JSON.stringify(payload);
}

export function registerIdempotency(
  app: FastifyInstance,
  store: IdempotencyStore = new InMemoryIdempotencyStore(),
  ttlMs = 24 * 60 * 60 * 1000,
): void {
  const reservations = new WeakMap<FastifyRequest, Reservation>();

  app.addHook("preHandler", async (request, reply) => {
    if (!mutationMethods.has(request.method)) return;

    const key = idempotencyKey(request);
    const requestFingerprint = fingerprint(request);
    const storageKey = `${authenticationScope(request)}:${request.method}:${request.routeOptions.url}:${key}`;
    const stored = store.get(storageKey);

    if (stored) {
      if (stored.fingerprint !== requestFingerprint) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_CONFLICT",
          "该 Idempotency-Key 已用于不同请求",
        );
      }
      if (stored.state === "pending") {
        throw new ApiError(
          409,
          "IDEMPOTENCY_REQUEST_IN_PROGRESS",
          "相同请求仍在处理中",
        );
      }
      return replay(reply, stored);
    }

    store.set(storageKey, {
      fingerprint: requestFingerprint,
      state: "pending",
      expiresAt: Date.now() + ttlMs,
    });
    reservations.set(request, {
      fingerprint: requestFingerprint,
      storageKey,
    });
  });

  const onSend: onSendHookHandler = (request, reply, payload, done) => {
    const reservation = reservations.get(request);
    if (!reservation) return done(null, payload);

    if (reply.statusCode >= 500) {
      store.delete(reservation.storageKey);
      return done(null, payload);
    }

    store.set(reservation.storageKey, {
      fingerprint: reservation.fingerprint,
      state: "completed",
      statusCode: reply.statusCode,
      ...(reply.getHeader("content-type") === undefined
        ? {}
        : { contentType: reply.getHeader("content-type")!.toString() }),
      payload: serializePayload(payload),
      expiresAt: Date.now() + ttlMs,
    });
    return done(null, payload);
  };

  app.addHook("onSend", onSend);
}
