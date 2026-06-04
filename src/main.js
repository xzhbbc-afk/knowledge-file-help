const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } = require("electron");
const { createStore } = require("./store");

let mainWindow;
let store;
let libraryWatcher = null;
let libraryWatcherDir = "";
let libraryWatcherTimer = null;
let libraryWatcherEvents = 0;
let ocrCancelRequested = false;
let libraryWatcherSuppressUntil = 0;

function resolveAssetPath(...parts) {
  return path.join(__dirname, "..", ...parts);
}

function uniqueDestinationPath(directoryPath, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(directoryPath, fileName);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function sanitizePathPart(value) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return cleaned || "未命名";
}

function categoryDirParts(categories, categoryId) {
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return [];
  return [...categoryDirParts(categories, category.parentId), sanitizePathPart(category.name)];
}

function createCategoryFolders(libraryDir, categories) {
  if (!libraryDir) {
    throw new Error("请先选择知识库目录。");
  }

  fs.mkdirSync(libraryDir, { recursive: true });
  categories.forEach((category) => {
    const parts = categoryDirParts(categories, category.id);
    if (parts.length) fs.mkdirSync(path.join(libraryDir, ...parts), { recursive: true });
  });
}

function markdownEscape(value) {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function summarizeText(value, maxLength = 120) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function markdownLinkForFile(indexDir, file) {
  if (!file.path) return markdownEscape(file.name);
  const relative = path.relative(indexDir, file.path).replace(/\\/g, "/");
  return `[${markdownEscape(file.name)}](<${relative}>)`;
}

function replaceManagedBlock(existingContent, title, blockContent) {
  const start = "<!-- knowledge-file-help:auto:start -->";
  const end = "<!-- knowledge-file-help:auto:end -->";
  const block = `${start}\n${blockContent}\n${end}`;

  if (!existingContent) return `# ${title}\n\n${block}\n`;

  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (pattern.test(existingContent)) return existingContent.replace(pattern, block);
  return `${existingContent.trim()}\n\n${block}\n`;
}

function writeIndexFile(indexDir, title, blockContent) {
  fs.mkdirSync(indexDir, { recursive: true });
  const indexPath = path.join(indexDir, "_index.md");
  const existingContent = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  fs.writeFileSync(indexPath, replaceManagedBlock(existingContent, title, blockContent), "utf8");
}

function createObsidianIndexes(libraryDir, categories, files) {
  const filesByCategory = new Map();
  files.forEach((file) => {
    const key = file.categoryId || "";
    filesByCategory.set(key, [...(filesByCategory.get(key) || []), file]);
  });

  function fileTable(indexDir, categoryId) {
    const categoryFiles = filesByCategory.get(categoryId) || [];
    if (!categoryFiles.length) return "暂无文件。";

    const rows = categoryFiles
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((file) => {
        const tags = Array.isArray(file.tags) ? file.tags.join(", ") : "";
        return `| ${markdownLinkForFile(indexDir, file)} | ${markdownEscape(tags)} | ${markdownEscape(file.note)} | ${markdownEscape(file.indexSummary)} |`;
      });

    return ["| 文件 | 标签 | 备注 | 索引摘要 |", "| --- | --- | --- | --- |", ...rows].join("\n");
  }

  const rootChildren = categories
    .filter((category) => !category.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"))
    .map((category) => `- [[${sanitizePathPart(category.name)}/_index|${markdownEscape(category.name)}]]`);

  writeIndexFile(
    libraryDir,
    "知识库索引",
    [
      "## 分类",
      rootChildren.length ? rootChildren.join("\n") : "暂无分类。",
      "",
      "## 根目录文件",
      fileTable(libraryDir, "")
    ].join("\n")
  );

  categories.forEach((category) => {
    const parts = categoryDirParts(categories, category.id);
    const indexDir = path.join(libraryDir, ...parts);
    const children = categories
      .filter((item) => item.parentId === category.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"))
      .map((child) => `- [[${sanitizePathPart(child.name)}/_index|${markdownEscape(child.name)}]]`);

    writeIndexFile(
      indexDir,
      category.name,
      [
        "## 目录备注",
        markdownEscape(category.note) || "暂无备注。",
        "",
        `## 分类路径`,
        markdownEscape(parts.join(" / ")),
        "",
        "## 子分类",
        children.length ? children.join("\n") : "暂无子分类。",
        "",
        "## 文件索引",
        fileTable(indexDir, category.id)
      ].join("\n")
    );
  });
}

function scanLibraryTree(libraryDir, directoryPath = libraryDir, result = { folders: [], files: [] }) {
  if (!fs.existsSync(directoryPath)) return result;
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

  entries.forEach((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const relativePath = path.relative(libraryDir, entryPath);
      result.folders.push({
        path: entryPath,
        parts: relativePath.split(path.sep).filter(Boolean)
      });
      scanLibraryTree(libraryDir, entryPath, result);
      return;
    }

    if (!entry.isFile()) return;
    if (entry.name.toLowerCase() === "_index.md") return;
    result.files.push(entryPath);
  });

  return result;
}

function categoryIdByRelativeDir(libraryDir, categories) {
  const result = new Map();
  categories.forEach((category) => {
    const relativeDir = categoryDirParts(categories, category.id).join(path.sep);
    result.set(relativeDir.toLowerCase(), category.id);
  });
  return result;
}

function fileMetaFromPath(filePath, extra = {}) {
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).replace(".", "").toLowerCase(),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    ...extra
  };
}

