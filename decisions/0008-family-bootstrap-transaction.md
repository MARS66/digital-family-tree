# ADR 0008：创建家族组合事务与初始 SELF claim

- 状态：已接受
- 日期：2026-08-31

## 背景

T020 要求一次请求创建 Family、OWNER Membership、首 Person 和可选 self claim，并保证失败回滚与弱网重试幂等。通用 PersonClaim 状态机属于 T043，当前不能提前开放任意认领。

## 决策

1. `POST /api/v1/families` 从 T011 的基础创建升级为组合创建，必须提供 `firstPerson`，可提供 `claimSelf=true`。
2. Family、OWNER/ACTIVE Membership、首 Person 与可选 PersonClaim 在一个 PostgreSQL 事务中写入；任何一步失败全部回滚。
3. T020 建立 PersonClaim 最小持久模型和规格中的部分唯一索引。组合创建是唯一的直接批准例外：创建者只能认领本事务新建、非占位的首 Person，写入 `SELF/APPROVED`。
4. 占位 Person 不允许 self claim。通用 PENDING 申请、审核、撤销、争议、证据和并发批准仍由 T043 实现，不在 T020 暴露接口。
5. HTTP 写入继续使用 T003 幂等层：同一认证凭证、幂等键和请求体重放首次完整响应；不同请求复用 key 返回冲突。当前存储仍为单实例内存，生产多实例前必须替换为持久共享存储。
6. 组合服务复用 Person 的同一套日期、占位和数据库校验，不建立第二套宽松规则。

## 影响

- 客户端一次成功即可获得完整的 Family、OWNER、首 Person 与可选 self claim 上下文。
- 新用户的自我认领不需要对自己刚创建的首 Person再走一次管理员审核，但该例外不能用于已有 Person。
- 进程重启后的幂等恢复仍是已知基础设施限制；在持久幂等存储完成前不支持多实例生产部署。
