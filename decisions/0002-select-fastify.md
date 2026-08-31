# ADR 0002：选择 Fastify 作为 HTTP 服务框架

- 状态：已接受
- 日期：2026-08-22
- 负责人：项目团队

## 背景

T003 需要建立 Node.js HTTP 服务、统一错误协议、trace ID、输入校验、幂等骨架和 OpenAPI。后续所有业务接口都必须沿用相同的协议和生命周期。

## 决策

V1 使用 Fastify 5。请求校验和响应 schema 使用 Fastify 原生 JSON Schema/Ajv，OpenAPI 使用 `@fastify/swagger` 从路由 schema 动态生成。服务端始终生成 UUID trace ID，不接受客户端直接指定内部请求 ID。

所有写请求必须携带 `Idempotency-Key`。T003 提供可替换的 `IdempotencyStore` 接口和单实例内存实现；进入多实例部署前必须替换为持久共享实现。

## 备选方案

- Express：生态成熟，但需要额外组合校验、schema 和 OpenAPI 工具，协议一致性更依赖人工约束。
- NestJS：结构完整，但当前模块化单体处于早期，框架和装饰器成本高于 T003 所需。
- 手写 Node.js HTTP：依赖最少，但错误处理、校验、生命周期和测试基础需要重复建设。

## 影响

- 所有路由必须声明 JSON Schema，并在统一错误处理器之外避免返回自定义错误形状。
- `/openapi.json` 是当前文档入口。Swagger UI 因非验收必需且曾引入有漏洞的静态文件依赖而不启用。
- 内存幂等存储只用于开发和单实例基础验证，服务重启会丢失记录，也不能协调多个进程。
- 后续鉴权、权限和限流作为 Fastify plugin/hook 接入，不允许绕开统一协议。

## 验证

- HTTP 注入测试覆盖健康检查、trace ID、校验错误、404、500 脱敏、幂等重放和冲突。
- OpenAPI 测试确认 `/health` 被收录且文档版本为 3.1。
- 生产式构建后实际监听随机端口并通过健康检查。
