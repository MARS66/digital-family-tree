# 核心数据模型

## 1. 通用约定

- 主键统一 UUID；时间为 `timestamptz`；业务表含 `created_at/updated_at`。
- 可变事实实体含 `version`（整数乐观锁）；可删除实体含 `deleted_at/deleted_by`。
- 所有 Family 范围表携带 `family_id`，查询必须显式限定租户。
- 正式事实不原地覆盖而不留痕：批准操作同时写 `Revision`。
- 姓名、日期允许不完整；未知不使用假值。日期可保存精度（年/月/日）。
- PostgreSQL 约束负责局部不变量；跨行、跨关系图规则由事务内领域服务校验。

## 2. 身份与家族

### User

`id`, `wechat_openid`（按小程序唯一）、`wechat_unionid?`, `display_name?`, `avatar_media_id?`, `status`, `last_login_at`, timestamps。

约束：`wechat_openid` 唯一；存在 UnionID 时建立部分唯一索引；`status` 为 `ACTIVE/DISABLED`。不得把谱系字段放入 User。

### Session

`id`, `user_id`, `access_token_hash`, `refresh_token_hash`, `access_expires_at`, `refresh_expires_at`, `last_used_at?`, `revoked_at?`, timestamps。

约束：访问和刷新 token 哈希分别唯一；刷新有效期不得早于访问有效期。数据库不保存明文 token。刷新时原子撤销旧 Session 并创建新 Session，登出撤销当前 Session；User 删除时级联清理会话。

### Family

`id`, `name`, `description?`, `origin_place?`, `owner_user_id`, `status`, `privacy_policy_version`, `created_by`, timestamps, `deleted_at`。

T011 状态限定为 `ACTIVE/ARCHIVED`，初始隐私策略版本为 1。创建时必须在同一事务内建立创建者的 `OWNER/ACTIVE` Membership；所有权移交必须同步更新 Family 与 Membership。

### FamilyMembership

`id`, `family_id`, `user_id`, `role`（OWNER/FAMILY_ADMIN/MEMBER）, `status`（INVITED/ACTIVE/SUSPENDED/LEFT）, `joined_at`, `invitation_id?`, timestamps。

约束：`(family_id,user_id)` 唯一（保留历史可改为有效记录部分唯一）。Branch 权限放单独授权表或 `BranchMembership`，避免一个字段表达多个范围。

非邀请状态必须具有 `joined_at`；Family 范围读取同时限定 `family_id`、当前 `user_id` 和有效成员状态。

### Branch

`id`, `family_id`, `name`, `description?`, `anchor_person_id?`, `parent_branch_id?`, `sort_order`, `status`, timestamps, `deleted_at`。

约束：`parent_branch_id` 同 Family；防 Branch 树循环。Person 可通过 `PersonBranch(person_id,branch_id,is_primary)` 支持跨支归属，`(person_id,branch_id)` 唯一。

### BranchMembership

`id`, `branch_id`, `family_membership_id`, `role`（BRANCH_ADMIN/MEMBER）, timestamps；组合唯一。

## 3. 人物、认领与隐私

### Person

`id`, `family_id`, `primary_name`, `former_name?`, `courtesy_name?`, `gender`（UNKNOWN/MALE/FEMALE/OTHER）, `is_living`（TRUE/FALSE/UNKNOWN）, `birth_date?`, `birth_date_precision?`, `death_date?`, `death_date_precision?`, `birth_place?`, `summary?`, `is_placeholder`, `placeholder_label?`, `status`（ACTIVE/MERGED/ARCHIVED）, `merged_into_person_id?`, `created_by`, `version`, timestamps, `deleted_at`。

校验：死亡日期不得早于出生日期；占位人物必须有标签且不可被认领；`merged_into_person_id` 不得指向自身并最终解析到 ACTIVE 人物。姓名不做全局唯一。

T012 日期精度限定为 `YEAR/MONTH/DAY`，未知日期由日期值与精度同时为空表达；年/月采用区间起点规范化存储，先后关系按精度区间判断。占位人物的 `primary_name` 与显式上下文标签相同，不伪造姓名。更新与软删除使用 `(family_id,id,version,deleted_at IS NULL)` 原子条件并递增 version；软删除同时记录 `deleted_by`。

### PersonClaim

`id`, `family_id`, `person_id`, `user_id`, `claim_type`（SELF，后续可扩展 GUARDIAN）, `status`（PENDING/APPROVED/REJECTED/REVOKED/DISPUTED）, `evidence_source_id?`, `review_id?`, timestamps。

约束：同 Family 每个 User 仅一个 APPROVED SELF；同 Person 仅一个 APPROVED SELF（部分唯一索引）。待审重复通过事务锁处理。

