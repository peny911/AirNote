# 04 · AirNote 开发路线图、工程规划与验收标准

## 1. 工程目录结构（单仓一体化）

```text
AirNote/
├── AGENTS.md                          # Agent 维护入口与核心红线速查
├── docs/                              # 设计方案、开发规范与交互原型
│   ├── README.md
│   ├── design-and-dev-plan.md
│   ├── 01-product-requirements.md
│   ├── 02-architecture-and-security.md
│   ├── 03-ui-ux-design-spec.md
│   ├── 04-development-roadmap.md
│   ├── dev-guide.md
│   └── prototypes/
│       └── ui-prototype-v4-final.html
├── data/                              # 运行时本地持久化目录（已加入 .gitignore）
│   ├── airnote.db                     # SQLite 主库（WAL + FTS5）
│   ├── .master.key                    # 开发态自动生成的持久化主密钥（可选）
│   └── uploads/                       # 隔离附件目录 uploads/{user_id}/{uuid}
├── src/
│   ├── shared/                        # 前后端共享 TypeScript 类型与校验 Schema (Zod)
│   │   ├── types.ts
│   │   └── validators.ts
│   ├── server/                        # Hono 轻量后端服务（Node.js v26）
│   │   ├── index.ts                   # 服务启动入口
│   │   ├── app.ts                     # Hono 应用装配（中间件、路由与生产静态托管）
│   │   ├── config.ts                  # 环境变量与 MASTER_KEY 加载
│   │   ├── context.ts                 # 类型上下文与统一 jsonError 响应工具
│   │   ├── db/
│   │   │   ├── client.ts              # SQLite WAL 初始化、建表与过期态清理
│   │   │   └── scoped.ts              # 强制 user_id 数据隔离查询封装
│   │   ├── security/
│   │   │   ├── password.ts            # Argon2id 哈希与校验
│   │   │   ├── crypto.ts              # AES-256-GCM（TOTP Secret 加密）
│   │   │   ├── totp.ts                # RFC 6238 TOTP 与恢复码
│   │   │   ├── content-codec.ts       # 正文编解码预留抽象（v0 明文透传）
│   │   │   ├── search-service.ts      # FTS5 全文检索封装
│   │   │   ├── audit.ts               # 安全审计日志写入
│   │   │   └── rate-limit.ts          # IP + 账号登录/2FA 速率限制
│   │   ├── middleware/
│   │   │   ├── auth.ts                # Session、CSRF 与安全响应头中间件
│   │   │   └── admin.ts               # 管理员角色守卫
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── notebooks.ts
│   │   │   ├── sections.ts
│   │   │   ├── pages.ts
│   │   │   ├── search.ts
│   │   │   ├── attachments.ts
│   │   │   └── admin.ts
│   │   └── scripts/
│   │       ├── init-admin.ts          # 首次初始化超级管理员 CLI
│   │       └── backup.ts              # SQLite WAL 在线热备份 CLI
│   └── client/                        # React + Vite + Tailwind + TipTap 前端
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles/crystal.css         # 冰晶晨露 / 星钻夜幕主题与微光动效
│       ├── api/client.ts              # 类型安全 API 请求层
│       ├── stores/useWorkspace.ts     # 认证态、笔记树、主题与光效状态
│       ├── utils/effects.ts           # 光效与交互动效工具
│       └── components/
│           ├── BrandLogo.tsx
│           ├── auth/                  # 独立登录页 & 6位 TOTP 输入
│           ├── desktop/               # 悬浮琉璃三栏、下拉浮层、用户菜单
│           ├── mobile/                # 四级钻取（L1 笔记本 / L2 分区 / L3 页面 / L4 编辑）& Bottom Sheets
│           ├── editor/                # TipTap 富文本编辑器（Placeholder + 工具栏 + 斜杠菜单 + Callout）
│           ├── modals/                # 笔记本/分区/页面管理弹窗
│           ├── search/                # ⌘K / 移动端全局速搜弹窗
│           ├── security/              # 自选 2FA 开关、绑定与强制改密弹窗
│           └── admin/                 # 管理员成员控制台弹窗
├── tests/                             # 四阶段 Vitest 自动化集成与安全隔离测试
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── vitest.config.ts
└── .env.example
```

