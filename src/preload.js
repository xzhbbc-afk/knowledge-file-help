const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fileKb", {
  load: () => ipcRenderer.invoke("store:load"),
  save: (data) => ipcRenderer.invoke("store:save", data),
  stats: (payload) => ipcRenderer.invoke("store:stats", payload),
  backup: (data) => ipcRenderer.invoke("store:backup", data),
  restore: () => ipcRenderer.invoke("store:restore"),
  chooseFiles: () => ipcRenderer.invoke("files:choose"),
  chooseDirectory: () => ipcRenderer.invoke("dirs:choose"),
  syncCategoryFolders: (payload) => ipcRenderer.invoke("dirs:sync-category-folders", payload),
  importToLibrary: (payload) => ipcRenderer.invoke("files:import-to-library", payload),
  relocateLibraryFile: (payload) => ipcRenderer.invoke("files:relocate-library-file", payload),
  checkFiles: (files) => ipcRenderer.invoke("files:check", files),
  scanLibrary: (payload) => ipcRenderer.invoke("library:scan", payload),
  indexTextFiles: (files) => ipcRenderer.invoke("content:index-text-files", files),
  indexOcrFiles: (payload) => ipcRenderer.invoke("content:index-ocr-files", payload),
  onOcrProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("content:ocr-progress", listener);
    return () => ipcRenderer.removeListener("content:ocr-progress", listener);
  },
  searchContent: (query) => ipcRenderer.invoke("content:search", query),
  contentTextByFileIds: (fileIds) => ipcRenderer.invoke("content:text-by-file-ids", fileIds),
  getContentIndex: (fileId) => ipcRenderer.invoke("content:get-index", fileId),
  openFile: (filePath) => ipcRenderer.invoke("files:open", filePath),
  showInFolder: (filePath) => ipcRenderer.invoke("files:show", filePath)
});
