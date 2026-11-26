# 开发规范与编码约定

适用项目：**AirNote**（私有化网页版网络记事本）  
技术栈：**TypeScript 全栈轻量单进程**（`React 19 + Vite + Tailwind CSS v4 + TipTap` + `Node.js v26 + Hono + SQLite 3`）  
配套文档：[文档总目录](README.md) · [产品需求规格书](01-product-requirements.md) · [架构与安全设计](02-architecture-and-security.md) · [UI/UX 设计规范](03-ui-ux-design-spec.md) · [开发路线图](04-development-roadmap.md)

## 设计原则

- **KISS**：保持实现简单，优先选择最少的抽象和最直接的方案。
- **YAGNI**：只实现当前明确需要的功能，不预留大而空的扩展点。
- **SOLID**：单一职责、开闭原则优先；前端组件、状态管理、API 客户端、后端路由、业务服务、安全模块与数据访问层边界清晰。
- **DRY**：重复逻辑优先抽到公共模块或 `src/shared/`，但只有在至少两个真实场景复用时才抽。
- **高内聚低耦合**：同一业务能力尽量放在同一模块内；跨层通过明确的 TypeScript 类型 / Zod Schema 与服务接口交互，避免路由层直接拼接复杂 SQL 或组件层直接散落 `fetch`。

结合本产品边界，额外强调：

- 封闭邀请制与个人私有隔离：前期不做自助注册、多人实时协同编辑（CRDT / WebSocket）、公开分享链接、插件市场、多语言；相关代码不要提前实现。
- 管理员控制台只负责成员账号生命周期与安全审计，**应用层与 API 均严禁提供管理员查阅或统计其他用户笔记内容的入口**。
- 遵循 **ADR-01（正文落盘加密取舍）**：首版笔记正文明文落盘以完整发挥 SQLite FTS5 毫秒级检索优势并避免丢密钥变砖；但正文读写统一经过 `ContentCodec`，全文检索统一经过 `SearchService`，不在当前版本强行实现端到端零知识加密（E2EE）。
- 坚持**轻量单进程架构**：生产态由 Node.js + Hono 单进程同时托管前端静态构建产物与 `/api/*`，不拆分微服务，不默认引入 MySQL / PostgreSQL / Redis 等外部服务进程，除非有明确架构决策。

## 技术栈约定

- **运行时与语言**：Node.js `v26.13.0`+，全栈 TypeScript（`tsconfig.json` 必须开启 `strict: true`）。
- **前端框架与样式**：React 19 + Vite + Tailwind CSS v4。
- **富文本编辑器**：TipTap（ProseMirror 内核），原生集成 `Placeholder`、待办清单、代码块高亮、表格、自定义 Callout 提示卡与图片粘贴上传。
- **后端服务**：Hono（单进程同时提供 `/api/*` REST 接口与生产态前端静态资源托管）。
- **数据库**：**SQLite 3**（单文件 `data/airnote.db`），初始化必须开启：
  - `PRAGMA journal_mode = WAL;`
  - `PRAGMA foreign_keys = ON;`
  - `PRAGMA busy_timeout = 5000;`
  - 使用 FTS5（`tokenize = 'unicode61'`）实现标题与正文全文检索。
- **数据访问方式**：优先使用 Node 26 原生 `node:sqlite`（或明确选定的轻量 SQLite 封装），不默认引入 Prisma / TypeORM 等重型 ORM；表结构与索引以 [02-architecture-and-security.md](02-architecture-and-security.md) 为唯一事实来源演进。
- **契约与校验**：使用 **Zod** 在 `src/shared/` 中维护前后端共享的请求/响应类型与校验 Schema，禁止前后端各自维护一套易漂移的 DTO 定义。
- **认证与密码学**：
  - 密码哈希：**Argon2id**
  - 双因素认证（2FA）：`otpauth`（标准 RFC 6238 TOTP，SHA-1、6 位、30 秒周期）+ `qrcode`
  - 密钥与凭证保护：Node `crypto`（`AES-256-GCM` 加密 `totp_secret_enc`；`SHA-256` 哈希 Session Token；恢复码仅存哈希）
- **配置与敏感信息**：密钥、端口、Cookie 安全标志等通过 `.env` / 环境变量注入，禁止将生产 `.env`、主密钥、`data/airnote.db` 及用户上传附件提交进仓库。

