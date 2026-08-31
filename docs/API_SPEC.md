# API 设计草案

## 1. 约定

- 前缀 `/api/v1`，JSON；ID 为 UUID；分页使用 cursor。
- Header：`Authorization: Bearer ...`、写请求 `Idempotency-Key`、更新携带 `If-Match` 或 `expectedVersion`。
- 成功响应：`{ data, meta? }`；错误：`{ error: { code, message, details?, traceId } }`。
- 常用状态：400 校验失败、401 未登录、403 无权、404 不存在或不可披露、409 版本/重复/关系冲突、422 业务规则、429 限流。
- 后端按 Family 租户、资源范围、字段隐私过滤；禁止客户端自行裁剪敏感数据。
- 基础设施端点：`GET /health` 返回统一成功包；`GET /openapi.json` 返回 OpenAPI 3.1 文档。
- trace ID 由服务端生成并同时写入 `X-Trace-Id` 响应头；客户端传入值不直接作为内部 trace ID。
- 相同 `Idempotency-Key`、方法、路径和请求体重试时重放首次响应；同 key 对应不同请求或前次仍在处理时返回 409。

## 2. 认证

- `POST /api/v1/auth/wechat/login`：输入 `{ code }`；输出 `{ accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, user, families }`。
- `POST /api/v1/auth/refresh`：输入 `{ refreshToken }`；原子撤销旧会话并返回一对新 token，旧 token 不可重用。
- `POST /api/v1/auth/logout`：Bearer access token 鉴权并撤销当前会话。
- `GET /api/v1/me`：账号、家族成员身份和已批准认领摘要（后续任务实现）。
- access token 默认 15 分钟，refresh token 默认 30 天；服务端仅保存 token 哈希。所有认证写接口同样要求 `Idempotency-Key`。

## 3. Family 与成员

- `POST /api/v1/families`：T011 输入 `{ name, description?, originPlace? }`；原子创建 Family 与创建者的 `OWNER/ACTIVE` Membership。首 Person 与 self claim 留给 T020 组合 API。
- `GET /api/v1/families/:familyId`：仅有效成员可读取；不存在或不可披露统一返回 404。
- `PATCH /families/:familyId`：配置更新；管理员，需版本。
- `GET /families/:familyId/stats`：人数、关系、贡献、分支完成度。
- `GET /families/:familyId/members?cursor=`：分页成员。
- `PATCH /families/:familyId/members/:membershipId`：角色/状态；管理员。

## 4. Person 与视图

- `POST /api/v1/families/:familyId/persons`：由 T020 组合创建或 T030 Contribution 流程提供；T012 不开放绕过审核的直接写端点。
- `GET /api/v1/families/:familyId/persons/:personId`：T012 已实现成员范围基础读取；软删除、跨 Family 或不可披露对象统一返回 404。日期返回 `{ value, precision }` 或 `null`。
- `PATCH /api/v1/families/:familyId/persons/:personId`：后续创建 ContributionItem，不直接覆盖正式事实；领域写入必须携带 expectedVersion。
- `GET /families/:familyId/persons/search?q=&branchId=&cursor=`：模糊搜索；仅返回可见摘要。
- `GET /families/:familyId/persons/:personId/view?mode=self|ancestors|descendants&depth=`：局部图 DTO `{ nodes, edges, hiddenNodeCount, nextCursors }`。
- `POST /families/:familyId/placeholders/:personId/resolve`：补全或提出合并；管理员/贡献流程。

## 5. Relationship / PartnerUnion

- `POST /families/:familyId/relationships/validate`：输入候选边，输出重复、循环、代际冲突预检；结果不保证审核时仍有效。
- `POST /families/:familyId/contributions/:id/relationships`：添加亲子候选 `{ parentId, childId, parentRole, sourceId? }`。
- `DELETE /families/:familyId/contributions/:id/relationships/:relationshipId`：提出删除。
- `POST /families/:familyId/contributions/:id/unions`：伴侣候选 `{ person1Id, person2Id, unionType, dates?, sourceId? }`。
- `GET /families/:familyId/persons/:personId/relations`：经权限过滤的直接和推导关系。

## 6. Claim

