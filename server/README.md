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

## Family 与 Membership

- `POST /api/v1/families`：登录用户创建 Family，并在同一事务内成为 `OWNER/ACTIVE` 成员。
- `GET /api/v1/families/:familyId`：读取当前有效成员可见的 Family 摘要。
- 非成员与不可见 Family 统一返回 404，避免通过接口探测 Family 是否存在。
- 登录响应的 `families` 返回当前用户所有有效 Family Membership 摘要。
- T011 尚不包括 Person、邀请加入、角色变更、所有权移交或完整权限引擎。

## Person 基础

- `GET /api/v1/families/:familyId/persons/:personId`：读取当前有效成员可见、未软删除的人物。
- 日期使用 `{ value, precision }` 表达年、月或日；未知日期返回 `null`，不会使用假日期。
- Person 领域层提供带 Family 限定、管理员校验、版本冲突和软删除审计上下文的 CRUD。
- T012 不开放 Person 直写 HTTP API；创建由 T020 组合流程接入，修改和删除由 T030–T032 的贡献审核流程接入。

## 亲子关系

- 只存 `PARENT_OF` 直接事实；`GET /api/v1/families/:familyId/persons/:personId/relations` 双向返回父母和子女，并推导兄弟姐妹。
- 关系写入领域服务按 Family 加事务锁，阻止自环、重复、父母角色冲突和祖先循环；两端必须是同一 Family 的有效 Person。
- 兄弟姐妹分为 `FULL/HALF/UNKNOWN`，不会把资料缺失错误解释为半同胞。
- 存在活跃关系的 Person 不能软删除。T013 不开放绕过 Contribution/Review 的关系写 HTTP API。

## 伴侣关系

- PartnerUnion 按 UUID 规范化端点，A-B 与 B-A 是同一对称关系。
- 支持 `MARRIAGE/PARTNERSHIP/UNKNOWN`、可选起止日期、版本校验、软删除后重建及同 Family 数据库约束。
- 人物关系读取会从任一端点返回同一 PartnerUnion；伴侣关系不会自动生成任何亲子边。
- 存在活跃 PartnerUnion 的 Person 不能软删除。写 HTTP API 仍等待 Contribution/Review 接入。

## API 基础协议

- 成功响应：`{ "data": ..., "meta"?: ... }`
- 错误响应：`{ "error": { "code", "message", "details"?, "traceId" } }`
- 每个响应包含 `X-Trace-Id`，由服务端生成 UUID。
- `POST`、`PUT`、`PATCH`、`DELETE` 必须提供 8–128 字符的 `Idempotency-Key`。
- 所有输入使用路由 JSON Schema 校验；错误由统一处理器转换，不返回内部异常消息。

## 幂等限制

当前 `InMemoryIdempotencyStore` 是 T003 骨架：相同 key 和相同请求会重放首次响应；相同 key 用于不同请求返回 409；并发中的相同请求返回明确冲突。认证请求按 Bearer 凭证哈希隔离，避免跨账号重放。它只适合开发和单实例验证，多实例或生产部署前必须替换为持久共享存储。