---

## 2. 四阶段研发里程碑（均已落地）

### 阶段一：工程底座、认证体系与管理员后台（已完成）
- 初始化 `package.json`（TypeScript、React 19、Vite、Tailwind v4、Hono、Zod、Argon2、otpauth、qrcode）。
- 搭建 SQLite WAL + FTS5 建表脚本与 `init-admin` 管理员初始化命令。
- 完成登录/登出、Session 存库与即时吊销、速率限制、修改密码。
- 完成「自主开启/关闭 2FA」完整闭环（QR 码 + Base32 复制 + 6 位验证 + 8 组恢复码 + 防重放）。
- 完成管理员成员控制台（创建账号生成临时密码、启用/停用、重置密码、解绑 2FA、审计日志）。

### 阶段二：核心笔记工作台（桌面端 + 移动端四级 UE）（已完成）
- 完成笔记本、分区、页面（含子页面、星标、回收站、跨分区移动、排序）后端 API 与严格 `user_id` 隔离层。
- 1:1 还原 V4.1 视觉规范：冰晶晨露/星钻夜幕双主题、璀璨/柔和两档光效、按钮入场一次性扫光 + 悬停扫光、鼠标追光折射、微光粒子反馈。
- 实现桌面端悬浮三栏（含专注模式、独立悬浮笔记本下拉与左下角头像菜单）。
- 实现移动端纯净四级钻取（L1 笔记本书架 → L2 当前本分区纵向列表+筛选 → L3 分区页面流+点标题快切宫格+`⋯`操作菜单 → L4 沉浸编辑页+贴底拇指栏）及底部居中悬浮主按钮。

### 阶段三：TipTap 富文本编辑器与 FTS5 全文检索（已完成）
- 集成 TipTap（StarterKit、Placeholder、TaskList/TaskItem、CodeBlockLowlight、Table、自定义 Callout 提示卡、Image 粘贴上传）。
- 实现 500ms 防抖无感自动保存 + 同步状态指示。
- 实现附件隔离上传/下载（`data/uploads/{user_id}/`）。
- 接入 SQLite FTS5 同步触发器与 `⌘K` / 移动端全局速搜。

### 阶段四：全面测试、安全验收与部署交付（已完成）
- **功能与隔离测试**：创建两个独立普通账号（A 与 B），自动化测试验证 A 无法通过任何 API 读取/修改/删除/搜索/下载 B 的笔记本、分区、页面与附件；验证管理员后台不存在任何读取他人笔记的路由。
- **2FA 安全测试**：验证未开 2FA 直接密码登录、开启后必须验码、错误码限流、同码 30 秒内防重放、备用恢复码一次性消费、手机端禁用后无法用旧 Session 访问。
- **跨端 UI 验证**：在桌面宽屏与手机视口（390×844）实测所有流程，确认无定位撑开、无 iOS 聚焦放大、无真实文案占位符问题。
- **运维交付**：提供 `npm run build && npm start` 单进程启动脚本、`.env.example` 配置说明与 SQLite 在线热备份命令（`sqlite3 data/airnote.db ".backup ..."`）。

---

## 3. 运行环境与维护入口

- **验证环境**：macOS + Node.js `v26.13.0`（最低要求 Node.js `>= 22.13` 原生 `node:sqlite`）。
- **服务默认端口**：固定为 **`3100`**（`http://127.0.0.1:3100`，可在 `.env` 中通过 `PORT` 覆盖；开发态 Vite `http://localhost:5173` 自动代理 `/api` 至 `127.0.0.1:3100`）。
- **当前状态**：四个研发阶段与 `tests/phase1`–`phase4` 自动化验收均已完成，进入持续维护期；日常改动请以根目录 [AGENTS.md](../AGENTS.md) 与 [dev-guide.md](./dev-guide.md) 为准。
