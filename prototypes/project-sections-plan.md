---
template: doc
title: Pi Web 项目 Section 方案
subtitle: 提案与交互原型 · 尚未批准产品实现
---

推荐在现有会话侧栏增加一层项目分类。每个项目最多属于一个 Section；未分配的项目留在「未分组」。这只改变侧栏组织方式，不移动项目目录，不修改 pi 会话文件。

## A 范围与前置冲突

- 做：创建、重命名、排序、折叠、删除 Section；项目移入、移出和跨 Section 移动。
- 不做：嵌套 Section、一个项目属于多个 Section、批量移动、独立管理页面、按 Section 删除项目或会话。
- 原型的「标准」「紧凑」「强调层级」只用于比较外观；推荐「标准」，不新增正式设置。
- 最小方案：只用项目菜单移动，不做跨 Section 拖动。推荐方案补上标题拖放，因为侧栏本来就支持拖动项目。
- `CONTRIBUTING.md` 将现有范围以外的会话管理列为不纳入范围，并要求先讨论。产品实现前须确认：本地定制并明确偏离该范围，还是先按项目流程讨论。本文和原型不代表该冲突已解决。
- 不自动创建 issue、不提交代码、不发布。

## B 界面与交互

```flow LR
项目菜单 -> 选择 Section: 移入或移出
选择 Section -> 未分组: 移出
Section 标题 -> 重命名: 菜单
Section 标题 -> 上移或下移: 菜单
Section 标题 -> 删除确认: 菜单
删除确认 -> 未分组: 确认删除
```

- 会话树依次显示全局置顶会话、全局置顶项目、自定义 Section、未分组项目。没有自定义 Section 时保留现在的列表外观。
- 「新建 Section」放在侧栏底部，紧邻「打开其他项目」。项目菜单增加「移动到 Section」，包括「未分组」和各 Section；可从该菜单新建并同时移入项目。
- 桌面与触屏可将未置顶项目拖到 Section 标题或「未分组」标题；放置后移到目标顶部并展开目标。菜单完成同一操作，支持键盘。Section 内项目仍可沿用原有拖动排序。
- 已置顶项目始终在顶部显示，仍保留 Section 归属；通过项目菜单改变归属。取消置顶后回到对应 Section 的顶部。置顶项目显示所属 Section 的简短标签；空间不足时截断并保留完整提示。
- Section 菜单提供重命名、上移、下移、删除。删除前显示受影响项目数；确认后这些项目归入「未分组」，已置顶项目仍在顶部。不会停止任务、删除会话或改动目录。
- Section 标题计数只包括当前在该 Section 内显示的未置顶项目；折叠时汇总这些项目的运行、等待和未读状态。归档页面与全局置顶会话保持现状。
- 新项目默认未分组。只有归档会话或只有置顶会话的项目不因分类而强制出现在主树；其归属保留，项目重新出现时生效。搜索仍搜索现有会话和项目内容，不按 Section 名称扩展搜索。
- 空 Section 保留，并显示移入提示。名称去除首尾空白，限制为 1–80 个 Unicode 字符的单行文本；拒绝完全相同的名称和系统名称「未分组」「未分組」「Ungrouped」。

## C 数据与接口

```flow LR
侧栏操作 -> SessionSidebar
SessionSidebar -> useSessionUiState: 排队与乐观更新
useSessionUiState -> /api/sessions/ui-state: POST 单个操作
/api/sessions/ui-state -> UI 状态文件: 加锁原子写入
useSessionUiState -> buildSessionTree: 生成行
buildSessionTree -> SessionTree: 虚拟化显示
```

- 扩展 `<agentDir>/pi-web-session-state.json` 的两个顶层字段：`sections` 为按显示顺序排列的 `{ id, name }` 数组；`projectSections` 为 `projectKey` 到 Section ID 的映射。缺失映射表示未分组。
- 继续使用现有 `projectOrder`。普通项目按 Section 过滤后维持相对顺序；移动到另一 Section 时，在一次写入中同步更新归属与目标顶部位置。置顶项目原有全局排序不因归属变化而改变。
- 在 `POST /api/sessions/ui-state` 增加 `create-section`、`rename-section`、`delete-section`、`move-section`、`assign-project-section`。创建请求可带 `projectKey`，原子完成创建和移入；排序请求使用相邻 Section ID 与 before/after。现有请求和响应字段保持可用。
- Section ID 由客户端生成，沿用现有临时 ID 的生成策略，供乐观更新和重放使用。名称冲突返回 409 `duplicate-section`；目标不存在返回 409 `missing-section`。容量已满或锁定沿用 409 `full` / `locked`。失败时显示错误并按服务端状态回滚。
- Section 和映射分别限制 1000 项、UTF-8 JSON 256 KiB；超过限制拒绝新写入，不挤掉已有项目。沿用现有文件 4 MiB 读取上限与原子写入。
- Section 折叠偏好保存在浏览器本地，分类、顺序和归属保存在服务端，供多个浏览器共享。无新服务、运行依赖、账号、令牌或用户配置项。

