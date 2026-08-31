# ADR 0003：微信登录与不透明会话

- 状态：已接受
- 日期：2026-08-22

## 背景

T010 需要在不合并 User 与 Person 的前提下接入微信 code 登录，并支持可撤销、可轮换和可测试的服务端会话。生产密钥不能进入仓库，开发和自动化测试也不能依赖微信服务。

## 决策

1. 使用 `WechatLoginProvider` 隔离 code 交换。开发与测试使用确定性 fake provider；生产模式禁止 fake provider，必须配置微信 App ID 与 Secret。
2. OpenID 是 User 的幂等身份键；UnionID 存在时使用部分唯一索引。User 状态限定为 `ACTIVE` 或 `DISABLED`，禁用用户不能登录或使用会话。
3. 使用随机不透明 access/refresh token。数据库只保存 SHA-256 哈希，默认有效期分别为 15 分钟和 30 天。
4. refresh 采用一次性轮换：在同一事务内撤销旧 Session 并创建新 Session；并发或重复使用旧 refresh token失败。logout 撤销 access token 对应的 Session。
5. Session 属于 User，而非 Person；后续 FamilyMembership 和 PersonClaim 分别表达家族权限与谱系认领。

## 影响

- 服务端可即时撤销会话，也能明确测试过期、轮换和登出。
- 每次鉴权需要查询会话存储；后续可在保持相同语义的情况下增加缓存。
- 当前 refresh 会轮换整个 Session，因此旧 access token 也同时失效。
- fake code 仅用于非生产环境，不能作为真实微信身份凭据。