## 项目约定

### 目录规范

采用「单仓一体化 + 前后端与共享契约清晰分层」结构，严格对齐 [04-development-roadmap.md](04-development-roadmap.md)：

```text
AirNote/
├── AGENTS.md                          # Agent 维护入口与核心红线速查
├── docs/                              # 产品、架构、UI/UX、开发规范与定稿原型
│   └── prototypes/                    # 交互原型（仅供视觉与交互参考，非生产代码）
├── data/                              # 运行时本地数据（必须加入 .gitignore）
│   ├── airnote.db                     # SQLite 主库（含 -wal / -shm）
│   ├── .master.key                    # 开发态自动生成的持久化主密钥（可选）
│   └── uploads/                       # 物理隔离附件目录 uploads/{user_id}/{uuid}
├── src/
│   ├── shared/                        # 前后端共享 TypeScript 类型、常量与 Zod Schema
│   ├── server/                        # Node.js v26 + Hono 后端
│   │   ├── index.ts                   # 服务启动入口
│   │   ├── app.ts                     # Hono 应用装配（API + 生产静态资源托管）
│   │   ├── config.ts                  # 环境变量与 MASTER_KEY 解析校验
│   │   ├── context.ts                 # 依赖注入上下文与统一 jsonError 工具
│   │   ├── db/                        # SQLite 初始化、建表与强制 user_id 隔离封装
│   │   ├── security/                  # Argon2id、AES-256-GCM、TOTP、ContentCodec、SearchService、审计、限流
│   │   ├── middleware/                # 安全头、CSRF、鉴权、管理员守卫
│   │   ├── routes/                    # Hono 路由定义（调用 db/scoped 与 security）
│   │   └── scripts/                   # CLI 运维脚本（init-admin.ts、backup.ts）
│   └── client/                        # React 19 + Vite + Tailwind v4 + TipTap 前端
│       ├── api/                       # 类型安全的 API 请求层
│       ├── stores/                    # 认证态、笔记树、主题与光效状态（useWorkspace.ts）
│       ├── styles/                    # 液态琉璃主题样式与动效（crystal.css）
│       ├── utils/                     # 动效与前端辅助工具（effects.ts）
│       └── components/                # 按领域拆分（auth/desktop/mobile/editor/modals/search/security/admin）
├── tests/                             # 单元测试、API 隔离与 2FA 集成测试
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── vitest.config.ts
└── .env.example
```

补充约定：

- `src/server/routes/` 保持轻量：负责参数接收、Zod 校验、调用 `db/scoped.ts` 与 `security/` 并返回统一 JSON 响应；仅在多路由复用或流程显著复杂时按需抽出独立服务模块，不提前制造空壳 `services/` 层。
- `src/server/db/scoped.ts` 统一封装强绑定 `user_id` 的数据访问方法；所有用户笔记/附件读写删查必须经此隔离层，禁止绕过隔离封装直接按 `id` 查库。
- `src/server/security/` 集中管理密码学、TOTP、限流、审计、`SearchService` 与 `ContentCodec`，禁止在业务代码中散落手写加解密逻辑。
- `src/client/api/` 统一处理请求发送、类型校验、错误映射与 `401` 失效拦截，组件内禁止散落裸 `fetch`。
- `docs/prototypes/` 仅作设计参考，**严禁**将原型顶部的「原型评审工具栏」或伪登录/角色切换入口带入正式代码，也不要整页硬编码复制静态 HTML/CSS。
- `data/` 目录（数据库文件、WAL 文件、`.master.key` 及上传附件）严禁纳入 Git 版本控制。

### 视图与路由约定

前端视图（对齐 [03-ui-ux-design-spec.md](03-ui-ux-design-spec.md)）：

- **未登录态**：全屏独立登录页（居中琉璃卡片，支持账号密码 → 可选 6 位 TOTP / 8 位备用恢复码平滑切换），底部提示「仅限受邀成员使用，如需账号请联系管理员」。
- **桌面端（`>= 768px`）**：无多余顶部大导航栏，采用悬浮间距三栏（左栏笔记本下拉与分区列表 + 底部用户头像菜单 / 中栏当前分区页面流 / 右栏编辑画布与沉浸专注模式）。
  - 左下角头像菜单统一收纳：`安全与 2FA 设置`、`切换深浅外观`、`光效强度（璀璨 / 柔和）`、`管理员控制台`（仅 `role === 'admin'` 渲染）、`退出登录`。
