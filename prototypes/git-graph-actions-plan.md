---
template: doc
lang: zh
title: Git Graph 节点、分支与 Tag 操作方案
subtitle: 基于现有实现和 vscode-git-graph 源码 · 待范围确认
style: off
---

> **结论**：保留现有提交详情；为提交、分支、远程分支和 Tag 提供各自的操作菜单。推荐引用标签单击开菜单，提交单击仍查看详情。原型只模拟交互，不执行 Git 命令。

## 现状、依据与范围冲突

| 项目 | 已核实的事实 |
| --- | --- |
| 当前实现 | `components/git-graph/GitGraphView.tsx` 中，整行单击选中提交；引用标签只是 `span`。提交详情和历史 Diff 已有。 |
| 现有服务 | `app/api/git/graph/route.ts` 只有 GET，提供提交列表、详情和历史文件 Diff；没有 Git 写操作。 |
| 参考实现 | [Git Graph README](https://github.com/mhutchie/vscode-git-graph/blob/d7f43f429a9e024e896bac9fc65fdc530935c812/README.md#features) 明确通过右键操作提交、分支、Tag；单击提交查看详情。 |
| 参考细节 | [菜单定义](https://github.com/mhutchie/vscode-git-graph/blob/d7f43f429a9e024e896bac9fc65fdc530935c812/web/main.ts#L969-L1475) 按对象类型区分操作；[事件](https://github.com/mhutchie/vscode-git-graph/blob/d7f43f429a9e024e896bac9fc65fdc530935c812/web/main.ts#L2202-L2346) 中标签单击不选提交，分支双击可检出。 |
| 规范冲突 | `CONTRIBUTING.md:19` 将 Git 客户端能力、提交历史列为项目范围外；当前仓库已有 Git Graph 和历史 Diff。用户要求继续扩展与该贡献规范冲突。 |

**决策门槛**：本方案仅供评审，不修改业务代码。若作为本仓库定制功能实施，应由维护者明确接受该范围例外；若要向上游贡献，先取得维护者对范围的同意。不能仅凭现有 Git Graph 推断该规范已经失效。

## 交互模型

```flow
提交行 -> 提交详情: 单击或 Enter
提交行 -> 提交菜单: 右键或 ⋯
引用标签 -> 对应引用菜单: 单击或右键
对应引用菜单 -> 确认或输入: 修改操作
确认或输入 -> 重新检查并执行: 确认
重新检查并执行 -> 图谱与文件刷新: 成功
重新检查并执行 -> 错误或冲突提示: 失败
```

- **推荐 A**：单击提交行或节点展开／收起详情；右键行或点行尾 `⋯` 打开提交菜单。单击或右键分支、远程分支、Tag 打开对应菜单；标签阻止冒泡，不切换详情。
- **方案 B**：桌面与参考项目接近，标签右键开菜单；触屏和键盘激活标签开菜单。缺点是桌面入口较隐蔽。
- **方案 C**：先选提交或标签，再通过详情栏的操作按钮打开菜单。入口清楚，但多一步。
- 不采用参考项目的分支双击立即检出：单击已经用于开菜单，双击易误改 worktree。当前 `HEAD` 标记只展示状态，不提供分支操作。
- 菜单复用 `components/SidebarMenu.tsx` 的 point／rect 锚定、viewport 边界和 `role="menu"` 规则；桌面靠近目标，手机使用底部菜单。选中项、`Escape`、外部点击、焦点返回均有明确行为。
- 提交行的 `⋯` 在鼠标悬停、焦点所在行和移动端可见。键盘用户可聚焦引用标签；菜单使用方向键和 Enter。菜单放在虚拟行之外，滚动导致目标离开时关闭并把焦点还给图谱区域。
- 原有列宽、横向滚动、搜索、提交详情、历史 Diff 标签页行为不改变。搜索结果改变或项目／worktree 改变时关闭菜单。

## 功能清单与交付顺序

三个阶段分别可交付。阶段 1 单独上线即可使用；后续阶段不改变它的公开接口含义。

| 对象 | 操作 | 阶段 | 关键条件 |
| --- | --- | --- | --- |
| 提交 | 复制完整 SHA／标题；从此提交创建分支；添加轻量或附注 Tag | 1 | 完整 SHA 由图谱数据提供；名字使用 Git 校验。 |
| 本地分支 | 检出、重命名、删除、下载 ZIP 归档、仅显示该分支、复制名称 | 1 | 当前分支不提供检出或删除；删除只用安全删除，不提供强制删除。 |
| Tag | 查看附注 Tag 详情、删除本地 Tag、下载 ZIP 归档、复制名称 | 1 | 轻量 Tag 不显示附注详情；删除只影响本地。 |
| 提交 | 检出提交、Cherry-pick、Revert、Merge、Rebase、Reset | 2 | 明示当前分支、目标提交和风险；merge commit 的 Cherry-pick／Revert 必须选主父提交。 |
| 本地分支 | 合并进当前分支、将当前分支 Rebase 到此分支 | 2 | 当前分支不能以自身为目标；操作方向写在确认框。 |
| 远程分支 | 检出为本地跟踪分支、合并、拉取、抓取到本地分支、删除远程分支、下载 ZIP、复制名称 | 3 | 选择真实 remote；存在歧义或无效 symbolic HEAD 时禁用对应动作。 |
| 本地分支／Tag | 向所选 remote 推送 | 3 | 首版只支持普通推送；分支可明确选择是否设置 upstream，不提供强推。 |

上述阶段覆盖截图中的 Checkout、Rename、Delete、Merge、Rebase、Push、Create Archive、分支筛选和复制。`Create Archive` 定义为下载该引用内容的 ZIP，不创建隐藏分支或改变仓库。当前筛选器只能选择一个本地分支，因此用「仅显示此分支」及「显示全部分支」，不假装支持上游的多选／取消单个分支。

**明确不做**：stash、未提交节点、提交间对比、Drop commit、强制删除、强制推送、PR／Issue 集成、多 remote 批量推送、自动冲突解决、交互式 rebase 和新的 Git 配置页面。这些是参考项目的其他能力，不在本次范围。Reset 的 hard 模式在阶段 2 明确提供，不等同于安全删除；默认 soft，必须二次确认 hard 丢弃暂存和工作区修改。

## Git 执行语义与失败处理

| 操作 | 服务端执行策略 |
| --- | --- |
| 创建分支、Tag | `git branch` 从完整 commit SHA 创建；`git tag` 创建轻量 Tag，附注 Tag 使用 `-a -m`。均不覆盖已有名称。 |
| 本地检出／改名／删除 | 使用 `git switch --no-guess`、`git branch -m`、`git branch -d`、`git tag -d`；不使用 force。分支被其他 worktree 占用时提示具体 worktree，保持 Git 的拒绝。 |
| 检出提交 | 使用 `git switch --detach`，确认框说明 detached HEAD。 |
| Merge／Rebase | 在当前 worktree 执行；确认框显示「目标 → 当前分支」或「当前分支 → 基底」。禁用交互式 rebase，不启用 force。 |
| Cherry-pick／Revert | 对 merge commit 的每个父提交显示 SHA 与序号，要求选择 `-m` 主父提交；普通 commit 不传 `-m`。通过 Git 的非交互编辑选项避免等待编辑器。 |
| Reset | 允许 soft／mixed／hard，默认 soft；hard 额外显示不可恢复的工作区丢失警告，确认必须明确选择 hard。 |
| 归档 | `git archive --format=zip <完整引用>` 流式响应下载；不写服务器项目目录。 |
| 远程操作 | 执行前确认 remote 和精确分支或 Tag；普通 push 不加 force。继承现有 Git 凭据配置，不收集密码、Token 或新建密钥。服务端设置 `GIT_TERMINAL_PROMPT=0`，本地操作超时 30 秒，远程操作超时 60 秒；认证失败时提示使用已有终端处理。 |

所有服务端命令使用 `execFile`／`spawn` 的参数数组，禁止将输入拼成 shell 命令。分支和 Tag 名由 `git check-ref-format` 校验，操作目标由服务端按完整引用重新解析；同名 branch／tag 不互相替代。确认提交前重新检查目标是否仍指向页面展示的提交，变化时返回 409，要求刷新后重新确认。

Git 可能因未提交改动、worktree 占用、签名、认证或 hooks 拒绝操作。对于 merge／rebase／cherry-pick／revert 冲突，保留 Git 留下的状态；用 `git diff --name-only --diff-filter=U -z` 列出冲突文件，显示该操作对应的 `--continue`／`--abort` 命令，并提供打开现有终端的入口。不自动 abort，也不声称失败一定没有改动。本地操作超时时提示检查 worktree 状态；远程请求超时或断线时显示「结果未确认，先检查远端」。不自动重试。远程 URL 和错误输出中若含凭据，不回传或记录明文。

检出、合并、rebase 和 reset 会改动当前 worktree，可能影响正在使用该目录的 Agent、编辑器或终端；确认框必须明确提示，不能承诺能检测到所有外部进程。Git 本身可能执行仓库配置的 hooks、filters 或凭据助手；界面不承诺操作是纯数据修改。

## 数据、API 与权限

- **结构化引用**：现有 `parseGitRefs()` 根据 `%D` 缩写和 remote 前缀猜测类型；本地分支名也可能以 `origin/` 开头。通过 Git 完整引用及 `for-each-ref` 构建 `refs/heads/`、`refs/remotes/`、`refs/tags/` 元数据，关联到 commit。保留 `GitGraphRef.type`、`name` 和现有 GET 字段；新增 `fullName`、目标 commit SHA、Tag 类型等字段，不改变既有消费者。`HEAD`、符号引用、轻量 Tag 和附注 Tag 分开处理。
- **操作接口**：新增 `POST /api/git/graph/actions`，JSON 使用受限 action 联合类型：`branch-create`、`tag-create`、`branch-checkout`、`branch-rename`、`branch-delete`、`tag-delete`、`commit-checkout`、`cherry-pick`、`revert`、`merge`、`rebase`、`reset`、`remote-checkout`、`branch-push`、`tag-push`、`remote-fetch`、`remote-pull`、`remote-delete`。请求含 `cwd`、`action`、目标完整引用或完整 SHA，以及各动作所需的名字、mainline、mode、remote；服务端按 action 精确校验字段，不接收任意 Git 参数。分阶段只启用已交付的 action。
- **详情与下载**：新增 `GET /api/git/graph/tag?cwd=&ref=` 读取附注 Tag 元数据；新增 `GET /api/git/graph/archive?cwd=&ref=` 下载 ZIP。保留现有 `/api/git/graph` GET 请求和响应字段，旧客户端继续工作。
- **授权边界**：沿用 `proxy.ts` 的同源／认证检查，验证 cwd 和实际仓库根目录都在 `getAllowedFileRoots()` 中，且现存路径通过 `isExistingFilePathAllowed()`。当前 GET 只检查 cwd；新写操作不可把一个允许的子目录升级为整个未授权仓库的写权限。仓库根未授权时提示先在 Pi Web 选择仓库根。
- **返回契约**：成功返回 `{ ok: true }`；错误返回 `{ ok: false, code, error }`，可附 `worktreePath` 或 `conflictFiles`。稳定映射：400 `invalid_request`、403 `forbidden`、404 `not_found`、409 `stale_target`／`worktree_in_use`／`git_conflict`，执行失败 500 `git_failed`，超时或远程结果未确认 504 `result_unknown`。`error` 可安全展示，不通过匹配英文文案判断类型。
- **刷新**：成功后重新加载 Git Graph；涉及工作区的操作同时通知 `AppShell` 更新 `explorerRefreshKey`，并调用 `sidebarControlRef.current?.refreshWorktrees()`；服务端调用 `invalidateProjectCache()`，避免侧栏继续显示旧分支。失败但工作区可能改变时也刷新，并保留冲突提示。图谱选中提交、搜索和滚动尽量保留，目标已不存在时清除选择。
- **权限与配置增量**：不要求用户新增环境变量、依赖、服务或独立配置。远程操作依赖用户已经配置好的 Git remote 和凭据；没有配置时在界面明确禁用或报告失败。

操作请求字段固定如下；`sha` 是完整 commit SHA，`ref` 是服务端返回的完整 Git 引用，`expectedTargetSha` 和 `expectedHead` 是确认框打开时展示的值。服务端验证 SHA 和引用类型，目标或 HEAD 发生变化时返回 `stale_target`。本地缓存的远程跟踪引用只能代表上次抓取的结果；Pull 明示会抓取远端最新状态。

| action | 额外字段 |
| --- | --- |
| `branch-create` | `sha`、`name` |
| `tag-create` | `sha`、`name`、`tagType: lightweight｜annotated`；附注 Tag 还需 `message` |
| `branch-checkout` | `ref`、`expectedTargetSha`、`expectedHead` |
| `branch-rename` | `ref`、`expectedTargetSha`、`name` |
| `branch-delete`、`tag-delete` | `ref`、`expectedTargetSha` |
| `commit-checkout` | `sha`、`expectedHead` |
| `cherry-pick`、`revert` | `sha`、`expectedHead`；merge commit 还需 `parentNumber` |
| `merge`、`rebase` | `target` 为完整 SHA 或完整分支引用、`expectedTargetSha`、`expectedHead` |
| `reset` | `sha`、`expectedHead`、`mode: soft｜mixed｜hard` |
| `remote-checkout` | 远程跟踪 `ref`、`expectedTargetSha`、`expectedHead`、`name` |
| `branch-push` | 本地分支 `ref`、`expectedTargetSha`、`remote`、`setUpstream: boolean` |
| `tag-push` | Tag `ref`、`expectedTargetSha`、`remote` |
| `remote-fetch` | 远程跟踪 `ref`、`expectedTargetSha`、`remote`、`name`（已有本地分支） |
| `remote-pull` | 远程跟踪 `ref`、`expectedTargetSha`、`expectedHead`、`remote` |
| `remote-delete` | 远程跟踪 `ref`、`expectedTargetSha`、`remote` |

## 实施位置与维护成本

变更将超过 8 个文件，属于较大的功能增量，而非仅加菜单：

| 位置 | 职责 |
| --- | --- |
| `components/git-graph/GitGraphView.tsx` | 行和引用的事件分派、菜单目标、刷新与焦点；保留现有虚拟列表。 |
| `components/git-graph/GitGraphActions.tsx` | 组合现有 SidebarMenu、确认框和动作表单；不再发明第二套菜单定位。 |
| `components/git-graph/GitGraphDetails.tsx`、`components/AppShell.tsx` | 详情入口及 worktree／文件刷新回调。 |
| `lib/git-types.ts`、`lib/git-graph.ts` | 向后兼容的结构化引用、Tag 元数据和 commit 关联。 |
| `lib/git-graph-actions.ts` | action 输入校验、真实 Git 执行、worktree／冲突处理；按动作分组而非任意命令入口。 |
| `app/api/git/graph/actions/route.ts`、`tag/route.ts`、`archive/route.ts` | 权限校验、类型化接口、ZIP 下载。 |
| `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | 三种语言的菜单、确认、状态和错误文案。 |
| `lib/git-graph*.test.mjs`、`app/api/git/graph/**/*.test.mjs`、`e2e/git-graph-actions.mjs` | 真实临时仓库、接口安全和浏览器交互回归。 |
| `docs/agents/sessions.md`、`docs/agents/files-and-access.md` | 记录交互契约、Git 写入边界、worktree 与冲突处理。 |

现有 `lib/key-serializer.ts` 不必先接入；先依赖 Git 自身对 worktree 的约束和执行前重新检查，不引入全局锁、任务队列或重试系统。

## 验收与测试

1. **真实 Git 临时仓库**：建立普通提交、merge commit、本地／远程同名分支、轻量／附注 Tag、另一个 worktree 和裸 remote。逐项核对目标 SHA、分支 HEAD、Tag、ZIP 内容和实际远程引用。
2. **拒绝和边界**：无效名字、参数注入、branch／tag 同名、`origin/foo` 形状的本地分支、目标变化、缺少 Git、未授权仓库根、无 remote、被占用分支、dirty worktree、detached HEAD、未知 action 均返回明确结果。
3. **高风险路径**：hard reset 必须确认；冲突后确认 Git 状态仍可人工 `--continue` 或 `--abort`；push 失败不误报成功；超时不自动重试；hooks 和签名失败展示可理解的提示。
4. **界面**：桌面左右键、键盘 Tab／方向键／Enter／Escape、菜单边缘定位、虚拟行滚动、点选标签不触发行选择、移动端菜单和确认框、light／dark、高对比、长名称、三语言均可用。
5. **回归**：提交详情、历史 Diff、列宽、分支筛选、搜索、翻页、worktree 选择和侧栏刷新维持原有行为。
6. **命令**：运行 `npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint`。浏览器运行 `npm run test:e2e`；该命令自启 Next，须在无活跃 dev server 的独立 checkout 运行，不能在当前正在开发的 checkout 启第二个 Next，也不运行 `next build`。

最小替代方案是只加只读菜单：复制 SHA／名称和本地分支筛选，不增加写 API；它不能满足截图中的检出、合并和推送，但可作为范围冲突尚未解决时的讨论基线。

## 风险、回滚与待确认决策

- **最脆弱假设**：用户需要在 Pi Web 内直接修改仓库，而不是只复制 Git 命令交给终端。如果这一假设不成立，应退回只读菜单；这也显著缩小产品范围冲突。
- **安全与信任**：浏览器能调用 Git 写接口意味着能修改经授权的仓库和远端。现有 Web 密码、同源校验和允许根是必要边界；它们不是细粒度 Git 授权系统。
- **回滚**：UI 和新增 API 可一起回滚，旧 GET 不变。已执行的 Git 修改不会因回滚代码而撤销；使用 Git reflog、远端历史或备份恢复，未提交内容经 hard reset 丢失后可能无法恢复。
- **范围决策**：请确认这是本仓库维护者接受的定制范围，还是需要先与上游维护者讨论。确认后再实施，不能把本原型当作已批准的生产功能。
- **原型说明**：[打开可交互原型](./git-graph-actions.html)。其中 A／B／C 可切换，支持标签、行操作、确认框、主题和手机宽度；所有仓库、提交、文件数据都是示例，确认按钮不会运行 Git。
