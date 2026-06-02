const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fileKb", {
  load: () => ipcRenderer.invoke("store:load"),
  save: (data) => ipcRenderer.invoke("store:save", data),
  chooseFiles: () => ipcRenderer.invoke("files:choose"),
  openFile: (filePath) => ipcRenderer.invoke("files:open", filePath),
  showInFolder: (filePath) => ipcRenderer.invoke("files:show", filePath)
});