- **移动端（`< 768px`）**：无底部 Tab 栏，采用纯净四级钻取（`L1 笔记本` → `L2 分区` → `L3 页面` [点标题快切同本分区 + `⋯` 菜单] → `L4 编辑页` + 贴底拇指格式化栏），右上角头像呼出 Bottom Sheet。

后端 REST API（对齐 [02-architecture-and-security.md](02-architecture-and-security.md)）：

- **健康检查**：`GET /api/health`（无需登录）
- **认证与个人安全（`/api/auth/*`）**：
  - `POST /api/auth/login`、`POST /api/auth/verify-2fa`、`POST /api/auth/logout`
  - `GET /api/auth/me`、`POST /api/auth/change-password`
  - `POST /api/auth/2fa/setup`、`POST /api/auth/2fa/confirm`、`POST /api/auth/2fa/disable`
- **笔记与检索（全部强校验登录态与 `user_id`）**：
  - `GET/POST /api/notebooks`、`POST /api/notebooks/reorder`、`PATCH/DELETE /api/notebooks/:id`
  - `GET /api/sections`、`GET/POST /api/notebooks/:nbId/sections`、`POST /api/notebooks/:nbId/sections/reorder`、`PATCH/DELETE /api/sections/:id`
  - `GET/POST /api/sections/:secId/pages`、`POST /api/sections/:secId/pages/reorder`、`GET/PATCH/DELETE /api/pages/:id`
  - `GET /api/pages/pinned`、`GET /api/pages/trash`、`DELETE /api/pages/trash/empty`、`GET /api/pages/quick-search?q=...`
  - `GET /api/search?q=...`
  - `GET/POST /api/pages/:pageId/attachments`、`GET/DELETE /api/attachments/:id`
- **管理员控制台（`/api/admin/*`，强校验登录态 + `role === 'admin'`）**：
  - `GET/POST /api/admin/users`、`PATCH /api/admin/users/:id/status`
  - `POST /api/admin/users/:id/reset-password`、`POST /api/admin/users/:id/reset-2fa`
  - `GET /api/admin/audit-logs`

路由安全约束：

- 除健康检查（`GET /api/health`）、登录接口（`/api/auth/login`、`/api/auth/verify-2fa`）及前端登录页静态资源外，所有 `/api/*` 默认挂载鉴权中间件，未登录统一返回 `401`。
- `/api/admin/*` 统一挂载管理员角色守卫，非管理员访问返回 `403`。
- 附件严禁通过静态文件目录直接暴露，必须通过 `GET /api/attachments/:id` 校验 `attachment.user_id === session.userId` 后流式返回。

### 命名规范

- **TypeScript 类型、接口、类、React 组件**使用 `PascalCase`（如 `DesktopWorkspace`、`ContentCodec`、`AppConfig`）；TypeScript 接口不强加 `I` 前缀，保持全仓统一。
- **变量、函数、方法、Hooks、API JSON 字段**统一使用 `camelCase`；React Hooks 以 `use` 开头（如 `useWorkspace`）。
- **全局常量与环境变量**使用 `UPPER_SNAKE_CASE`（如 `MASTER_KEY`、`SESSION_TTL_DAYS`）。
- **SQLite 表名与列名**使用 `snake_case`（如 `totp_secret_enc`、`parent_page_id`、`sort_order`），统一在数据库访问层完成 `snake_case` ↔ `camelCase` 映射。
- **文件命名**：
  - React 组件文件使用 `PascalCase.tsx`（如 `DesktopWorkspace.tsx`、`SecurityModal.tsx`）。
  - 后端模块、工具函数与样式文件使用 `kebab-case`（如 `content-codec.ts`、`rate-limit.ts`、`crystal.css`）；前端 Hook/Store 保持与现有 `useWorkspace.ts` 一致的 `camelCase` 命名。
- **Schema 与类型配对**：Zod 校验器与推导类型语义明确，例如 `createPageSchema` + `CreatePageInput`。
- **界面交互文案**严格遵守 [01-product-requirements.md](01-product-requirements.md) 的统一规范：
  - 固定使用 **`添加笔记本`** / **`添加分区`** / **`添加页面`** / **`添加子页面`**，禁止混用「新建笔记本」「记一页」「新页面」等模糊文案。
  - 空页面正文 placeholder 固定为 **`随时记下此刻的想法...`**，空标题 placeholder 为 **`无标题页面`** / **`页面标题`**。

