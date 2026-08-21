# 数字家谱微信小程序

本仓库是“数字家谱微信小程序”V1 的产品与技术蓝图。产品本质是一个**家族数字档案 + 关系网络 + 协作共建平台**：人物、关系、来源、审核和版本构成事实数据库；家谱树只是数据库的一种 View。

## 文档导航

- [项目总览](docs/PROJECT_OVERVIEW.md)
- [V1 MVP PRD](docs/PRD.md)
- [MVP 范围与指标](docs/MVP_SCOPE.md)
- [用户流程与千人补谱增长](docs/USER_FLOWS.md)
- [信息架构与页面规格](docs/INFORMATION_ARCHITECTURE.md)
- [角色、权限与隐私](docs/PERMISSION_MODEL.md)
- [核心数据模型](docs/DATA_MODEL.md)
- [API 草案](docs/API_SPEC.md)
- [技术架构与开发路线](docs/TECH_ARCHITECTURE.md)
- [Codex 可执行任务清单](docs/CODEX_TASKS.md)
- [当前项目状态](docs/PROJECT_STATUS.md)
- [架构决策记录](decisions/README.md)

## 决策优先级

当文档冲突时，按以下顺序处理：数据真实性与隐私安全 > MVP 边界 > 用户体验 > 实现便利。任何改变核心实体、权限或审核语义的实现，都应先更新文档再编码。

## V1 核心闭环

创建家族 → 建立主干 → 生成邀请/分支二维码 → 成员进入 → 认领人物 → 按家庭单元补录 → 提交审核 → 正式生效 → 家谱扩张。

## 长期开发方式

本目录是独立长期项目。每次开发先查看 `docs/PROJECT_STATUS.md`，再从 `docs/CODEX_TASKS.md` 领取一个任务。项目级协作和质量规则见 `AGENTS.md`；重要技术或产品决策记录在 `decisions/`。

## 工程快速开始

### 环境要求

- Node.js 24.19 或更高版本（仓库通过 `.nvmrc` 固定版本）
- npm 11 或更高版本

### 安装与验证

```bash
nvm use
npm ci
cp .env.example .env
npm run check
```

`npm run check` 会依次检查格式、静态规则、TypeScript 类型和自动化测试。提交到 GitHub 后，CI 会在 Node.js 22 环境执行同一质量门禁。

如需分别执行：

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

### 工作区结构

- `packages/contracts/`：前后端共享契约；业务 API 协议将在 T003 定义。
- `server/`：Node.js/TypeScript 后端；HTTP 服务将在 T003 引入。
- `miniprogram/`：微信小程序 TypeScript 工程；业务页面按后续 UI 任务引入。
- `database/`：数据库资产占位；迁移框架将在 T002 引入。
- `tests/`：跨工作区 smoke、集成和验收测试。

本地密钥只放在被 Git 忽略的 `.env` 中。新增配置项时同步更新 `.env.example`，但不得写入真实密钥。
