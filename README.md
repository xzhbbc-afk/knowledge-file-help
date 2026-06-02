# 本地文件知识库工具

这是一个桌面本地文件知识库 MVP。第一版聚焦：

- 多级分类管理
- 本地文件导入记录
- 标签和备注
- 关键词搜索
- 规则归档推荐
- 文件详情编辑
- 打开文件和打开所在文件夹

第二版再加入本地 Embedding、全文索引、语义搜索和重排序。

## 运行

先安装依赖：

```powershell
npm install
```

开发模式启动桌面应用：

```powershell
npm run dev
```

生产构建后启动桌面应用：

```powershell
npm start
```

基础检查：

```powershell
npm run build
```

## 数据位置

应用数据默认保存在 Electron 的用户数据目录下：

```text
file-kb-store.json
```

当前 MVP 默认只建立文件索引，不移动原始文件。
