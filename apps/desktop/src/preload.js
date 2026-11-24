const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('haust', {
  airconRequest: (url) => ipcRenderer.invoke('haust:airconRequest', url),
  status: () => ipcRenderer.invoke('haust:status'),
  login: () => ipcRenderer.invoke('haust:login'),
  refreshCourses: () => ipcRenderer.invoke('haust:refreshCourses'),
  refreshExams: () => ipcRenderer.invoke('haust:refreshExams'),
  refreshNotices: () => ipcRenderer.invoke('haust:refreshNotices'),
  refreshChargers: () => ipcRenderer.invoke('haust:refreshChargers'),
  refreshCard: () => ipcRenderer.invoke('haust:refreshCard'),
  noticeBody: (item) => ipcRenderer.invoke('haust:noticeBody', item),
  cached: () => ipcRenderer.invoke('haust:cached'),
  credStatus: () => ipcRenderer.invoke('haust:credStatus'),
  clearCred: () => ipcRenderer.invoke('haust:clearCred'),
  clearCache: () => ipcRenderer.invoke('haust:clearCache'),
  openExternal: (url) => ipcRenderer.invoke('haust:openExternal', url),
  onSession: (cb) => {
    const handler = (_e, st) => cb(st)
    ipcRenderer.on('haust:session', handler)
    return () => ipcRenderer.removeListener('haust:session', handler)
  }
})