- `POST /families/:familyId/claims`：`{ personId, statement?, sourceId? }`；占位不可认领。
- `GET /families/:familyId/claims?status=&cursor=`：管理员范围队列。
- `GET /me/claims`：跨家族认领。
- `POST /families/:familyId/claims/:id/review`：`{ decision, comment? }`；管理员。
- `POST /families/:familyId/claims/:id/revoke`：本人请求或管理员处置，写审计。

## 7. Contribution / Review

- `POST /families/:familyId/contributions`：创建草稿。
- `GET/PATCH /families/:familyId/contributions/:id`：读取/保存草稿，需版本。
- `POST /families/:familyId/contributions/:id/items`：添加变更项，`clientItemKey` 幂等。
- `POST /families/:familyId/contributions/:id/submit`：冻结提交并运行校验。
- `POST /families/:familyId/contributions/:id/withdraw`：审核决定前撤回。
- `GET /families/:familyId/reviews?status=&branchId=&risk=&cursor=`：审核队列。
- `GET /families/:familyId/reviews/:id`：差异、来源、冲突和影响。
- `POST /families/:familyId/reviews/:id/decision`：`{ decision, comment, expectedSubjectVersion }`；批准时原子生效并返回 revision。

## 8. Invitation 与 Branch

- `POST /families/:familyId/invitations`：`{ type, branchId?, personId?, expiresAt, maxUses? }`；输出一次性明文 token、分享路径、二维码资源。
- `GET /invitations/:token/preview`：最小上下文，不泄露敏感字段。
- `POST /invitations/:token/accept`：登录后加入/进入上下文；幂等。
- `POST /families/:familyId/invitations/:id/revoke`。
- `POST/GET /families/:familyId/branches`。
- `GET/PATCH /families/:familyId/branches/:branchId`。
- `POST /families/:familyId/branches/:branchId/admins`；家族管理员。

## 9. Import

- `GET /families/:familyId/imports/template?format=xlsx`：下载版本化模板。
- `POST /families/:familyId/imports`：先取得上传凭证或关联已上传 Media，创建 ImportJob。
- `POST /families/:familyId/imports/:id/mapping`：保存列映射并解析。
- `GET /families/:familyId/imports/:id`：状态、摘要、错误计数。
- `GET /families/:familyId/imports/:id/rows?status=&cursor=`：分页候选与错误。
- `POST /families/:familyId/imports/:id/decisions`：批量但逐行记录 `{ rowId, decision, targetPersonId? }`。
- `POST /families/:familyId/imports/:id/confirm`：生成 Contribution，仍需审核。
- `POST /families/:familyId/imports/:id/cancel`。

## 10. Merge 与质量

- `GET /families/:familyId/duplicates?status=&cursor=`。
- `POST /families/:familyId/duplicates/scan`：管理员触发限流任务。
- `POST /families/:familyId/merges/preview`：`{ survivorId, mergedId }`；返回字段/关系/认领冲突和阻断项。
- `POST /families/:familyId/merges`：带预览版本和理由，创建高风险审核对象。
- `POST /families/:familyId/merges/:id/approve`：执行事务合并；家族管理员。
- `POST /families/:familyId/merges/:id/reverse`：生成反向修订，只有可安全恢复时允许。

## 11. Source、Media、History 与 Privacy

- `POST/GET /families/:familyId/sources`；详情按权限过滤附件。
- `POST /families/:familyId/media/upload-intents`；返回 COS 临时上传信息。
- `POST /families/:familyId/media/:id/complete`；校验哈希/类型后转 READY。
- `GET /families/:familyId/history?entityType=&entityId=&cursor=`。
- `GET/PATCH /families/:familyId/persons/:personId/privacy`；本人或管理员，扩大范围需明确确认。

## 12. 代表性输入输出

创建亲子候选：

```json
{
  "parentId": "uuid-parent",
  "childId": "uuid-child",
  "parentRole": "FATHER",
  "sourceId": "uuid-source",
  "clientItemKey": "mobile-42"
}
```

冲突响应：

```json
{
  "error": {
    "code": "RELATIONSHIP_CYCLE",
    "message": "该关系会形成祖先循环",
    "details": { "pathPersonIds": ["uuid-child", "...", "uuid-parent"] },
    "traceId": "trace-id"
  }
}
```
