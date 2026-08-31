# 数据库开发与迁移

## 约定

- PostgreSQL 是唯一事实数据库，Prisma 7 是 V1 的 ORM 与迁移工具。
- `database/prisma/schema.prisma` 保存模型声明；`database/prisma/migrations/` 保存不可变的迁移历史。
- 业务表从后续任务开始建立；T002 仅包含技术性 `app_metadata` 表。
- 测试必须使用 `TEST_DATABASE_URL` 指向的非生产 PostgreSQL 实例，并为每个测试创建独立数据库。

## 常用命令

```bash
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:seed
npm run test:db
```

`db:migrate:dev` 只用于本地生成迁移。部署环境一律执行只应用已有迁移的 `db:migrate`。

## 迁移流程

1. 修改 Prisma schema，必要时补充 PostgreSQL 原生约束。
2. 在开发数据库运行 `npm run db:migrate:dev -- --name <change>`。
3. 审查生成的 SQL，尤其是数据丢失、锁表、索引和 Family 范围。
4. 从空测试数据库运行全部迁移和集成测试。
5. 合并后不得修改已部署迁移，只能追加新迁移。

## 回滚策略

生产环境采用向前修复：数据库变更失败时停止发布，保留失败日志并追加修复迁移。对于删列、改类型等破坏性变更，必须先做 expand/contract 分阶段迁移并在发布前完成备份；需要恢复数据时使用隔离验证过的备份恢复，而不是在生产环境盲目执行通用 down migration。

每个破坏性迁移都必须在同目录附带专门的回退说明。T002 初始迁移若尚未承载业务数据，可通过删除并重建目标数据库回退；一旦进入共享环境，不再删除迁移历史表或已应用迁移。
