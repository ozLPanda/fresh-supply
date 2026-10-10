const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ovoshiDesktop", {
  setup: (credentials) => ipcRenderer.invoke("desktop:setup", credentials),
  importFromSite: (credentials) =>
    ipcRenderer.invoke("desktop:import", credentials),
  cancelImport: () => ipcRenderer.invoke("desktop:import-cancel"),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:status", handler);
    return () => ipcRenderer.removeListener("desktop:status", handler);
  },
});
