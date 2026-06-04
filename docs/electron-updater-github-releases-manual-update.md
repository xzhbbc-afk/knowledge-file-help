# Electron Updater + GitHub Releases 发包与手动检查更新教程

更新时间：2026-06-04

适用项目：`E:\code\knowlege-file-help`

## 1. 目标

这套方案解决两件事：

1. 用 `electron-builder` 把 Windows 安装包发布到 GitHub Releases
2. 在客户端里只提供“检查更新”按钮，不自动检查，不自动静默下载；只有用户主动点了，才去检查并下载

这比“完全自动更新”更稳，原因很直接：

- 你当前还是高频迭代阶段
- 用户可控，风险更低
- 出问题时更容易定位

官方资料：

- Electron Builder Auto Update: https://www.electron.build/docs/features/auto-update
- Electron Builder Publish: https://www.electron.build/docs/publish
- Electron autoUpdater API: https://www.electronjs.org/docs/latest/api/auto-updater
- Electron Updating Applications: https://www.electronjs.org/docs/latest/tutorial/updates
- Electron Builder GitHub Actions: https://www.electron.build/docs/features/github-actions

## 2. 整体流程

完整链路如下：

1. 本地或 CI 执行打包
2. `electron-builder` 生成安装包和更新元数据
3. 安装包上传到 GitHub Releases
4. 客户端里用户点击“检查更新”
5. `electron-updater` 去 GitHub Releases 查询最新版本
6. 如果有新版本，询问用户是否下载
7. 下载完成后，再提示用户“重启安装”

这里的关键不是 Electron 原生 `autoUpdater` 直接硬接，而是使用 `electron-updater`。  
`electron-builder` 官方文档明确说明，自动更新能力由 `electron-updater` 提供，并和它生成的发布元数据配合工作。

## 3. 你的项目当前最适合的发布方式

建议先只做 Windows：

- 发布平台：Windows
- 打包目标：`nsis`
- 发布位置：GitHub Releases
- 更新模式：手动检查 + 用户确认下载

暂时不建议第一版就把 mac 的更新链路一起做满，原因：

- mac 自动更新通常还要面对签名和 notarization
- 你当前主要验证环境是 Windows
- 先把一条链路走通更实际

## 4. GitHub 侧准备

你需要准备一个 GitHub 仓库，例如：

- owner: `your-org`
- repo: `knowledge-file-help`

然后准备一个有 `repo` 权限的 GitHub Token，作为发布凭证。  
`electron-builder` 官方文档里说明，GitHub 发布时通常通过 `GH_TOKEN` 或 `GITHUB_TOKEN` 提供权限。

建议：

- 本地发布时设置 `GH_TOKEN`
- GitHub Actions 发布时用仓库 Secret 保存 `GH_TOKEN`

## 5. package.json 要怎么配

### 5.1 依赖

需要补两个包：

```bash
npm install electron-updater electron-log
```

- `electron-updater`：检查、下载、安装更新
- `electron-log`：记录更新日志，方便排错

### 5.2 build.publish 配置

在 `package.json` 的 `build` 下增加：

```json
{
  "build": {
    "appId": "com.local.knowledge-file-help",
    "productName": "本地文件知识库",
    "publish": [
      {
        "provider": "github",
        "owner": "your-org",
        "repo": "knowledge-file-help"
      }
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

说明：

- `publish` 的第一个 provider 会被当成默认更新源
- GitHub Releases 对这类桌面工具来说是最省事的托管位置
- `nsis` 是 Windows 下 `electron-updater` 最常见的搭配

## 6. 发包命令怎么设计

建议在 `package.json` 脚本里分成两类：

```json
{
  "scripts": {
    "build": "vite build --config vite.config.ts && node scripts/check.js",
    "dist:win": "npm run build && electron-builder --win nsis",
    "release:win": "npm run build && electron-builder --win nsis --publish always"
  }
}
```

建议这样理解：

- `dist:win`：只在本地打包，不上传
- `release:win`：打包并上传到 GitHub Releases

`electron-builder` 官方文档对 `--publish` 的行为有明确说明，`always` 表示总是执行发布。

## 7. GitHub Releases 发布时会产生什么

对 Windows NSIS 来说，通常会看到这些文件：

- `本地文件知识库-x.y.z-setup-x64.exe`
- `latest.yml`
- `.blockmap`

其中真正给更新用的是：

- 安装包本体
- `latest.yml`
- blockmap

客户端检查更新时，核心依赖的是这些发布元数据。

## 8. 为什么你不该做“自动启动即检查更新”

你当前需求是：

- 不自动更新
- 用户点按钮才检查
- 用户确认后才下载

这比开机自动检查更合适，原因：

1. 启动速度更稳定
2. 用户心智更清楚
3. 出问题时边界更明确
4. 对 GitHub Releases 请求频率更可控

所以主进程里不要在 `app.whenReady()` 后立刻调用 `checkForUpdates()`。

## 9. 主进程怎么接

主进程文件：`src/main.js`

### 9.1 基础初始化

```js
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