### 注释规范

- **导出类型、接口、字段、函数、服务方法、React 组件 Props 及关键位置必须写中文注释**，说明用途、约束或业务含义，禁止只写英文或无意义注释。
- 对外可见的类型、模块导出函数、类方法、中间件与 Zod Schema 优先使用 **JSDoc（`/** ... */`）**；函数内部关键分支与约束使用 `//` 补充。
- 以下关键位置必须有清晰中文注释：
  - `user_id` 强制数据隔离边界与防越权（IDOR）判断；
  - TOTP `±1` 时间步容错与 `totp_last_step` 防重放逻辑；
  - 登录与 2FA「IP + 账号」双维度限流与锁定规则；
  - Session 即时吊销触发条件（停用、改密、登出）；
  - SQLite WAL/外键初始化、FTS5 索引同步与软删除清理逻辑；
  - `ContentCodec` 编解码与 `encryption_ver` 演进约束；
  - 编辑器防抖自动保存与切页 flush 的竞态控制；
  - UI/CSS 关键避坑点（如避免覆盖定位属性、防 iOS 自动缩放、单次扫光触发条件）。
- 注释写「为什么 / 业务约束 / 边界条件」，避免逐行复述代码字面意思；修改逻辑时必须同步删改过时注释。

### 数据、安全与前端交互约定

**数据与隔离约定：**

- 每一条涉及笔记本、分区、页面、附件、FTS5 的单对象读写删查 SQL 都必须带 `AND user_id = ?`，严禁仅凭对象 `id` 查询或更新。
- 笔记正文读写统一经过 `ContentCodec.encode/decode`（`encryption_ver = 0` 为明文透传），保存时同步提取纯文本更新 `pages.content_text` 与 `pages_fts`。
- 页面删除默认软删除（`is_deleted = 1`）进入回收站，回收站页面不得出现在常规分区列表与常规搜索结果中；彻底删除页面或级联删除分区/笔记本时，必须同步清理 `pages_fts` 与 `data/uploads/{user_id}/` 下对应磁盘文件。
- 子页面通过 `parent_page_id` 维护层级，更新父子关系时须校验同属当前用户与同一分区，并防止形成循环引用。

**认证与 2FA 约定：**

- 登录 Cookie 必须设置 `HttpOnly`、`SameSite=Lax`，在 HTTPS 环境下启用 `Secure`；数据库仅保存 Token 的 SHA-256 哈希，不存明文。
- 2FA 为非强制自选：未开启时密码验证通过直接签发 Session；已开启时先签发 5 分钟短期 `challengeToken`，校验 6 位 TOTP 或 8 位恢复码通过后再签发正式 Session。
- 同一 TOTP 时间步验证成功后立即记录 `totp_last_step`，30 秒内禁止重放；8 组备用恢复码一次性消费，用过即标记 `used_at`。
- 管理员停用账号、重置密码或用户主动修改密码时，必须立即清除该用户在 `sessions` 表中的失效会话。
- 登录与 2FA 校验均须接入「IP + 账号」双维度限流（连续失败 5 次锁定 15 分钟）并写入审计日志。

**UI 与交互硬性避坑约定（来自 V4.1 原型验证）：**

- **禁止工具类覆盖定位**：自定义琉璃材质/按钮类（如 `.crystal-card`、`.btn-crystal`）不得无条件声明 `position: relative`，避免覆盖 `absolute` / `fixed` 导致下拉浮层撑开容器或悬浮按钮漂移。
- **克制扫光与双档光效**：主按钮扫光仅允许在进入页面/切换大视图时轻扫一次 + 悬停（Hover）时触发一次，**严禁无限循环扫光**；切换「柔和」光效时须自动关闭星芒粒子、环境星点与入场扫光。
- **真实 Placeholder**：新建空页面正文必须初始化为空 TipTap JSON 文档（`{"type":"doc","content":[]}`），提示语必须由 TipTap `Placeholder` 扩展渲染，严禁作为真实文本写入正文。
- **防抖自动保存防丢字**：编辑区停止输入 500–600ms 后自动保存并展示实时同步状态；切换页面或离开编辑页前必须先 flush 未保存改动，并处理请求乱序避免旧请求覆盖新内容。
- **桌面端浮层独立滚动**：笔记本切换下拉与底部用户菜单均须独立浮层化并设置 `max-h` 内部滚动，绝不挤压侧栏分区列表。
- **移动端触控与适配底线**：移动端所有 `<input>` 与编辑器字号不得低于 `16px`（防止 iOS Safari 聚焦自动放大）；所有可点按钮热区至少 `36×36px`（主操作建议 `44×44px`）；底部悬浮主按钮居中对齐并适配 `env(safe-area-inset-bottom)`；页面卡片与编辑页必须提供显式 `⋯` 菜单（Bottom Sheet）；移动端 2FA 绑定默认优先展示「一键复制 Base32 密钥」与 `otpauth://` 直连。

