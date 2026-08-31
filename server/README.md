# 后端服务

## 启动

```bash
npm run dev:server
```

服务默认监听 `127.0.0.1:3000`，可通过 `.env` 中的 `HOST` 和 `PORT` 调整。

- 健康检查：`GET /health`
- OpenAPI：`GET /openapi.json`

## 微信登录

- `POST /api/v1/auth/wechat/login`：交换微信临时 code，并创建或复用 User。
- `POST /api/v1/auth/refresh`：撤销旧会话并轮换 access/refresh token。
- `POST /api/v1/auth/logout`：使用 Bearer access token 撤销当前会话。
- 开发环境默认使用 fake provider，code 格式为 `dev_` 加至少 4 个字母、数字、下划线或连字符。
- 生产环境必须设置 `WECHAT_LOGIN_PROVIDER=wechat`、`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`；生产模式禁止 fake provider。
- token 仅在创建时返回明文，数据库只保存 SHA-256 哈希。

## API 基础协议

- 成功响应：`{ "data": ..., "meta"?: ... }`
- 错误响应：`{ "error": { "code", "message", "details"?, "traceId" } }`
- 每个响应包含 `X-Trace-Id`，由服务端生成 UUID。
- `POST`、`PUT`、`PATCH`、`DELETE` 必须提供 8–128 字符的 `Idempotency-Key`。
- 所有输入使用路由 JSON Schema 校验；错误由统一处理器转换，不返回内部异常消息。

## 幂等限制

当前 `InMemoryIdempotencyStore` 是 T003 骨架：相同 key 和相同请求会重放首次响应；相同 key 用于不同请求返回 409；并发中的相同请求返回明确冲突。它只适合开发和单实例验证，多实例或生产部署前必须替换为持久共享存储。
