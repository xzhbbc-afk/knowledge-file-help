const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } = require("electron");
const { createStore } = require("./store");

let mainWindow;
let store;

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
    const stats = require("fs").statSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      ext: path.extname(filePath).replace(".", "").toLowerCase(),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  });
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