function directorySize(directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) return 0;
  let total = 0;
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

  entries.forEach((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(entryPath);
      return;
    }
    if (entry.isFile()) {
      total += fs.statSync(entryPath).size;
    }
  });

  return total;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function stopLibraryWatcher() {
  if (libraryWatcherTimer) {
    clearTimeout(libraryWatcherTimer);
    libraryWatcherTimer = null;
  }
  if (libraryWatcher) {
    libraryWatcher.close();
    libraryWatcher = null;
  }
  libraryWatcherDir = "";
  libraryWatcherEvents = 0;
  sendToRenderer("library:watch-status", { active: false, libraryDir: "" });
}

function suppressLibraryWatcher(ms = 8000) {
  libraryWatcherSuppressUntil = Date.now() + ms;
  libraryWatcherEvents = 0;
  if (libraryWatcherTimer) {
    clearTimeout(libraryWatcherTimer);
    libraryWatcherTimer = null;
  }
  if (libraryWatcherDir) {
    sendToRenderer("library:watch-status", {
      active: true,
      libraryDir: libraryWatcherDir,
      pending: false,
      eventCount: 0
    });
  }
}

function startLibraryWatcher(libraryDir) {
  stopLibraryWatcher();
  if (!libraryDir || !fs.existsSync(libraryDir)) return;

  libraryWatcherDir = libraryDir;
  libraryWatcher = fs.watch(libraryDir, { recursive: true }, (_eventType, filename) => {
    if (Date.now() < libraryWatcherSuppressUntil) return;
    if (typeof filename === "string" && filename.replace(/\\/g, "/").toLowerCase().endsWith("/_index.md")) return;
    if (typeof filename === "string" && filename.toLowerCase() === "_index.md") return;
    libraryWatcherEvents += 1;
    sendToRenderer("library:watch-status", {
      active: true,
      libraryDir,
      pending: true,
      eventCount: libraryWatcherEvents
    });

    if (libraryWatcherTimer) clearTimeout(libraryWatcherTimer);
    libraryWatcherTimer = setTimeout(() => {
      const eventCount = libraryWatcherEvents;
      libraryWatcherEvents = 0;
      libraryWatcherTimer = null;
      sendToRenderer("library:watch-change", {
        libraryDir,
        eventCount,
        triggeredAt: new Date().toISOString()
      });
    }, 5000);
  });

  sendToRenderer("library:watch-status", {
    active: true,
    libraryDir,
    pending: false,
    eventCount: 0
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    icon: resolveAssetPath("assets", "local-knowledge-logo.png"),
    backgroundColor: "#f6f7f4",
    title: "本地文件知识库",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  }

  if (process.env.VITE_DEV_SERVER_URL || process.env.OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    });
  }
}

