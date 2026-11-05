# Brand & Design System Spec · Pi Web

## 1. 产品定义
- **产品名称**：Pi Web
- **版本**：v0.12.0
- **定位**：轻量级 Web 开发 Agent 运行与协作工作台

## 2. 界面设计规范（提取自 `app/globals.css` 与 `components/AppShell.tsx`）

### 2.1 颜色系统 (Tokens)
| Token | 浅色 (Light) | 深色 (Dark) | 用途说明 |
|---|---|---|---|
| `--bg` | `#ffffff` | `#1a1a1a` | 主工作区与内容底色 |
| `--bg-panel` | `#f5f5f5` | `#242424` | 侧边栏与标签栏底色 |
| `--bg-hover` | `#eeeeee` | `#2e2e2e` | 悬停状态底色 |
| `--bg-selected` | `#e8e8e8` | `#383838` | 选中状态与工具栏按钮背景 |
| `--border` | `#e0e0e0` | `#454545` | 分割线与外框 |
| `--text` | `#1a1a1a` | `#e8e8e8` | 主文本文字 |
| `--text-muted` | `#515c6b` | `#b7b7b7` | 次级文本 |
| `--text-dim` | `#5e6673` | `#a4a4a4` | 辅助说明 / 图标未激活态 |
| `--accent` | `#245bce` | `#a4c2f4` | 强调色 / 聚焦 / 激活态图标高亮 |

### 2.2 尺寸与布局规范
- 顶栏高度 (`--top-bar-height`)：桌面端 `36px`，移动端 `44px`。
- 图标按钮尺寸 (`TOP_BAR_ICON_BUTTON_SIZE`)：`36px × 36px`（桌面端等宽单元格）。
- 工具栏图标描边与尺寸：`14px`，`stroke-width: 2` 或 `1.8`，`currentColor`。
- 边框风格：`1px solid var(--border)`，按钮通过 `border-left: 1px solid var(--border)` 产生单元格分割线。

### 2.3 核心图标 SVG 资产定义
1. **TerminalIcon** (`>_`):
   ```svg
   <polyline points="4 17 10 11 4 5" />
   <line x1="12" y1="19" x2="20" y2="19" />
   ```
2. **GitGraphIcon** (`⑂`):
   ```svg
   <circle cx="6" cy="6" r="3" />
   <circle cx="6" cy="18" r="3" />
   <circle cx="18" cy="9" r="3" />
   <path d="M6 9v6M18 12a9 9 0 0 1-9 9" />
   ```
3. **ExpandIcon** (`⤢`):
   ```svg
   <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" />
   ```
4. **HidePanelIcon** (`◫`):
   ```svg
   <rect x="3" y="3" width="18" height="18" rx="2" />
   <line x1="15" y1="3" x2="15" y2="21" />
   ```
