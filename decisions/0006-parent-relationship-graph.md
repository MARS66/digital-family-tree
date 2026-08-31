# ADR 0006：亲子图、并发循环保护与兄弟姐妹推导

- 状态：已接受
- 日期：2026-08-31

## 背景

T013 需要保存直接亲子事实、支持双向读取与兄弟姐妹推导，并在并发写入下阻止重复、自环和祖先循环。关系写入仍必须遵守 Contribution/Review 边界。

## 决策

1. 只存有向 `PARENT_OF`：`from_person_id` 是父母，`to_person_id` 是子女。子女、父母和兄弟姐妹均从该事实推导，不反向或重复存边。
2. 活跃边使用部分唯一索引 `(family_id,from_person_id,to_person_id,type) WHERE deleted_at IS NULL AND status='ACTIVE'`；FATHER 和 MOTHER 各自对同一子女最多一条活跃边。两端 Family 一致性同时由服务与 PostgreSQL trigger 校验。
3. 创建边在事务内先取得基于 `family_id` 的 PostgreSQL advisory transaction lock，再验证人物与成员范围、查询从拟议子女到拟议父母的现有路径，最后插入。相同 Family 的关系写入串行化，从而避免两个并发请求分别通过循环检查。
4. 循环检测使用 PostgreSQL 递归 CTE，仅遍历同一 Family 的 ACTIVE、未删除边；自环直接拒绝。
5. 兄弟姐妹不落库。共享至少两个父母为 `FULL`；只共享一个父母，且双方各自都有至少两个已知父母时为 `HALF`；信息不足时为 `UNKNOWN`，不把缺失资料当作“不共享”事实。
6. T013 实现受管理员权限约束的领域写入，公开 HTTP 只提供成员范围关系读取。写接口由 T030–T033 的贡献审核流程接入，不能直接绕过审核。
7. Person 软删除取得同一 Family 锁；存在活跃关系时由领域服务和 PostgreSQL trigger 双重拒绝，避免留下指向已删除人物的正式边。

## 影响

- Family 级锁牺牲同一家族关系写入的部分并发度，换取明确且可验证的无环保证；不同 Family 仍可并行。
- PostgreSQL 约束保护直接数据库写入的局部不变量；图循环由带锁领域事务保护。
- 后续软删除、关系修订和来源关联必须沿用同一锁与重验流程。
