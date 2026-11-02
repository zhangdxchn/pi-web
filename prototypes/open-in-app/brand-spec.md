# Pi Web · 打开项目原型 — 视觉依据

- 对象：Pi Web 的文件侧栏；以用户提供的截图及仓库现有界面为参照，不重新设计产品品牌。
- 颜色：`app/globals.css` 的 light/dark 主题变量；控件与侧栏参照 `app/sidebar.css`、`app/sidebar-menu.css`。
- 图标：侧栏线框图标参照 `components/SidebarIcons.tsx`。
- Finder：从本机 `/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns` 转为 PNG，再内嵌到原型；`assets/finder.png` 保留原始转换结果。
- Visual Studio Code：从本机 `/Applications/Visual Studio Code.app/Contents/Resources/Code.icns` 转为 PNG，再内嵌到原型；`assets/vscode.png` 保留原始转换结果。
- 原型里的应用、路径和状态仅用于交互演示；不会查询已安装应用、启动应用或读写项目文件。
