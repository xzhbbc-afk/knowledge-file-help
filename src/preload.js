const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fileKb", {
  load: () => ipcRenderer.invoke("store:load"),
  save: (data) => ipcRenderer.invoke("store:save", data),
  chooseFiles: () => ipcRenderer.invoke("files:choose"),
  chooseDirectory: () => ipcRenderer.invoke("dirs:choose"),
  syncCategoryFolders: (payload) => ipcRenderer.invoke("dirs:sync-category-folders", payload),
  importToLibrary: (payload) => ipcRenderer.invoke("files:import-to-library", payload),
  relocateLibraryFile: (payload) => ipcRenderer.invoke("files:relocate-library-file", payload),
  checkFiles: (files) => ipcRenderer.invoke("files:check", files),
  scanLibrary: (payload) => ipcRenderer.invoke("library:scan", payload),
  openFile: (filePath) => ipcRenderer.invoke("files:open", filePath),
  showInFolder: (filePath) => ipcRenderer.invoke("files:show", filePath)
});