log.transports.file.level = "info";
autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
```

这里最重要的是这两句：

```js
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
```

含义：

- 发现新版本后先不要自己下载
- 下载完成后也不要等用户关闭程序时偷偷安装

都改成由用户明确触发。

### 9.2 事件监听

建议监听这些事件：

```js
autoUpdater.on("checking-for-update", () => {});
autoUpdater.on("update-available", (info) => {});
autoUpdater.on("update-not-available", () => {});
autoUpdater.on("error", (error) => {});
autoUpdater.on("download-progress", (progress) => {});
autoUpdater.on("update-downloaded", (info) => {});
```

这些事件再转发给渲染层，用于更新按钮、状态文案和进度条。

### 9.3 IPC 设计

建议只做 3 个动作：

1. `app:check-for-updates`
2. `app:download-update`
3. `app:quit-and-install-update`

示例：

```js
ipcMain.handle("app:check-for-updates", async () => {
  return autoUpdater.checkForUpdates();
});

ipcMain.handle("app:download-update", async () => {
  return autoUpdater.downloadUpdate();
});

ipcMain.handle("app:quit-and-install-update", async () => {
  autoUpdater.quitAndInstall();
  return { ok: true };
});
```

## 10. 前端怎么做最合适

你的项目当前用的是 React + Mantine。

建议把“检查更新”放在现有顶部的 `更多` 菜单里，而不是再挤一个头部按钮。

推荐交互：

### 状态 1：未检查

菜单项：

- `检查更新`

### 状态 2：检查中

弹窗或通知：

- `正在检查更新...`

### 状态 3：已是最新版

提示：

- `当前已经是最新版`

### 状态 4：发现新版本

弹窗内容：

- 当前版本
- 最新版本
- 是否立即下载

按钮：

- `稍后`
- `下载更新`

### 状态 5：下载中

显示：

- 下载进度条
- 当前百分比

### 状态 6：下载完成

提示：

- `更新已下载完成，重启后安装`

按钮：

- `稍后重启`
- `立即重启安装`

## 11. 推荐的最小实现策略

第一版不要做复杂功能，先做这个最小闭环：

1. 前端点“检查更新”
2. 主进程调用 `checkForUpdates()`
3. 如果没更新，弹提示
4. 如果有更新，弹确认框
5. 用户确认后调用 `downloadUpdate()`
6. 下载完成后弹“立即重启安装”

先不要做这些：

- 启动自动检查
- 静默后台下载
- 分频道更新（beta / alpha）
- 增量灰度发布
- 更新日志富文本展示

这些都属于第二阶段。

## 12. 发布操作建议

建议你把版本发布固定成这套流程：

1. 修改 `package.json` 版本号
2. 提交代码
3. 打 tag，例如 `v0.1.1`
4. 执行发布命令，或走 GitHub Actions
5. 检查 GitHub Releases 是否出现：
   - 安装包
   - `latest.yml`
   - `.blockmap`
6. 本地用旧版本点击“检查更新”验证

## 13. GitHub Actions 是否值得现在就做

值得，但不是必须马上做。

如果你当前还是本地手工打包为主，可以先手工发版。  
等“检查更新”功能本身稳定后，再补 GitHub Actions 自动发布。

对你当前阶段，优先级建议是：

1. 先把客户端“检查更新 -> 下载 -> 重启安装”做通
2. 再补 GitHub Actions

## 14. 常见坑

### 14.1 GitHub Release 是 draft

`electron-builder` 文档里有一条很关键：  
如果 Release 还是 draft，更新客户端通常看不到它。

所以对最终给用户用的版本，不能长期停留在 draft。

### 14.2 mac 自动更新签名要求更高

Electron 官方文档说明，macOS 自动更新要求应用签名。  
所以 Windows 可以先做，mac 不建议现在一起压进第一版。

### 14.3 不要重复调用 checkForUpdates

Electron 官方 API 文档明确提醒，重复调用可能造成问题。  
所以按钮点击时要做防重复处理，检查期间禁用按钮。

### 14.4 私有仓库要处理 Token

如果未来把仓库设为 private，就要正确配置 `GH_TOKEN`，否则客户端下载更新会失败。

## 15. 针对你这个项目，下一步最实际的实现方案

建议直接这样落：

### 第一阶段

- 只做 Windows
- 只做手动检查更新
- 只做用户确认后下载
- 下载后提示重启安装

### 第二阶段

- 加 GitHub Actions 自动发版
- 加版本更新说明
- 视需要再考虑 mac

## 16. 这套方案在你项目里要改哪些文件

大概率会涉及：

- `package.json`
  - 增加 `electron-updater`
  - 增加 `electron-log`
  - 增加 `build.publish`
  - 增加发布脚本

- `src/main.js`
  - 接入 `autoUpdater`
  - 增加 IPC
  - 转发更新事件给前端

- `src/preload.js`
  - 暴露检查更新、下载更新、安装更新接口
  - 暴露更新状态订阅接口

- `src/renderer/src/vite-env.d.ts`
  - 补类型声明

- `src/renderer/src/App.tsx`
  - 增加“检查更新”入口
  - 增加版本检查、下载、安装 UI

## 17. 当前项目推荐实现结论

如果按你的要求收敛成一句话：

> 用 `electron-updater + GitHub Releases`，但只做“用户点检查更新 -> 发现新版本 -> 用户确认后下载 -> 下载完成提示重启安装”，不要做自动检查和自动静默更新。

这就是当前最合适的落地方式。

## 18. 项目实战补充：这次实际踩到的坑

下面这些不是泛泛而谈，而是这个项目在真实开发和发版过程中已经碰到过的问题。

### 18.1 Electron 打包后打开空白页

现象：

- `win-unpacked` 或安装包打开后，窗口是空白

原因：

- Vite 构建产物里资源路径还是根路径
- 例如：
  - `/assets/index-xxx.js`
  - `/logo.png`
- Electron 打包后走的是 `file://`，不是开发服务器根路径，所以这些资源找不到

