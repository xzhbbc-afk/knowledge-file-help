# 本地文件知识库

一个基于 Electron + React 的本地桌面文件知识库工具。目标是把个人电脑里的文件按知识库目录、分类、标签、备注、全文索引和关系图组织起来，支持本地搜索、归档、OCR 和可视化关联查看。

当前版本重点是本地优先：文件、索引、OCR、SQLite 数据库都在本机处理，不依赖云端服务。

## 当前能力

- 多级分类管理：支持一级、二级、三级及更多层级分类。
- 知识库目录：首次进入可引导用户选择知识库根目录。
- 文件导入：支持只建立索引，也支持复制/移动到知识库目录。
- 分类目录同步：创建知识库目录时会同步创建分类文件夹。
- 文件归档：知识库内文件切换分类时，会移动到对应分类目录。
- 标签管理：标签可录入、筛选、修改；输入新标签时自动新增。
- 文件备注：文件详情可维护备注。
- 文件夹备注：分类目录可维护用途说明。
- 归档规则：支持按关键词规则自动匹配分类，并可设置只根目录归档或所有目录归档。
- 扫描知识库：可手动扫描知识库目录，把用户自行放入的文件和新建文件夹纳入索引。
- 文件操作：支持打开文件、打开所在文件夹。
- 全文索引：支持文本类文件、Office、PDF 的内容提取与检索。
- OCR：支持图片和扫描型 PDF 的本地 OCR，使用 Tesseract.js 和本地中英文语言包。
- 内容索引详情：可查看文件已提取/OCR 出来的文本内容。
- SQLite 存储：文件、分类、标签、规则、全文索引、图谱索引都存入本地 SQLite。
- 知识库 Markdown 索引：生成 `_index.md`，用于目录级知识索引和后续知识库扩展。
- 知识图谱：基于分类、标签、文件名、备注、正文特征生成文件关系图。
- 图谱视图：使用 React Flow 展示图谱，支持拖拽、滚轮缩放、小地图和关系明细。
- 功能介绍：内置功能说明入口。
- 检查更新：集成 electron-updater，支持用户手动检查并下载 GitHub Releases 中的新版本。
- 系统托盘：关闭窗口时可缩小到托盘，避免误关应用。

## 技术栈

- 桌面端：Electron
- 前端：React + Vite + TypeScript
- UI：Mantine + lucide-react
- 图谱：@xyflow/react
- 本地数据库：sql.js SQLite
- Office 文本提取：mammoth、word-extractor、xlsx
- PDF 文本提取：pdfjs-dist、pdf-parse
- OCR：tesseract.js、@tesseract.js-data/chi_sim、@tesseract.js-data/eng
- 打包：electron-builder
- 更新：electron-updater + GitHub Releases

## 项目结构

```text
src/
  main.js                    Electron 主进程、窗口、托盘、IPC、更新流程
  preload.js                 Renderer 可调用的安全 API
  store.js                   SQLite 存储、全文索引、OCR、图谱构建
  renderer/
    index.html
    src/
      App.tsx                主界面和业务交互
      main.tsx               React 入口和 Mantine Provider
      styles.css             全局样式和图谱样式
      vite-env.d.ts          Renderer 类型定义
assets/
  local-knowledge-logo-rounded-transparent.png
docs/
  electron-updater-github-releases-manual-update.md
scripts/
  check.js                   构建后的基础检查
```

## 数据存储

应用数据保存在 Electron 的 `userData` 目录下。当前主要使用 SQLite 数据库保存：

- 分类
- 文件索引
- 标签
- 归档规则
- 全文内容索引
- 内容分词索引
- 图谱节点和边

知识库目录中的 `_index.md` 用于沉淀文件、分类、备注等 Markdown 索引信息。用户手动编辑知识库中的文件后，可通过“扫描知识库”刷新索引。

## 全文检索

内容索引流程：

1. 识别文件类型。
2. 对文本、Office、PDF 提取普通文本。
3. 对图片或扫描 PDF 执行本地 OCR。
4. 将正文写入 `content_index`。
5. 将分词写入 `content_terms`。
6. 搜索时优先通过 SQLite 中的分词候选定位文件，再返回命中文本片段。

图片文件默认不进入普通全文索引；需要 OCR 时走 OCR 流程。

## OCR

OCR 使用本地 Tesseract.js，不需要外部接口。语言包来自：

- `@tesseract.js-data/chi_sim`
- `@tesseract.js-data/eng`

PDF 会先尝试普通文本层提取。只有文本层不足或需要 OCR 时，才进入 OCR 处理。OCR 支持进度回传，并会限制文件大小和 PDF 页数，避免长时间阻塞。

## 知识图谱

图谱数据由 `src/store.js` 构建，保存到：

- `graph_nodes`
- `graph_edges`

图谱关系来源包括：

- 分类层级
- 分类包含文件
- 文件标签
- 文件之间的相似关系

文件相似关系不是简单关键词交集，而是基于带权重的特征评分：

- 标签：高权重
- 文件名：高权重
- 用户备注：中高权重
- 分类路径：中权重
- 正文内容：低权重

图谱构建会过滤泛词和系统备注，例如“报告、文件、项目、扫描、入库、目录”等。系统自动备注如“从知识库目录扫描入库”不会参与相似度计算。

为避免性能问题，文件相似关系使用倒排索引找候选，不做全量两两比较；每个文件只保留有限数量的高分关联。

## 运行开发

安装依赖：

```powershell
npm install
```

启动开发模式：

```powershell
npm run dev
```

生产构建并启动：

```powershell
npm start
```

基础构建检查：

```powershell
npm run build
```

## 打包

Windows 安装包：

```powershell
npm run dist:win
```

macOS zip 包：

```bash
npm run dist:mac
```

打包输出目录：

```text
release/
```

macOS 打包前必须先完整安装依赖，否则运行时可能出现类似 `Cannot find module 'electron-updater'` 的错误。

## 发布更新

项目使用 electron-updater + GitHub Releases。当前设计是用户手动点击“检查更新”，发现新版本后再手动下载。

发布 Windows：

```powershell
$env:GH_TOKEN="你的 GitHub Token"
npm run release:win
```

发布 macOS：

```bash
export GH_TOKEN="你的 GitHub Token"
npm run release:mac
```

详细发布说明见：

```text
docs/electron-updater-github-releases-manual-update.md
```

## 已知取舍

- 当前没有启用本地 Embedding，语义搜索计划放到后续版本。
- 知识库自动监听曾经尝试过，但因为误报和重命名识别问题，目前界面和代码路径已弱化，优先使用手动扫描。
- OCR 对超大图片、长 PDF、复杂扫描件仍可能较慢或失败，需要后续继续增强队列和错误恢复。
- 图谱布局当前是规则化分层布局，后续可以继续加入折叠、筛选、关系类型开关。

## 后续方向

- 本地 Embedding 和语义检索
- 图谱节点折叠/展开
- 图谱关系类型过滤
- 更完整的知识笔记和 Markdown 双链
- 知识库配置和索引导入导出
- 更稳定的 OCR 队列和失败重试
- 更细的权限和数据迁移工具
