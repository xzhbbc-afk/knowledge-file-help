const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fileKb", {
  load: () => ipcRenderer.invoke("store:load"),
  save: (data) => ipcRenderer.invoke("store:save", data),
  chooseFiles: () => ipcRenderer.invoke("files:choose"),
  chooseDirectory: () => ipcRenderer.invoke("dirs:choose"),
  importToLibrary: (payload) => ipcRenderer.invoke("files:import-to-library", payload),
  openFile: (filePath) => ipcRenderer.invoke("files:open", filePath),
  showInFolder: (filePath) => ipcRenderer.invoke("files:show", filePath)
});
