const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } = require("electron");
const { createStore } = require("./store");

let mainWindow;
let store;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
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

app.whenReady().then(() => {
  store = createStore(app.getPath("userData"));
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
});

ipcMain.handle("store:load", () => store.load());

ipcMain.handle("store:save", (_event, data) => store.save(data));

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
  createCategoryFolders(libraryDir, categories);
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