### 错误处理

- 后端统一使用 `src/server/context.ts` 中的 `jsonError(c, status, code, message, details?)` 返回结构化错误 JSON：`{ error: { code, message, details? } }`，并通过 `app.all('/api/*', ...)` 与 `app.onError` 统一兜底 `404` / `500`。
- 明确区分业务错误（`400` / `401` / `403` / `404` / `409` / `429`）与系统异常（`500`）；参数校验失败由 Zod `safeParse` 统一转换为可读的 `400`（`VALIDATION_ERROR`）响应，不要直接向客户端抛出裸 `Error` 暴露内部实现。
- 安全相关错误响应遵循最小暴露原则：
  - 登录失败统一提示「账号或密码错误」，不区分「用户不存在」与「密码错误」以防账号枚举；
  - 访问他人资源统一返回 `404`，避免泄露其他用户的对象 ID 是否存在。
- 严禁向浏览器返回堆栈跟踪、SQL 语句、服务器文件路径、密钥或环境变量。
- 前端请求层（`src/client/api/client.ts`）统一处理 `401`（清理登录态并回到登录页）、`429`（提示限流等待时间）与自动保存失败提示（保留本地编辑态并提供重试）。

### Git 提交规范

格式：

```text
<type>(<scope>): <description>
```

- `type`：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `style`
- `scope`：`auth` / `2fa` / `admin` / `notebook` / `section` / `page` / `editor` / `search` / `attachment` / `ui` / `mobile` / `db` / `security` / `shared` / `test` / `docs`
- `description`：尽可能使用中文，保持简短、明确、现在时

示例：

```text
feat(2fa): 支持用户自主开启与关闭 TOTP 双因素认证
fix(editor): 修复切换页面时防抖自动保存竞态丢字问题
docs(dev-guide): 制定 AirNote 开发规范与编码约定
```

一次提交包含多个功能或多项改动时，subject 概括主题，正文用 bullet 列出每一项：

```text
feat(mobile): 完成移动端四级钻取核心交互

- 新增 L1 笔记本书架与 L2 分区筛选列表
- 新增 L3 分区标题快切宫格与页面操作 Bottom Sheet
- 适配底部居中悬浮主按钮与安全区间距
```

补充：

- 一次提交只改一件事时，subject 一行说明即可。
- 一次提交包含多个功能时，必须使用 bullet 分条写出，避免把多项改动挤进同一行。
- 不在提交信息中包含 Codex / Agent 相关元信息。
- 严禁提交真实密钥、`.env`、`data/airnote.db` 及用户上传附件。

### 测试规范

- 使用 **Vitest** 编写单元测试与后端 API 集成测试（结合 Hono `app.request()` 直接验证完整中间件与路由链路），跨端关键界面交互可辅以浏览器视口（桌面宽屏 + 手机 `390×844`）验证。
- 新增功能必须补测试，至少覆盖核心正常路径、边界条件与异常/权限分支；修复缺陷必须补回归测试。
- **核心必测安全与隔离用例**：
  - **严格多用户隔离（IDOR）**：构造两个独立普通账号 A 与 B，验证 A 无法通过任何接口读取、修改、删除、移动、搜索或下载 B 的笔记本、分区、页面与附件；验证管理员端无任何读取他人笔记内容的接口。
  - **认证与 2FA 闭环**：验证未开 2FA 密码直登、开启 2FA 后必须验码、同一 30 秒时间步 TOTP 防重放、8 组备用恢复码一次性消费、连续错误 5 次触发限流、停用账号或修改密码后旧 Session 立即失效。