## D 兼容、失败与回退

- 当前服务端写入会保留未知顶层字段，已有测试覆盖。新字段因此放在顶层，不塞进旧服务端会规范化重写的 `projects` 对象。
- 回退到当前旧版后，Section 不显示；旧版的普通状态写入保留两个新字段。再次升级后分类可恢复；旧版期间调整全局项目顺序，恢复后仍会反映在 Section 内顺序上。
- 不把新旧服务端混在同一访问入口：旧服务端不认识新操作，且 GET 不返回新字段。误连旧版时请求会失败，磁盘上保留的分类可在切回新版后恢复。
- 依靠现有状态锁、修订号、跨窗口刷新和写入失败回滚。删除 Section 是一次原子操作；取消删除不改变状态。文件本身仍需沿用现有备份方式。
- 最脆弱的假设：用户接受「置顶项目显示在顶部而不在 Section 内重复显示」。如果不接受，就必须调整置顶规则或允许重复显示，不能只改视觉样式。

## E 需要修改的代码

涉及超过 8 个文件，按一个完整可用的变更交付：

- 状态与接口：`lib/session-ui-state-shared.ts`、`lib/session-ui-state.ts`、`app/api/sessions/ui-state/route.ts` 和对应测试。
- 树与拖放：`lib/session-tree.ts`、`hooks/useGroupDrag.ts`、`components/SessionTree.tsx` 和对应测试。
- 交互与偏好：`components/SessionSidebar.tsx`、`lib/sidebar-actions.ts`、`lib/sidebar-prefs.ts`、`app/sidebar.css` 和对应测试。
- 文案与验收：`lib/i18n/messages/en.ts`、`zh-CN.ts`、`zh-TW.ts`、`e2e/sidebar.mjs`、`e2e/run.mjs`、`docs/agents/sessions.md`。
- 复用 `SidebarMenu`、现有 toast、状态队列、虚拟行和指针拖放，不增加运行时依赖。React 官方 `useOptimistic` 只管理待处理操作的乐观状态，不能替代现有跨窗口修订和请求队列；Next.js 的 Route Handlers 支持沿用现有 GET/POST 接口。

## F 验证与交付

- 单元测试：旧状态读取、新字段规范化、重名和容量拒绝、原子创建与移入。还要覆盖移动、删除、排序、置顶、归档、并发窗口和旧版兼容。
- 树与交互测试：空 Section、无 Section、折叠摘要、运行或等待的会话、选中项目、键盘焦点、触屏长按、拖放取消和虚拟化长列表。
- 浏览器验收：桌面和手机完成创建、重命名、移动、移出、删除、排序；刷新及另一窗口确认分类一致；确认项目目录、会话文件和运行状态不变。测试使用临时会话目录，不使用真实数据。
- 命令：`npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint`。在没有活动 dev server 的独立工作区执行 `npm run test:e2e`；不要在开发目录运行 `next build`。
- 本次原型验证：94 项现有状态与树单元测试通过；Playwright 验证了桌面核心操作和手机菜单移动。原型使用示例数据，刷新会重置。
- 原型只模拟桌面拖放；手机拖放手势和虚拟化列表需在产品实现后另行验证。
- 真实服务的本地页面要求登录；本次没有读取真实会话。原型依据仓库源码、现有截图和主题变量制作，尚未与已登录的实时界面逐像素核对。
- 工作量估计：中等偏大，约 3–5 个工程日，取决于拖放与虚拟化测试结果。实施前重新检查工作区中其他未提交改动。

## G 参考与待确认

- 现有规则：`CONTRIBUTING.md`；`docs/agents/sessions.md` 的 Session sidebar 章节。
- 实现依据：`lib/session-tree.ts`、`lib/session-ui-state-shared.ts`、`lib/session-ui-state.ts`、`hooks/useSessionUiState.ts`。
- 官方资料：[React useOptimistic](https://react.dev/reference/react/useOptimistic)；[Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)。
- 原型：`prototypes/project-sections.html`；截图：`prototypes/project-sections-desktop.png`、`prototypes/project-sections-mobile.png`。

```ask
后续实现按哪个范围推进？
* 先讨论 | 先按项目流程讨论，再决定是否实现。
- 本地定制 | 明确接受与项目贡献范围的偏离。
```
