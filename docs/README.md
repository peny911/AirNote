# AirNote 文档总目录

本目录完整沉淀 **AirNote** 网页版网络记事本在需求、架构、安全、UI/UX 及研发规划阶段的全部定稿资产，可直接作为正式开发的唯一事实来源（Single Source of Truth）。

---

## 文档索引

| 编号 | 文档 | 核心内容 |
| :--- | :--- | :--- |
| **00** | [design-and-dev-plan.md](./design-and-dev-plan.md) | 项目总览与已确认关键决策速查表 |
| **01** | [01-product-requirements.md](./01-product-requirements.md) | 产品定位、品牌命名、核心功能清单、账号与 2FA 策略、术语规范 |
| **02** | [02-architecture-and-security.md](./02-architecture-and-security.md) | 技术栈对比定稿、系统架构、SQLite 完整表结构 DDL、REST API 契约、加密取舍 ADR 与安全防线 |
| **03** | [03-ui-ux-design-spec.md](./03-ui-ux-design-spec.md) | 视觉设计系统、正式版导航架构、移动端四级 UE 规范、微交互规则与原型验证避坑清单 |
| **04** | [04-development-roadmap.md](./04-development-roadmap.md) | 工程目录结构、四阶段研发里程碑、核心验收用例、本地运行与备份指南 |
| **05** | [dev-guide.md](./dev-guide.md) | 开发规范与编码约定（技术栈、目录、路由、命名、注释、安全/UI 避坑、Git、测试、日志与交付清单） |
| **Agent** | [../AGENTS.md](../AGENTS.md) | 根目录 Agent 协作与维护入口（当前状态、常用命令、红线约束与文档索引） |

---

## 交互式 UI 原型（定稿）

- **V4.1 定稿原型（桌面端 + 移动端全交互）**：[prototypes/ui-prototype-v4-final.html](./prototypes/ui-prototype-v4-final.html)
  - 可直接在浏览器打开，顶部内置原型评审工具栏（正式版不包含），支持一键切换 `💻 桌面端 / 📱 手机端`、`已登录态 / 登录页`、`角色：管理员 / 普通成员`。