T020 建立最小持久模型。创建家族组合事务可为创建者和同事务新建的非占位首 Person 直接写入 `SELF/APPROVED`；这是初始化例外。通用申请、证据、审核、撤销和争议仍由 T043 实现，不能把该例外用于已有 Person。

### PrivacySetting

`id`, `family_id`, `person_id?`, `record_type`, `record_id?`, `field_name?`, `visibility_scope`, `configured_by_user_id`, `reason?`, timestamps。

解析优先级：字段显式设置 > 记录设置 > Person 设置 > Family 默认。不得用 NULL 模糊表达“继承”和“拒绝”，必要时增加 `mode=INHERIT/ALLOW/DENY`。

## 4. 关系建模

### Relationship

仅存直接、有方向的事实关系。字段：`id`, `family_id`, `from_person_id`, `to_person_id`, `type`（PARENT_OF）, `parent_role`（FATHER/MOTHER/PARENT/UNKNOWN）, `status`, `source_id?`, `valid_from?`, `valid_to?`, `created_by`, `version`, timestamps, `deleted_at`。

约束：禁止自环；有效边 `(family_id,from_person_id,to_person_id,type)` 部分唯一；两端同 Family。添加 `PARENT_OF` 前在事务中查询从子到父是否已有后代路径，拒绝祖先循环。默认最多一个有效 FATHER 和一个有效 MOTHER；超出时作为冲突候选，不直接写正式层。

子女是 `PARENT_OF` 的反向读取；兄弟姐妹通过共享父/母推导，绝不单独存储，且需要区分全同胞/半同胞/未知。

T013 对同一 Family 的关系写入使用 PostgreSQL advisory transaction lock，再执行递归 CTE 循环检测和插入，防止并发请求分别通过校验。两端 Family 与未删除状态由数据库 trigger 再校验。全同胞表示至少共享两位父母；仅共享一位且双方各有至少两位已知父母时为半同胞；其余为未知。存在活跃关系的 Person 不允许软删除。

### Marriage / Partner 策略

伴侣关系是对称的，但数据库采用规范化端点：`PartnerUnion`（推荐名称，避免把所有关系都定义为婚姻）：

`id`, `family_id`, `person_a_id`, `person_b_id`, `union_type`（MARRIAGE/PARTNERSHIP/UNKNOWN）, `start_date?`, `end_date?`, `status`, `source_id?`, `version`, timestamps, `deleted_at`。

写入前按 UUID 排序，保证 `person_a_id < person_b_id`，有效组合唯一并禁止同人。若需婚礼事件，使用 Event 关联，而非重复一条关系。子女与各父母分别建 `PARENT_OF`；不要从伴侣关系自动推断亲子事实。

T014 的活跃组合使用部分唯一索引；两端同 Family 与未删除状态由 trigger 校验。起止日期只接受完整日期且结束不得早于开始。软删除记录操作者并递增 version，之后允许重建同一组合；存在活跃 PartnerUnion 的 Person 不允许软删除。

## 5. 共建、审核与版本

### Contribution

一次用户可理解的变更包。`id`, `family_id`, `author_user_id`, `branch_id?`, `title?`, `status`（DRAFT/SUBMITTED/IN_REVIEW/CHANGES_REQUESTED/APPROVED/REJECTED/WITHDRAWN）, `base_revision_no?`, `submitted_at?`, timestamps。

### ContributionItem

`id`, `contribution_id`, `entity_type`, `entity_id?`, `operation`（CREATE/UPDATE/DELETE/MERGE）, `base_version?`, `patch_json`, `before_snapshot_json?`, `source_id?`, `client_item_key`, timestamps。

约束：`(contribution_id,client_item_key)` 唯一。`patch_json` 需按实体 schema 校验。批准整包时锁定受影响实体、重跑权限/重复/循环/版本校验，并原子提交。

### Review

`id`, `family_id`, `subject_type`（CONTRIBUTION/CLAIM/IMPORT/MERGE）, `subject_id`, `reviewer_user_id`, `decision`（APPROVED/REJECTED/CHANGES_REQUESTED）, `comment?`, `decided_at`, timestamps。

需要多级审核时追加多条 Review，不覆盖。审核者不得审核自己提交的高风险合并；V1 可对普通贡献允许管理员自录自审但需显著审计标记。

### Revision / History

`Revision`: `id`, `family_id`, `revision_no`, `actor_user_id`, `action`, `subject_type`, `subject_id`, `contribution_id?`, `reason?`, `created_at`；`(family_id,revision_no)` 唯一。

