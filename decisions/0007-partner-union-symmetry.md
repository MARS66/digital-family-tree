# ADR 0007：PartnerUnion 对称关系与生命周期

- 状态：已接受
- 日期：2026-08-31

## 背景

T014 需要表达婚姻或伴侣事实。该关系在业务上对称，但数据库必须使用稳定方向来保证唯一性；同时不能从伴侣关系自动推断亲子事实。

## 决策

1. 使用 `PartnerUnion`，端点按 UUID 字符顺序规范化为 `person_a_id < person_b_id`。无论输入 A-B 或 B-A，都查询和写入同一组合。
2. `union_type` 限定为 `MARRIAGE/PARTNERSHIP/UNKNOWN`；`start_date/end_date` 为可选 PostgreSQL `date`，只接受完整 ISO 日期，结束不得早于开始。
3. 活跃组合使用部分唯一索引 `(family_id,person_a_id,person_b_id) WHERE deleted_at IS NULL AND status='ACTIVE'`。软删除记录 actor 并递增 version，之后允许重建同一组合。
4. 创建和软删除取得与亲子关系相同的 Family advisory transaction lock。两端必须是同一 Family 的 ACTIVE、未删除 Person；服务和 PostgreSQL trigger 双重校验。
5. Person 仍有活跃 PartnerUnion 时不能软删除。人物关系查询对任一端点返回相同 PartnerUnion 摘要。
6. PartnerUnion 不产生任何 PARENT_OF、子女或兄弟姐妹推断。T014 只公开读取，写入由后续 Contribution/Review 流程调用。

## 影响

- 对称输入不会产生重复记录，并发反向创建由事务锁和唯一索引保护。
- 历史关系可软删除后重建，旧记录仍保留。
- 亲子事实必须独立记录和审核，不会因婚姻状态被自动制造。