修法：

- 在 `vite.config.ts` 里设置：

```ts
export default defineConfig({
  root: "src/renderer",
  base: "./"
})
```

判断方法：

- 打开 `dist/renderer/index.html`
- 确认资源路径是：
  - `./assets/...`
  - `./logo.png`

### 18.2 PDF OCR / PDF 全文提取版本冲突

现象：

- 另一台电脑上 PDF OCR 报错：

```text
The API version "5.4.296" does not match the Worker version "5.4.624"
```

原因：

- 项目里同时存在两套 `pdfjs-dist`
- `pdf-parse` 自带的是 `5.4.296`
- 顶层又装了 `pdfjs-dist 5.4.624`
- 打包后某条运行路径同时用了不同版本的 API 和 worker

修法：

1. 尽量统一到同一版本
2. PDF 提取逻辑优先固定加载 `pdf-parse` 自带那套 `pdfjs`
3. 顶层 `pdfjs-dist` 也改成相同版本

经验：

- 这类问题在开发环境不一定稳定复现
- 打包后更容易暴露
- 所以 PDF 相关依赖不要混着升级

### 18.3 Windows 打包最后一步常见 EBUSY

现象：

- 安装包已经生成
- 但命令最后报：
  - `EBUSY`
  - `resource busy or locked`
  - `unlink ... nsis.7z`

原因：

- 临时压缩包正在被系统、杀软或索引服务占用

处理方式：

- 先看 `release` 目录里安装包本体和 `win-unpacked` 是否已经生成
- 如果已经有：
  - `setup.exe`
  - `win-unpacked`
- 那通常成品是可用的，失败的是收尾清理，不一定影响使用

更稳的处理：

- 重新指定一个全新的输出目录再打一次

例如：

```bash
npx electron-builder --win nsis --config.directories.output=release-20260604-191846
```

### 18.4 旧的 win-unpacked 被占用，导致无法重新打包

现象：

- 重新打包时报 `app.asar` 或 `win-unpacked` 被占用

原因：

- 旧版本的解包程序可能还在运行
- 即使窗口关了，也可能还没完全退出
- 或者正在被系统扫描

处理方式：

1. 确认旧程序已经真正退出
2. 不要只关窗口，还要看是否还在系统托盘
3. 如果着急重新出包，直接改输出目录，绕过旧目录

### 18.5 GitHub Release 发成功了，但看不到

现象：

- 命令行看起来已经发布成功
- 但 GitHub Releases 页面上用户没看到

原因：

- `electron-builder` 默认创建的常常是 `draft release`

影响：

- 普通用户看不到
- `electron-updater` 也通常看不到 draft release

