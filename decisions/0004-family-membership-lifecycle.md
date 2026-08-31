# ADR 0004：Family 与 Membership 初始生命周期

- 状态：已接受
- 日期：2026-08-31

## 背景

T011 需要建立 Family 与 FamilyMembership，并保证创建者在同一事务内成为 OWNER。规格已确定成员角色和成员状态，但尚未明确 Family 的最小状态集合、初始隐私策略版本和读取时的不可披露行为。

## 决策

1. Family 初始状态为 `ACTIVE`，本阶段预留 `ARCHIVED`；新建 Family 的 `privacy_policy_version` 为 1。
2. 创建者同时写入 `owner_user_id` 与 `created_by`，并在同一数据库事务内创建唯一的 `OWNER/ACTIVE` FamilyMembership。
3. FamilyMembership 角色限定为 `OWNER/FAMILY_ADMIN/MEMBER`，状态限定为 `INVITED/ACTIVE/SUSPENDED/LEFT`；同一 User 在同一 Family 只有一条成员关系。
4. T011 的读取只允许 `ACTIVE` 成员。非成员、已暂停/离开成员和不存在的 Family 均返回 404，避免披露 Family 是否存在。
5. Family 范围查询必须同时限定 `family_id` 与当前 `user_id`。T040 将在此基础上集中实现完整 policy engine。

## 影响

- 创建成功时 Family 与 OWNER 成员关系必然同时存在；任一步失败全部回滚。
- `owner_user_id` 提供所有权快速定位，Membership 提供权限来源；后续所有权移交必须原子更新两者并留下审计。
- T011 不实现邀请加入、成员角色变更、归档操作或 Person 创建。