- 后端测试必须使用 `:memory:` 或独立的临时 SQLite 文件，禁止读写开发库 `data/airnote.db`；能 mock 的外部依赖（如系统时钟用于 TOTP 测试）不要依赖真实等待。
- 测试分组按模块/接口组织，用例描述明确「前置状态 + 动作 + 预期结果」。

### 日志规范

- 安全审计事件通过 `src/server/security/audit.ts` 持久化到 SQLite `audit_logs` 表，供管理员在后台分页查阅；服务端控制台输出保持简洁克制，仅记录启动信息与未捕获异常。
- 安全审计日志（`audit_logs`）必须覆盖：登录成功/失败、2FA 验证成功/失败、触发限流锁定、开启/关闭 2FA、修改密码、管理员创建/启用/停用用户、管理员重置密码/解绑 2FA。
- **禁止在任何日志中输出**：用户密码（明文或哈希）、Session Token、Cookie、`challengeToken`、`Authorization` 头、TOTP Secret（明文或密文）、8 组备用恢复码、主加密密钥（`MASTER_KEY`）、**用户笔记标题/正文内容及附件原文**。
- 生产环境严禁将用户隐私笔记内容打印到控制台或日志文件；后续若扩展访问日志中间件，须保持同样脱敏边界。

## 开发流程

### 本地开发

1. 拉取代码并确认分支状态，核对本机 Node.js 版本（`v26.13.0`+）。
2. 执行 `npm install` 安装依赖。
3. 复制 `.env.example` 为本地 `.env`，填入本地开发用的主加密密钥与端口配置（严禁把 `.env` 提交进仓库）。
4. 运行数据库初始化与管理员初始化 CLI（如 `init-admin`）创建首位超级管理员账号。
5. 启动本地前后端开发服务（Vite 开发服务器代理 `/api` 至 Hono 后端），确认登录页、桌面端三栏与移动端视口（`390×844`）均可正常访问。
6. 运行类型检查（`tsc --noEmit`）与自动化测试，确认核心链路与数据隔离测试全部通过。
7. 修改功能时同步更新：`src/shared/` 契约、后端路由/服务/隔离层、前端组件、测试与 `docs/` 文档。
8. 提交前检查代码格式、类型检查、测试结果、敏感文件与日志输出。

本地开发默认要求：

- 配置文件只保留 `.env.example` 模板，严禁将真实密钥、生产配置及 `data/` 目录提交入库。
- 需要变更 SQLite 表结构或索引时，先同步更新 [02-architecture-and-security.md](02-architecture-and-security.md) 与幂等建表/迁移脚本，并在干净库和存量库上验证迁移及 FTS5 同步。
- 前端页面参考 `docs/prototypes/ui-prototype-v4-final.html` 与 [03-ui-ux-design-spec.md](03-ui-ux-design-spec.md) 按 React 组件与 Tailwind v4 规范落地，避免整页硬编码复制。
- 生产发版前务必执行 `npm run build && npm start` 验证单进程静态资源托管与完整 API 联调；本地/生产备份统一使用内置热备份命令（`npm run backup`）或 `sqlite3 data/airnote.db ".backup ..."`。

### 功能交付检查清单

- [ ] 所有笔记、搜索与附件接口均已强制校验登录态与 `user_id` 数据隔离，跨用户隔离测试通过
- [ ] 管理员权限守卫已覆盖 `/api/admin/*`，普通用户不可见管理入口；管理员端不存在查看他人笔记的路由
- [ ] 账号登录、可选 2FA（绑定/验证/关闭/恢复码/防重放）、限流与 Session 即时吊销符合预期
- [ ] 编辑器空白提示使用 TipTap `Placeholder`（非真实文本），防抖自动保存与切页 flush 无丢字
- [ ] 桌面端三栏浮层、专注模式与移动端四级钻取（`390×844`）实测可用，无定位撑开与 iOS 自动放大
- [ ] 浅/深双主题、璀璨/柔和两档光效正常，主按钮扫光仅入场一次 + Hover 一次（无循环打扰）
- [ ] 全端统一文案符合规范（`添加笔记本` / `添加分区` / `添加页面` / `添加子页面`）
- [ ] 类型检查、单元测试与关键集成测试全部通过，日志与接口响应无敏感信息或用户正文泄露
- [ ] 相关架构、API、DDL 与路线图文档已同步更新（如有变更）
