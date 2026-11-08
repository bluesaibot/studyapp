import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createScheduler } from '../core/scheduler'
import { localDate } from '../core/streak'
import { API_METHODS, SNAPSHOT_CHANNEL, type Snapshot } from '../shared/api'
import { MEDIA_SCHEME } from '../shared/media'
import { backupOnLaunch } from './backup'
import { Controller } from './controller'
import { openDb } from './db'
import { importLernskript } from './importer'
import { openStudy } from './study'

app.setName('StudyApp')
const dataDir = process.env.STUDYAPP_DATA_DIR ?? join(app.getPath('appData'), 'StudyApp')
mkdirSync(dataDir, { recursive: true })
app.setPath('userData', dataDir)
const mediaRoot = join(dataDir, 'media')

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

/** Serves Lernskript figures to the windows, and nothing outside the media folder. */
function serveMedia() {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const file = resolve(mediaRoot, `.${decodeURIComponent(new URL(request.url).pathname)}`)
    if (!file.startsWith(resolve(mediaRoot) + sep)) return new Response(null, { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

let mainWindow: BrowserWindow | null = null
let pillWindow: BrowserWindow | null = null
let sessionActive = false
let quitting = false

function loadRoute(window: BrowserWindow, route: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void window.loadURL(`${devUrl}#${route}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

const webPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  autoplayPolicy: 'no-user-gesture-required' as const,
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: 'StudyApp',
    backgroundColor: '#dce9e4',
    titleBarStyle: 'hiddenInset',
    webPreferences,
  })
  loadRoute(mainWindow, 'main')
  mainWindow.on('focus', () => pillWindow?.hide())
  mainWindow.on('blur', () => {
    if (sessionActive) pillWindow?.showInactive()
  })
  // Closing the window during a session keeps the timer going in the pill.
  mainWindow.on('close', (event) => {
    if (sessionActive && !quitting) {
      event.preventDefault()
      mainWindow?.hide()
      pillWindow?.showInactive()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createPillWindow() {
  pillWindow = new BrowserWindow({
    width: 260,
    height: 76,
    x: 24,
    y: 48,
    frame: false,
    transparent: true,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences,
  })
  pillWindow.setAlwaysOnTop(true, 'floating')
  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadRoute(pillWindow, 'pill')
}

function showMain() {
  if (!mainWindow) createMainWindow()
  mainWindow?.show()
  app.focus({ steal: true })
}

function broadcast(snapshot: Snapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(SNAPSHOT_CHANNEL, snapshot)
  }
}

app.whenReady().then(async () => {
  serveMedia()
  const db = openDb(dataDir)
  await backupOnLaunch(db, dataDir).catch((error: unknown) => console.error('Backup failed', error))
  const study = openStudy(db, await createScheduler(), () => localDate(new Date()))
  const controller = new Controller(
    db,
    study,
    {
      broadcast,
      onEvent(event) {
        if (event.type === 'blockDone') showMain()
        if (event.type === 'breakOver') {
          new Notification({ title: 'Break is over', body: 'Carry on whenever you are ready.', silent: true }).show()
        }
      },
      onSessionChange(active) {
        sessionActive = active
        if (!active) pillWindow?.hide()
        else if (!mainWindow?.isFocused()) pillWindow?.showInactive()
      },
    },
    Number(process.env.STUDYAPP_SPEED ?? 1),
  )

  const runImport = (path: string) => {
    try {
      return importLernskript(path, study, mediaRoot)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function pickAndImport() {
    const uni = join(homedir(), 'Desktop/uni')
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a course or Lernskript folder',
      buttonLabel: 'Import',
      defaultPath: existsSync(uni) ? uni : homedir(),
      properties: ['openDirectory', 'openFile'],
      filters: [{ name: 'Lernskript', extensions: ['qmd'] }],
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : runImport(result.filePaths[0])
  }

  const handlers: Record<(typeof API_METHODS)[number], (...args: never[]) => unknown> = {
    getSnapshot: () => controller.snapshot(),
    start: (task: string) => controller.start(task),
    pause: () => controller.pause(),
    resume: () => controller.resume(),
    dip: () => controller.dip(),
    miniGoal: () => controller.miniGoal(),
    setTask: (task: string) => controller.setTask(task),
    takeBreak: () => controller.takeBreak(),
    returnFromBreak: () => controller.returnFromBreak(),
    end: () => controller.end(),
    dismissSummary: () => controller.dismissSummary(),
    water: (plantId: number) => controller.water(plantId),
    useFund: (fundId: number, plantId: number | null) => controller.useFund(fundId, plantId),
    setCurrentPlant: (plantId: number) => controller.setCurrentPlant(plantId),
    renamePlant: (plantId: number, name: string) => controller.renamePlant(plantId, name),
    setSettings: (settings: Parameters<Controller['setSettings']>[0]) => controller.setSettings(settings),
    showMain: () => showMain(),
    courses: () => study.courses(),
    importCourse: () => pickAndImport(),
    reimportCourse: (courseId: number) => {
      const path = study.sourcePath(courseId)
      return path ? runImport(path) : null
    },
    renameCourse: (courseId: number, name: string) => study.renameCourse(courseId, name),
    chapters: (courseId: number) => study.chapters(courseId),
    chapterBody: (chapterId: number) => study.chapterBody(chapterId),
    nextItem: (request: Parameters<typeof study.nextItem>[0]) => study.nextItem(request),
    review: (request: Parameters<Controller['review']>[0]) => controller.review(request),
  }
  for (const method of API_METHODS) {
    const handler = handlers[method] as (...args: unknown[]) => unknown
    ipcMain.handle(method, (_event, ...args: unknown[]) => handler(...args))
  }

  createMainWindow()
  createPillWindow()

  app.on('activate', showMain)
  app.on('before-quit', () => {
    quitting = true
    controller.end()
    db.close()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
