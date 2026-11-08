// Drives the built app with a throwaway data folder and saves screenshots of each screen.
// Run with: electron-vite build && electron scripts/screenshots.cjs <output-folder>
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const outDir = process.argv[2] ?? join(tmpdir(), 'studyapp-shots')
mkdirSync(outDir, { recursive: true })
process.env.STUDYAPP_DATA_DIR = mkdtempSync(join(tmpdir(), 'studyapp-data-'))
process.env.STUDYAPP_SPEED = '60'

require(join(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function shoot(window, name) {
  await wait(400)
  const text = await window.webContents.executeJavaScript('document.body.innerText')
  console.log(`[${name}]`, text.replace(/\s+/g, ' ').slice(0, 70))
  const image = await window.webContents.capturePage()
  writeFileSync(join(outDir, `${name}.png`), image.toPNG())
}

function waitForPhase(main, phase) {
  return main.webContents.executeJavaScript(`new Promise((resolve) => {
    const off = window.api.onSnapshot((s) => {
      if (s.session?.phase === ${JSON.stringify(phase)}) { off(); resolve(true) }
    })
  })`)
}

app.whenReady().then(async () => {
  await wait(1500)
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((w) => w.webContents.getURL().includes('#main'))
  const pill = windows.find((w) => w.webContents.getURL().includes('#pill'))
  const api = (call) => main.webContents.executeJavaScript(`window.api.${call}`)

  await shoot(main, '1-home')
  await api(`start('Zellbiologie, Kapitel 6')`)
  await wait(4000)
  await shoot(main, '2-session')
  pill.showInactive()
  await shoot(pill, '3-pill')
  await main.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.textContent === "I'm losing steam").click()`)
  await shoot(main, '4-dip')
  await main.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.textContent === "I'm fine again").click()`)
  await waitForPhase(main, 'break')
  await shoot(main, '5-break')
  await waitForPhase(main, 'breakOver')
  await shoot(main, '6-break-over')
  await api('returnFromBreak()')
  await wait(1000)
  await api('end()')
  await shoot(main, '7-summary')
  const snapshot = await api('getSnapshot()')
  console.log(JSON.stringify({
    wallet: snapshot.wallet,
    plants: snapshot.plants.map((p) => ({ species: p.genome.species, growth: p.growth })),
    funds: snapshot.funds.length,
    today: snapshot.todayFocusMs,
    streak: snapshot.streak,
  }))
  const gallery = new BrowserWindow({ width: 1000, height: 1600, show: false, webPreferences: { offscreen: false } })
  await gallery.loadFile(join(__dirname, '../out/renderer/index.html'), { hash: 'gallery' })
  await shoot(gallery, '8-gallery')
  await gallery.webContents.executeJavaScript('window.scrollTo(0, 900)')
  await shoot(gallery, '9-gallery-lower')
  app.quit()
})
