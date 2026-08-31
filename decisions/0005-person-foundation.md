# ADR 0005：Person 日期、占位与 T012 写入边界

- 状态：已接受
- 日期：2026-08-31

## 背景

T012 要求实现 Person CRUD、日期精度、占位、软删除和乐观锁；同时既有规格要求人物事实修改进入 Contribution/Review，不能开放绕过审核的直接写接口。T020 还需要在创建家族事务中建立首 Person。

## 决策

1. 日期使用 PostgreSQL `date`，精度限定为 `YEAR/MONTH/DAY`。YEAR 使用该年 1 月 1 日、MONTH 使用该月 1 日作为规范化存储值，但 API 始终同时返回 precision；未知日期由 date 与 precision 同时为 NULL 表示，禁止假日期。日期先后按精度区间判断，只有死亡日期的最晚可能值仍早于出生日期时才拒绝。
2. 非占位 Person 必须有非空 `primary_name`，且 `placeholder_label` 为空。占位 Person 必须有非空 `placeholder_label`；其 `primary_name` 保存同一显式上下文标签，不伪造真实姓名。
3. Person 状态预留 `ACTIVE/MERGED/ARCHIVED`。T012 只创建 ACTIVE；MERGED 必须在后续合并流程中带 `merged_into_person_id` 产生。
4. 更新和软删除必须携带 `expectedVersion`，使用带 `family_id`、`id`、`version`、`deleted_at IS NULL` 条件的原子更新；成功后 version 加 1。
5. T012 实现可复用的 Person 领域 CRUD，并验证管理员写入权限。公开 HTTP 在本阶段只提供成员范围的读取；创建由 T020 组合 API 调用，普通修改与删除由 T030–T032 的 Contribution/Review 应用服务调用。不得临时开放直写事实的公共端点。
6. 所有 Person 查询显式限定 `family_id`；无成员资格、跨 Family、已软删除或不可披露对象统一返回 404。

## 影响

- 不完整日期可准确表达，不会把未知日/月误当成真实日期。
- 写入服务具备 T020 和审核应用服务所需的并发保护，但当前客户端不能绕过审核直接调用。
- T013/T014 可安全引用未删除且同 Family 的 Person；合并和认领规则仍由各自后续任务实现。