app.whenReady().then(async () => {
  store = await createStore(app.getPath("userData"));
  createWindow();
  globalShortcut.register("F12", () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopLibraryWatcher();
});

ipcMain.handle("store:load", () => store.load());

ipcMain.handle("store:save", (_event, data) => store.save(data));

ipcMain.handle("library:watch", async (_event, payload) => {
  stopLibraryWatcher();
  return { active: false, libraryDir: "" };
});

ipcMain.handle("store:stats", async (_event, payload) => {
  const libraryDir = payload?.libraryDir || "";
  const dataSize = fs.existsSync(store.dataPath) ? fs.statSync(store.dataPath).size : 0;
  const contentIndexSize = store.contentIndexSize ? store.contentIndexSize() : 0;
  return {
    dataPath: store.dataPath,
    dataSize,
    librarySize: directorySize(libraryDir),
    contentIndexSize
  };
});

ipcMain.handle("store:backup", async (_event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "备份知识库索引",
    defaultPath: `knowledge-file-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, path: "" };
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf8");
  return { ok: true, path: result.filePath };
});

ipcMain.handle("store:restore", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "恢复知识库索引",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const raw = fs.readFileSync(result.filePaths[0], "utf8");
  return JSON.parse(raw);
});

ipcMain.handle("files:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入文件",
    properties: ["openFile", "multiSelections"]
  });

  if (result.canceled) return [];
  return result.filePaths.map((filePath) => {
    return fileMetaFromPath(filePath, { originalPath: filePath, storedPath: filePath, importMode: "index" });
  });
});

ipcMain.handle("dirs:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择知识库目录",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) return "";
  return result.filePaths[0];
});

ipcMain.handle("dirs:sync-category-folders", async (_event, payload) => {
  const libraryDir = payload?.libraryDir || "";
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  const files = Array.isArray(payload?.files) ? payload.files : [];
  suppressLibraryWatcher();
  createCategoryFolders(libraryDir, categories);
  const contentByFileId = store.contentTextByFileIds(files.map((file) => file.id));
  createObsidianIndexes(
    libraryDir,
    categories,
    files.map((file) => ({
      ...file,
      indexSummary: summarizeText(contentByFileId[file.id])
    }))
  );
  return { ok: true };
});

ipcMain.handle("files:import-to-library", async (_event, payload) => {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const mode = payload?.mode || "index";
  const libraryDir = payload?.libraryDir || "";
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];

  if (!["index", "copy", "move"].includes(mode)) {
    throw new Error("未知导入方式。");
  }

  if (mode === "index") {
    return files.map((file) => fileMetaFromPath(file.path, {
      originalPath: file.originalPath || file.path,
      storedPath: file.path,
      importMode: "index"
    }));
  }

  if (!libraryDir) {
    throw new Error("请先选择知识库目录。");
  }

  suppressLibraryWatcher();
  fs.mkdirSync(libraryDir, { recursive: true });
  createCategoryFolders(libraryDir, categories);

  return files.map((file) => {
    if (!fs.existsSync(file.path)) {
      throw new Error(`文件不存在：${file.path}`);
    }

    const targetDirParts = Array.isArray(file.targetDirParts) ? file.targetDirParts.map(sanitizePathPart) : [];
    const targetDir = path.join(libraryDir, ...targetDirParts);
    fs.mkdirSync(targetDir, { recursive: true });
    const destination = uniqueDestinationPath(targetDir, path.basename(file.path));
    fs.copyFileSync(file.path, destination);

    if (mode === "move" && path.resolve(file.path) !== path.resolve(destination)) {
      fs.unlinkSync(file.path);
    }

    return fileMetaFromPath(destination, {
      originalPath: file.originalPath || file.path,
      storedPath: destination,
      importMode: mode
    });
  });
});

ipcMain.handle("files:relocate-library-file", async (_event, payload) => {
  const filePath = payload?.filePath || "";
  const libraryDir = payload?.libraryDir || "";
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  const categoryId = payload?.categoryId || "";

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("文件不存在，无法移动到分类目录。");
  }

  if (!libraryDir) {
    throw new Error("请先选择知识库目录。");
  }

  suppressLibraryWatcher();
  createCategoryFolders(libraryDir, categories);
  const targetDir = path.join(libraryDir, ...categoryDirParts(categories, categoryId));
  fs.mkdirSync(targetDir, { recursive: true });

  if (path.resolve(path.dirname(filePath)) === path.resolve(targetDir)) {
    return fileMetaFromPath(filePath, { storedPath: filePath });
  }

  const destination = uniqueDestinationPath(targetDir, path.basename(filePath));

  try {
    fs.renameSync(filePath, destination);
  } catch (_error) {
    fs.copyFileSync(filePath, destination);
    fs.unlinkSync(filePath);
  }

  return fileMetaFromPath(destination, { storedPath: destination });
});

ipcMain.handle("files:check", async (_event, files) => {
  const items = Array.isArray(files) ? files : [];
  return items.map((file) => ({
    id: file.id,
    exists: Boolean(file.path && fs.existsSync(file.path)),
    checkedAt: new Date().toISOString()
  }));
});

ipcMain.handle("library:scan", async (_event, payload) => {
  const libraryDir = payload?.libraryDir || "";
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];

  if (!libraryDir || !fs.existsSync(libraryDir)) {
    throw new Error("知识库目录不存在，请先选择有效目录。");
  }

  const categoryMap = categoryIdByRelativeDir(libraryDir, categories);
  const tree = scanLibraryTree(libraryDir);
  return {
    folders: tree.folders.map((folder) => {
      const relativeDir = folder.parts.join(path.sep).toLowerCase();
      return {
        path: folder.path,
        parts: folder.parts,
        categoryId: categoryMap.get(relativeDir) || ""
      };
    }),
    files: tree.files.map((filePath) => {
    const relativeDir = path.dirname(path.relative(libraryDir, filePath));
    const normalizedRelativeDir = relativeDir === "." ? "" : relativeDir.toLowerCase();
    return fileMetaFromPath(filePath, {
      originalPath: filePath,
      storedPath: filePath,
      importMode: "copy",
      categoryId: categoryMap.get(normalizedRelativeDir) || "",
      categoryParts: normalizedRelativeDir ? relativeDir.split(path.sep).filter(Boolean) : []
    });
  })
  };
});

ipcMain.handle("content:index-text-files", async (_event, files) => {
  return await store.indexTextFiles(Array.isArray(files) ? files : []);
});

ipcMain.handle("content:index-ocr-files", async (_event, payload) => {
  ocrCancelRequested = false;
  const files = Array.isArray(payload) ? payload : Array.isArray(payload?.files) ? payload.files : [];
  const language = Array.isArray(payload) ? "chi_sim+eng" : payload?.language || "chi_sim+eng";
  return await store.indexOcrFiles(Array.isArray(files) ? files : [], (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("content:ocr-progress", progress);
    }
  }, { language, isCanceled: () => ocrCancelRequested });
});

ipcMain.handle("content:cancel-ocr", async () => {
  ocrCancelRequested = true;
  return { ok: true };
});

ipcMain.handle("content:search", async (_event, query) => {
  return store.searchContent(query);
});

ipcMain.handle("content:text-by-file-ids", async (_event, fileIds) => {
  return store.contentTextByFileIds(fileIds);
});

ipcMain.handle("content:get-index", async (_event, fileId) => {
  return store.getContentIndex(fileId);
});

ipcMain.handle("files:open", async (_event, filePath) => {
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: "文件不存在，可能已被移动或删除。" };
  }

  const message = await shell.openPath(filePath);
  return { ok: message === "", message };
});

ipcMain.handle("files:show", async (_event, filePath) => {
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: "文件不存在，可能已被移动或删除。" };
  }

  shell.showItemInFolder(filePath);
  return { ok: true, message: "" };
});
