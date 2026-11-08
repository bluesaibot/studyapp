import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { API_METHODS, SNAPSHOT_CHANNEL, type Snapshot } from '../shared/api'

const invokers = Object.fromEntries(
  API_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(method, ...args)]),
)

contextBridge.exposeInMainWorld('api', {
  ...invokers,
  onSnapshot(listener: (snapshot: Snapshot) => void) {
    const wrapped = (_event: IpcRendererEvent, snapshot: Snapshot) => listener(snapshot)
    ipcRenderer.on(SNAPSHOT_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(SNAPSHOT_CHANNEL, wrapped)
  },
})
