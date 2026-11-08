// Turns build/icon.svg into build/icon.icns. Run with: electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const buildDir = join(__dirname, '../build')

app.whenReady().then(async () => {
  const page = new BrowserWindow({ show: false })
  await page.loadURL('about:blank')
  const svg = readFileSync(join(buildDir, 'icon.svg')).toString('base64')
  const png = await page.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('The icon did not load'))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1024
      canvas.getContext('2d').drawImage(image, 0, 0, 1024, 1024)
      resolve(canvas.toDataURL('image/png').split(',')[1])
    }
    image.src = 'data:image/svg+xml;base64,${svg}'
  })`)
  const master = join(buildDir, 'icon.png')
  writeFileSync(master, Buffer.from(png, 'base64'))

  const work = mkdtempSync(join(tmpdir(), 'studyapp-icon-'))
  const set = join(work, 'icon.iconset')
  mkdirSync(set)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
      execFileSync('sips', ['-z', String(size * scale), String(size * scale), master, '--out', join(set, name)], { stdio: 'ignore' })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(buildDir, 'icon.icns')])
  rmSync(work, { recursive: true })
  app.quit()
})