`RevisionChange`: `id`, `revision_id`, `entity_type`, `entity_id`, `operation`, `before_json`, `after_json`。

历史记录追加写，不软删除。大字段附件只保存引用和哈希。恢复旧版通过新 Contribution 反向应用，不修改历史。

## 6. 来源、事件与媒体

### Source

`id`, `family_id`, `type`（SELF_ATTESTATION/RELATIVE_ORAL/GENEALOGY/ARCHIVE/CERTIFICATE/PHOTO/IMPORT/AI_OCR/OTHER）, `title`, `description?`, `informant_person_id?`, `recorded_by_user_id`, `original_date?`, `media_id?`, `external_ref?`, `content_hash?`, timestamps, `deleted_at`。

### Event

`id`, `family_id`, `type`（BIRTH/DEATH/MARRIAGE/MIGRATION/CUSTOM）, `title`, `date?`, `date_precision?`, `place?`, `description?`, `source_id?`, `version`, timestamps, `deleted_at`。通过 `EventParticipant(event_id,person_id,role)` 多对多关联人物。

### Media

`id`, `family_id`, `storage_key`, `mime_type`, `size_bytes`, `sha256`, `width?`, `height?`, `status`（UPLOADING/READY/QUARANTINED/DELETED）, `uploaded_by`, timestamps, `deleted_at`。同 Family 可按哈希提示重复，但不自动共享私密对象。

## 7. 邀请、导入、查重与合并

### Invitation

`id`, `family_id`, `type`（FAMILY/BRANCH/PERSON）, `branch_id?`, `person_id?`, `token_hash`, `created_by`, `expires_at`, `max_uses?`, `use_count`, `status`, timestamps。约束类型与上下文字段一致；token 明文只在创建时返回。

### ImportJob

`id`, `family_id`, `branch_id?`, `type`（EXCEL，预留 DOC/PDF/OCR）, `media_id`, `status`（UPLOADED/PARSING/MAPPING/VALIDATING/NEEDS_CONFIRMATION/CONFIRMED/APPLYING/COMPLETED/FAILED/CANCELLED）, `mapping_json?`, `summary_json?`, `created_by`, timestamps。

`ImportRow`: `id`, `import_job_id`, `row_no`, `raw_json`, `normalized_json?`, `status`, `errors_json?`, `candidate_person_id?`, `decision?`。`(import_job_id,row_no)` 唯一。

统一管线：原始资料 → 解析 → 候选人物/关系 → 查重 → 冲突检测 → 人工确认 → Contribution/Review → 正式层。

### DuplicateCandidate

`id`, `family_id`, `person_a_id`, `person_b_id`, `score`, `signals_json`, `status`（OPEN/NOT_DUPLICATE/MERGED/DEFERRED）, `resolved_by?`, `merge_record_id?`, timestamps。规范化端点并组合唯一。分数仅排序，不自动合并。

### MergeRecord

`id`, `family_id`, `survivor_person_id`, `merged_person_id`, `reason`, `review_id`, `mapping_json`, `conflicts_json?`, `performed_by`, `revision_id`, `created_at`, `reversed_by_merge_record_id?`。

合并事务：锁定两人 → 重验同 Family 与状态 → 预览字段冲突 → 迁移/去重关系、来源、媒体、事件、分支关联 → 保留旧 ID 重定向 → 写 Revision/MergeRecord。发生自环、循环或无法决断的字段冲突时拒绝自动执行。

## 8. 冲突与并发策略

- 更新必须携带 `expectedVersion`；不匹配返回 409 和当前快照。
- 审核批准重跑全部校验，不能沿用提交时结论。
- 关系写入使用事务与涉及人物的稳定顺序行锁，降低死锁。
- 循环检测在同一事务执行；必要时对 Family 使用短时 advisory lock。
- 关系冲突不覆盖：形成待审候选和 Conflict 记录（可用 `DataConflict`：subject、type、payload、status、resolution）。
- API 使用幂等键避免弱网重试重复创建。
- 合并后所有读取先解析 `merged_into_person_id` 链，并通过约束/服务保证链不成环。

## 9. 推荐索引

- 所有范围查询：`(family_id,status)`。
- 人物搜索：`(family_id,primary_name)`，中文模糊检索可用 `pg_trgm` 或专门检索列。
- 亲子双向：`(family_id,from_person_id)` 与 `(family_id,to_person_id)`。
- 待办：Contribution/Review 的 `(family_id,status,created_at)`。
- Invitation 的 `token_hash` 唯一；ImportRow 的 job/row 唯一。
- 所有部分唯一约束排除 `deleted_at IS NOT NULL` 与非有效状态。