处理方式：

1. 去 Releases 页面看是否是 `Draft`
2. 如果是，手动点 `Publish release`
3. 或者显式配置发布类型

例如：

```json
"publish": [
  {
    "provider": "github",
    "owner": "xzhbbc-afk",
    "repo": "knowledge-file-help",
    "releaseType": "release"
  }
]
```

### 18.6 本地 release:win / release:mac 超时

现象：

- 本地打包能跑
- 但发布时超时，例如：

```text
connect ETIMEDOUT 20.27.177.116:443
```

原因：

- 本地到 GitHub 网络不稳定
- 上传 Release 资源时失败

判断方式：

先分开看：

1. `dist:win` / `dist:mac` 是否成功
2. 只有 `release:win` / `release:mac` 失败

如果是这样，说明：

- 本地打包没问题
- 失败的是上传发布，不是项目构建

建议：

- 能本地发就本地发
- 如果本地网络不稳，后面优先改成 GitHub Actions 发版

### 18.7 GH_TOKEN 泄露

现象：

- 把 `GH_TOKEN` 直接发到了聊天、文档或截图里

处理原则：

- 只要 token 出现在公开或半公开渠道，就当作已经泄露

必须立即做：

1. 去 GitHub 撤销旧 token
2. 重新创建新 token
3. 新 token 不要再写进聊天记录或代码仓库

本地使用方式：

```powershell
$env:GH_TOKEN="你的新token"
npm run release:win
```

### 18.8 mac 发布时报 Request path contains unescaped characters

现象：

- mac 打包能完成
- 上传到 GitHub Releases 时失败
- 报错：

```text
Request path contains unescaped characters
```

原因：

- 发布产物文件名里带了中文
- `electron-publish` 走 GitHub 上传路径时，没有对这类字符做兼容处理

本项目实际触发点就是：

- `本地文件知识库-0.1.0-mac.zip`
- `本地文件知识库-0.1.0-mac.zip.blockmap`

修法：

- mac 发布产物文件名改成 ASCII
- 应用显示名可以继续保留中文
- 只改上传用的文件名

例如：

```json
"mac": {
  "target": ["zip"],
  "artifactName": "knowledge-file-help-${version}-mac-${arch}.${ext}"
}
```

### 18.9 mac 日志里 0 valid identities found

现象：

```text
0 valid identities found
```

含义：

- 当前机器没有可用的 Apple 签名身份

这不一定会阻止你生成 zip 包并上传到 GitHub Releases，但它意味着：

- 你现在不是正式签名分发链路
- 后续如果要更稳的 mac 分发体验，仍然需要签名和 notarization

判断方式：

- 如果只是做测试 zip 发布，这个提示可以先接受
- 如果后面要让更多用户稳定安装，必须补签名

### 18.10 检查更新为什么“发完了但用户看不到”

现象：

- Release 已经发好了
- 用户点“检查更新”却提示已是最新版

最常见原因：

1. 用户当前安装版本和 Release 版本相同
2. Release 还是 draft
3. 用户本地不是打包版，而是开发环境运行
4. `build.publish.owner/repo` 没配对

正确验证流程：

1. 保留旧版本，例如 `0.1.0`
2. 把项目版本升到 `0.1.1`
3. 发布 `0.1.1`
4. 用旧版 `0.1.0` 安装包启动
5. 再点“检查更新”

只有这样，客户端才会真正显示“发现新版本”。

### 18.11 首次验证要清空本地记录

如果要验证“首次进入引导”这类能力，不要只删安装包，要删本地用户数据。

本项目实际数据目录是：

- `C:\Users\admin\AppData\Roaming\knowledge-file-help\metadata.sqlite`
- `C:\Users\admin\AppData\Roaming\knowledge-file-help\file-kb-store.json`
- `C:\Users\admin\AppData\Roaming\knowledge-file-help\tessdata`

最直接做法：

1. 完全退出应用
2. 删除 `C:\Users\admin\AppData\Roaming\knowledge-file-help`
3. 再启动应用

这样才能回到真正的首次状态。

## 19. 本项目当前推荐的发版与验证顺序

按这次实战经验，最稳的顺序是：

1. 本地先执行 `npm run build`
2. 再执行 `npm run dist:win` 或 `npm run dist:mac`
3. 确认本地产物可运行
4. 再执行 `npm run release:win` 或 `npm run release:mac`
5. 去 GitHub Releases 看是否成功生成并发布
6. 用旧版本客户端点“检查更新”验证

如果本地上传经常不稳，下一步就该切 GitHub Actions。
