# AirNote 设计与开发总方案（定稿速查）

> 本文为快速总览；完整分册文档请见 [docs/README.md](./README.md)：
> - [01 · 产品需求规格书](./01-product-requirements.md)
> - [02 · 系统架构、数据库 DDL 与安全设计](./02-architecture-and-security.md)
> - [03 · UI/UX 设计规范与移动端四级 UE](./03-ui-ux-design-spec.md)
> - [04 · 开发路线图与验收标准](./04-development-roadmap.md)
> - **交互原型（V4.1 定稿）**：[prototypes/ui-prototype-v4-final.html](./prototypes/ui-prototype-v4-final.html)

---

## 已锁定关键决策一览

| 决策项 | 定稿结论 |
| :--- | :--- |
| **产品名称** | **`AirNote`**（纯英文、含 `Note`、不绑定视觉光效） |
| **核心功能** | 类 Microsoft OneNote 三级结构（笔记本 → 分区 → 页面/子页面）、星标置顶、回收站、富文本自动保存、`⌘K` 全文速搜 |
| **账号与隔离** | 强制登录、禁止自助注册、仅管理员创建/停用/重置账号；严格用户级 `user_id` 数据隔离，应用层不提供管理员查阅他人笔记功能 |
| **2FA 策略** | **非强制，用户登录后自主开启/关闭**；标准 TOTP（兼容 Google / Microsoft Authenticator）+ 8 组一次性备用恢复码 + 防重放与速率限制 |
| **技术栈** | **TypeScript 全栈轻量单进程**：`React 19 + Vite + Tailwind CSS v4 + TipTap` + `Node.js v26 + Hono + SQLite (WAL + FTS5)` |
| **存储与加密** | 密码 Argon2id 哈希、TOTP Secret AES-256-GCM 加密、Session 存库哈希；**笔记正文暂不落盘加密**（换取原生 FTS5 极速检索与零丢密钥风险），数据库预留 `encryption_ver` 与 `ContentCodec` 扩展口 |
| **视觉与动效** | 「晶莹剔透 · 琉璃微光」双主题（冰晶晨露 / 星钻夜幕）+ 两档光效（璀璨 / 柔和）；主按钮**进入页面扫光一次 + 悬停扫光**（无循环打扰）；编辑区空白提示采用真实 `placeholder` |
| **正式导航** | 桌面端无顶部大导航栏，个人头像菜单统一收纳安全/外观/管理后台（仅 Admin 可见）/退出；移动端无底部 Tab 栏，采用 **L1 笔记本 → L2 分区 → L3 页面（点标题快切分区）→ L4 沉浸编辑** 纯四级钻取，底部居中悬浮主按钮统一文案为 **`添加笔记本` / `添加分区` / `添加页面`** |
