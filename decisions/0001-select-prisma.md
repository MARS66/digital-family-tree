# ADR 0001：选择 Prisma 作为 V1 ORM 与迁移工具

- 状态：已接受
- 日期：2026-08-21
- 负责人：项目团队

## 背景

T002 需要确定 PostgreSQL 的 ORM、迁移、种子和测试基础。项目后续会大量使用事务、部分唯一索引、递归查询和 PostgreSQL 原生约束，因此既需要类型安全的常规数据访问，也必须保留直接编写和审查 SQL 的能力。

## 决策

V1 统一使用 Prisma 7。Prisma schema 描述常规表结构，Prisma Migrate 管理有序 SQL 迁移，PostgreSQL 特有约束和复杂迁移允许直接写入迁移 SQL。运行时使用 Prisma 的 `prisma-client` 生成器、`@prisma/adapter-pg` 和 `pg` 驱动。

生产迁移只使用 `prisma migrate deploy`；`prisma migrate dev` 仅限本地开发。V1 不混用第二套 ORM。

## 备选方案

- Drizzle：SQL 透明度高且类型层轻，但当前项目规格已经默认倾向 Prisma，团队暂无必须偏离默认方案的证据。
- 只使用 `pg`：控制力最高，但会增加常规 CRUD、类型同步和迁移治理成本。

## 影响

- Prisma 7 要求 ESM 和显式 PostgreSQL driver adapter，与当前 Node.js 24 工程一致。
- 生成的 Client 不提交仓库，由安装/构建阶段重新生成。
- 部分唯一索引、递归 CTE、advisory lock 等能力会使用原生 SQL，并纳入真实 PostgreSQL 集成测试。
- Prisma 7.9.1 间接依赖的 `deepmerge-ts` 旧版本存在递归对象栈耗尽漏洞；根工作区暂时强制使用已修复的 8.x，并通过 Prisma validate/generate/migrate 验证兼容性。上游修复后应移除覆盖。
- 若未来更换 ORM，必须新增 ADR 和迁移计划，不能在 V1 内并行混用。

## 验证

- 从空 PostgreSQL 数据库执行全部迁移。
- 执行幂等种子脚本。
- 在隔离数据库验证唯一约束、事务回滚和测试清理。
- CI 使用真实 PostgreSQL 服务运行数据库集成测试。
