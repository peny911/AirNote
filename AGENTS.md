# AirNote — Agent 协作与维护指南

> 本文件是进入 AirNote 工作区的默认入口。开始修改代码前请先阅读本指南；涉及具体产品细节、DDL、UI 规范时按需查阅 `docs/`。

## 1. 项目概览与当前状态

- **定位**：轻盈、私密、私有化部署的个人与受邀小团队网页版网络记事本（类 OneNote 三级结构：笔记本 → 分区 → 页面/子页面）。
- **技术栈**：TypeScript 全栈单进程
  - 前端：`React 19` + `Vite 6` + `Tailwind CSS v4` + `TipTap`
  - 后端：`Node.js >= 22.13`（验证环境 `v26.13.0`）+ `Hono` + 原生 `node:sqlite`（SQLite WAL + FTS5）
  - 共享契约：`src/shared/types.ts`、`src/shared/validators.ts`（Zod）
- **当前阶段**：路线图阶段一至阶段四（认证/2FA、管理后台、双端工作台、TipTap 编辑器、FTS5 搜索、隔离附件与自动化测试）已全部落地，**项目处于维护与迭代阶段**。

## 2. 常用命令与验证

```bash
npm run dev          # 并行启动后端 (:3100) 与前端 Vite (:5173，代理 /api -> :3100)
npm run typecheck    # 全仓 TypeScript 严格类型检查
npm test             # 运行 Vitest 全量自动化测试（4 个阶段测试套件）
npm run build        # 构建前端 dist/client 与后端 dist/server
npm start            # 生产单进程启动（同时托管 /api/* 与 dist/client）
npm run init-admin   # 初始化首位管理员账号
npm run backup       # SQLite WAL 在线热备份
```

**修改代码后的最低交付门槛**：至少确保 `npm run typecheck`、`npm test` 通过；涉及构建/路由/前端静态托管改动时同时运行 `npm run build`。

## 3. 绝对不可违反的红线

### 安全与数据隔离
1. **严格用户隔离（防 IDOR）**：所有笔记本、分区、页面、搜索、附件的单对象读写删查必须经 `src/server/db/scoped.ts`（或确保 SQL 带 `AND user_id = ?`），严禁仅按 `id` 查改删。跨用户访问统一返回 `404`。
2. **管理员隐私边界**：`/api/admin/*` 仅管理成员生命周期与审计日志，**严禁新增任何让管理员读取或统计他人笔记内容/数量的接口或界面**。
3. **附件隔离**：附件存于 `data/uploads/<user_id>/`，严禁通过静态目录直接暴露，必须经 `GET /api/attachments/:id` 校验归属后返回，并保留防 XSS 响应头。
4. **认证与 2FA 闭环**：封闭邀请制（禁止自助注册）；2FA 为用户自选；保持 TOTP `±1` 时间步容错、`totp_last_step` 防重放、8 组一次性恢复码、IP+账号双维度限流，以及停用/改密/登出后即时吊销 Session。
5. **ADR-01 约束**：首版笔记正文明文落盘以发挥 FTS5 检索能力，正文读写统一走 `src/server/security/content-codec.ts`，全文搜索统一走 `src/server/security/search-service.ts`，不擅自引入 E2EE 或拆分微服务/外部数据库。
6. **日志脱敏**：严禁在日志或错误响应中输出密码、Token、Cookie、`MASTER_KEY`、TOTP Secret、恢复码及用户笔记标题/正文/附件原文。

### 本地运行数据保护
- **`data/` 目录（`data/airnote.db`、`data/.master.key`、`data/uploads/`）视为真实本地持久化数据**：
  - 自动化测试必须使用 `:memory:` 或临时目录，**严禁在测试或调试脚本中清空、重置或污染 `data/airnote.db` 与 `data/uploads/`**。
  - **严禁将 `data/`、`.env`、真实 `MASTER_KEY` 提交进 Git**。

### UI / UX 硬性约定
1. **固定交互文案**：始终使用 **`添加笔记本`** / **`添加分区`** / **`添加页面`** / **`添加子页面`**；空标题 placeholder 为 `无标题页面` / `页面标题`，空正文 placeholder 为 `随时记下此刻的想法...`（必须由 TipTap `Placeholder` 扩展渲染，严禁写入真实正文 JSON）。
2. **光效与 CSS 避坑**：
   - 琉璃材质类不得无条件写 `position: relative` 覆盖 `absolute` / `fixed`。
   - 主按钮扫光仅允许入场一次 + Hover 一次，**严禁无限循环扫光**；柔和模式关闭粒子与入场扫光。
3. **移动端适配底线**：`< 768px` 保持纯净四级钻取（无底部 Tab 栏），所有 `<input>` 与编辑器字号不低于 `16px`（防 iOS 自动放大），热区 `>= 36×36px`，底部悬浮主按钮居中并适配安全区。
4. **原型边界**：`docs/prototypes/ui-prototype-v4-final.html` 仅供设计参考，严禁把原型顶部的评审工具栏或伪角色切换带入正式代码。

## 4. 代码结构与现有风格

```text
src/
├── shared/     # types.ts, validators.ts（前后端共享契约与 Zod Schema）
├── server/     # Hono 后端
│   ├── app.ts / index.ts / config.ts / context.ts
│   ├── db/         # client.ts（幂等建表与索引）, scoped.ts（user_id 隔离封装）
│   ├── middleware/ # auth.ts（鉴权/CSRF/安全头）, admin.ts
│   ├── security/   # password, crypto, totp, content-codec, rate-limit, search-service, audit
│   ├── routes/     # auth, admin, notebooks, sections, pages, search, attachments
│   └── scripts/    # init-admin.ts, backup.ts
└── client/     # React 19 前端
    ├── api/client.ts          # 统一 API 请求层（组件内勿散落裸 fetch）
    ├── stores/useWorkspace.ts # 工作区状态管理
    ├── styles/crystal.css     # 双主题与琉璃样式
    └── components/            # auth / desktop / mobile / editor / modals / search / security / admin
```

- **后端分层与错误处理**：当前保持轻量结构（`routes/` + `db/scoped.ts` + `security/`），无单独 `services/` 目录；业务错误统一使用 `src/server/context.ts` 的 `jsonError(c, status, code, message, details?)`，返回 `{ error: { code, message, details? } }`。
- **关键环境变量**：主密钥环境变量为 `MASTER_KEY`（64 位 hex，见 `.env.example` 与 `src/server/config.ts`）。
- **变更联动**：修改字段、API 或表结构时，同步更新 `src/shared/`、`src/server/db/client.ts`、对应测试以及 `docs/` 相关章节。

## 5. 文档索引（按需深入阅读）

| 文档 | 何时查阅 |
| :--- | :--- |
| [README.md](./README.md) | 本地启动、环境变量、Nginx 反代与热备份 |
| [docs/README.md](./docs/README.md) | 全部设计文档总索引 |
| [docs/01-product-requirements.md](./docs/01-product-requirements.md) | 产品边界、功能清单、术语与文案规范 |
| [docs/02-architecture-and-security.md](./docs/02-architecture-and-security.md) | 技术栈、ADR-01、SQLite 表结构 DDL、REST API 契约 |
| [docs/03-ui-ux-design-spec.md](./docs/03-ui-ux-design-spec.md) | 桌面三栏 / 移动端四级 UE、双主题与动效避坑 |
| [docs/04-development-roadmap.md](./docs/04-development-roadmap.md) | 实际目录结构、四阶段交付记录与验收项 |
| [docs/dev-guide.md](./docs/dev-guide.md) | 编码约定、Git 提交规范、测试与交付检查清单 |
