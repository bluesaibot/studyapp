// Drives the built app through the study features with a throwaway data folder and saves screenshots.
// Your Lernskripte are only read. Run with:
// electron-vite build && electron scripts/study-flow.cjs <output-folder> <lernskript-folder>...
const electron = require('electron')
const { app, BrowserWindow, dialog } = electron
const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const [outDir, ...sources] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'studyapp-data-'))
process.env.STUDYAPP_DATA_DIR = dataDir

let nextPick = null
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextPick] })

require(join(__dirname, '../out/main/index.js'))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const problems = []

app.whenReady().then(async () => {
  await wait(1500)
  const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('#main'))
  main.show()
  main.webContents.on('console-message', (event) => {
    if (event.level === 'error') problems.push(event.message.slice(0, 200))
  })
  const js = (code) => main.webContents.executeJavaScript(code)
  const api = (call) => js(`window.api.${call}`)
  const click = (label) => js(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith(${JSON.stringify(label)}))
    if (!b) throw new Error('no button: ' + ${JSON.stringify(label)})
    b.click()
  })()`)
  const shoot = async (name) => {
    // A window in the background paints lazily, so ask for a fresh frame before capturing.
    main.webContents.invalidate()
    await wait(900)
    main.webContents.invalidate()
    await wait(300)
    const text = await js('document.body.innerText')
    console.log(`[${name}]`, text.replace(/\s+/g, ' ').slice(0, 170))
    const image = await main.webContents.capturePage()
    writeFileSync(join(outDir, `${name}.png`), image.toPNG())
  }
  const expect = (label, condition, detail) => {
    console.log(condition ? 'ok  ' : 'FAIL', label, detail ?? '')
    if (!condition) problems.push(label)
  }

  await click('Open library')
  await shoot('01-library-empty')

  for (const source of sources) {
    nextPick = source
    const report = await api('importCourse()')
    console.log(JSON.stringify(report).slice(0, 400))
    expect(`import ${source.split('/').slice(-2).join('/')}`, report && !('error' in report), report?.error)
  }
  nextPick = tmpdir()
  const refused = await api('importCourse()')
  expect('a folder without a Lernskript is refused with a message', refused && 'error' in refused, refused?.error)

  const courses = await api('courses()')
  console.log(courses.map((c) => `${c.name}: ${c.cards} cards ${c.questions} q ${c.cardsReady}/${c.questionsReady} ready`).join('\n'))
  const biochem = courses[courses.length - 1].sourcePath.includes('biochem') ? courses[courses.length - 1] : courses.find((c) => c.sourcePath.includes('biochem'))
  const cell = courses.find((c) => c.sourcePath.includes('cellbiology'))
  const images = (id) => { try { return readdirSync(join(dataDir, 'media', String(id)), { recursive: true }).filter((f) => /\.(png|jpe?g)$/.test(f)) } catch { return [] } }
  expect('zipped Zellbio figures were extracted', images(cell.id).length >= 80, images(cell.id).length)
  expect('Biochem figures were copied', images(biochem.id).length >= 25, images(biochem.id).length)

  // Reload so the app's own state reflects the imports, then open a course from the library.
  await js('location.reload()')
  await wait(1200)
  await click('Open library')
  await wait(300)
  await shoot('02-library')

  // Reader: formulas, figures, callouts and subscripts.
  const chapterList = await api(`chapters(${biochem.id})`)
  expect('Biochem Anhang reads last', chapterList[chapterList.length - 1].title === 'Anhang')
  await js(`[...document.querySelectorAll('article')].find((a) => a.querySelector('input').value === ${JSON.stringify(biochem.name)}).querySelectorAll('button').forEach((b) => { if (b.textContent === 'Read') b.click() })`)
  await wait(900)
  await shoot('03-reader')
  await click('2. Chromatographie').catch(() => js(`[...document.querySelectorAll('.reader-chapters button')][3].click()`))
  await wait(1200)
  await shoot('04-reader-figures')
  const reader = await js(`({
    figures: document.querySelectorAll('.prose img').length,
    loaded: [...document.querySelectorAll('.prose img')].filter((i) => i.complete && i.naturalWidth > 0).length,
    leftovers: document.querySelector('.prose').innerText.match(/:::|\\{\\.|\\{#|~[^ ~]+~|\\\\[a-zA-Z]+/g),
    subs: document.querySelectorAll('.prose sub').length,
    errors: document.querySelectorAll('.katex-error').length,
  })`)
  console.log(JSON.stringify(reader))
  expect('no raw Quarto syntax in the chapter', !reader.leftovers, String(reader.leftovers))
  await js(`document.querySelector('.reader-text').querySelectorAll('img').forEach((i) => { i.loading = 'eager'; i.scrollIntoView() })`)
  await wait(1200)
  const loaded = await js(`[...document.querySelectorAll('.prose img')].filter((i) => i.complete && i.naturalWidth > 0).length`)
  expect('figures load through the media protocol', loaded > 0 && loaded === reader.figures, `${loaded}/${reader.figures}`)
  await shoot('05-reader-figure-visible')

  // Every chapter of every course renders without leftovers or formula errors.
  const allCourses = await api('courses()')
  const courseSelect = `document.querySelector('select[aria-label="Course"]')`
  const pickCourse = (id) => js(`(() => {
    const select = ${courseSelect}
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${id}')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  for (const course of allCourses) {
    await pickCourse(course.id)
    await wait(500)
    const total = await js(`document.querySelectorAll('.reader-chapters button').length`)
    const found = { chapters: total, formulas: 0, tables: 0, callouts: 0, images: 0, katexErrors: [], leftovers: [] }
    for (let index = 0; index < total; index += 1) {
      await js(`document.querySelectorAll('.reader-chapters button')[${index}].click()`)
      await wait(220)
      const page = await js(`(() => {
        const prose = document.querySelector('.reader-text .prose')
        return {
          title: document.querySelectorAll('.reader-chapters button')[${index}].textContent,
          formulas: prose.querySelectorAll('.katex').length,
          tables: prose.querySelectorAll('table').length,
          callouts: prose.querySelectorAll('.callout').length,
          images: prose.querySelectorAll('img').length,
          katexErrors: [...prose.querySelectorAll('.katex-error')].map((e) => e.textContent.slice(0, 60)),
          leftovers: (prose.innerText.match(/^:::.*$|\\{[.#-][^}]*\\}|\\\\[a-zA-Z]{2,}\\{?|\\$\\S|\\[-?@[^\\]]*\\]|~[^\\s~]+~|\\^[^\\s^]+\\^/gm) || []).slice(0, 4),
        }
      })()`)
      found.formulas += page.formulas
      found.tables += page.tables
      found.callouts += page.callouts
      found.images += page.images
      for (const error of page.katexErrors) found.katexErrors.push(`${page.title}: ${error}`)
      for (const leftover of page.leftovers) found.leftovers.push(`${page.title.slice(0, 30)}: ${leftover}`)
    }
    console.log(course.name, JSON.stringify(found))
    expect(`${course.name} has no formula errors`, found.katexErrors.length === 0)
    expect(`${course.name} shows no raw source syntax`, found.leftovers.length === 0)
  }
  // Pictures for a look: a callout with a figure, and formulas.
  await pickCourse(cell.id)
  await wait(500)
  await js(`[...document.querySelectorAll('.reader-chapters button')].find((b) => b.textContent.startsWith('2.')).click()`)
  await wait(900)
  await js(`document.querySelector('.reader-text .prose img')?.scrollIntoView()`)
  await wait(900)
  await shoot('05a-figure')
  await js(`[...document.querySelectorAll('.reader-text .callout-important, .reader-text .callout-warning')][0]?.scrollIntoView()`)
  await shoot('05b-correction')
  await pickCourse(biochem.id)
  await wait(500)
  await js(`[...document.querySelectorAll('.reader-chapters button')].find((b) => b.textContent.startsWith('4.')).click()`)
  await wait(700)
  await js(`document.querySelector('.reader-text .katex-display')?.scrollIntoView()`)
  await shoot('05c-formula')
  await js(`[...document.querySelectorAll('.reader-chapters button')].find((b) => b.textContent.startsWith('2.')).click()`)
  await wait(500)

  // Cards: the first answer starts a session by itself.
  await click('Cards')
  await wait(800)
  await shoot('06-card-front')
  const before = await api('getSnapshot()')
  expect('no session yet when only reading', before.session === null)
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`)
  await wait(500)
  await shoot('07-card-back')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))`)
  await wait(900)
  let snapshot = await api('getSnapshot()')
  expect('first answer starts a session', snapshot.session !== null, snapshot.session?.task)
  for (const rating of [3, 3, 4, 2, 3]) {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`)
    await wait(150)
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${rating}' }))`)
    await wait(350)
  }
  snapshot = await api('getSnapshot()')
  expect('six cards counted', snapshot.session.cardsReviewed === 6, snapshot.session.cardsReviewed)
  expect('a card rated Again still earned sun', snapshot.session.earnedSun >= 3, snapshot.session.earnedSun)
  await shoot('08-session-bar')

  // Open question with a typed answer; rating it "Not yet" puts it on the Fehlerliste.
  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.startsWith('Open questions')).click()`)
  await wait(800)
  await js(`(() => {
    const area = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(area, 'Am IEP ist die Nettoladung null.')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await shoot('09-question')
  await click('Show answer')
  await wait(400)
  await shoot('10-question-answer')
  await click('Not yet')
  await wait(800)
  snapshot = await api('getSnapshot()')
  expect('question counted with its 5 sun', snapshot.session.questionsAnswered === 1, snapshot.session.earnedSun)
  let row = (await api('courses()')).find((c) => c.id === biochem.id)
  expect('the Fehlerliste holds the card and the question', row.mistakes === 2, row.mistakes)

  // A block ending mid-answer: the typed text must still be there after the break.
  await js(`(() => {
    const area = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(area, 'halb geschriebene Antwort')
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await api('takeBreak()')
  await wait(500)
  await shoot('11-break-during-question')
  await api('returnFromBreak()')
  await wait(500)
  expect('typed answer survives a break', (await js(`document.querySelector('textarea')?.value`)) === 'halb geschriebene Antwort')

  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent === "I'm losing steam").click()`)
  await wait(300)
  await shoot('12-dip-in-workspace')
  await click('10 easy cards')
  await wait(800)
  await shoot('13-easy-cards')

  // Re-importing keeps every bit of progress.
  const progressBefore = (await api('courses()')).find((c) => c.id === biochem.id)
  const again = await api(`reimportCourse(${biochem.id})`)
  const progressAfter = (await api('courses()')).find((c) => c.id === biochem.id)
  expect('re-import adds nothing and keeps progress', again.added === 0 && progressAfter.reviewed === progressBefore.reviewed && progressAfter.mistakes === progressBefore.mistakes, JSON.stringify({ added: again.added, updated: again.updated, retired: again.retired, reviewed: progressAfter.reviewed }))

  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.startsWith('Open questions')).click()`)
  await wait(500)
  for (let i = 0; i < 5; i += 1) {
    await click('Show answer')
    await wait(150)
    await click('Got it')
    await wait(350)
  }
  // Multiple choice: tick by click and by number key, check, and a slip goes on the Fehlerliste.
  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent.startsWith('Cards')).click()`)
  await wait(400)
  const waeg = (await api(`chapters(${biochem.id})`)).find((chapter) => chapter.title.startsWith('Altfragen: Wäg'))
  await js(`(() => {
    const select = document.querySelector('select[aria-label="Chapter"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${waeg.id}')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(700)
  expect('four statements to tick', (await js(`document.querySelectorAll('.choice').length`)) === 4)
  const reasonsHidden = await js(`!document.querySelector('.choice-reason')`)
  expect('no verdict is visible before checking', reasonsHidden)
  await js(`document.querySelectorAll('.choice')[0].click()`)
  await wait(100)
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }))`)
  await wait(150)
  expect('click and number key both tick', (await js(`document.querySelectorAll('.choice.picked').length`)) === 2)
  await shoot('13a-choice')
  await click('Check')
  await wait(300)
  const score = await js(`document.querySelector('.choice-score').textContent`)
  const offCount = await js(`document.querySelectorAll('.choice.off').length`)
  expect('verdicts and reasons appear', (await js(`document.querySelectorAll('.choice-reason').length`)) === 4, score)
  await shoot('13b-choice-checked')
  const mistakesBefore = (await api('courses()')).find((c) => c.id === biochem.id).mistakes
  await click('Next')
  await wait(500)
  const mistakesAfter = (await api('courses()')).find((c) => c.id === biochem.id).mistakes
  expect('a slip joins the Fehlerliste, a clean round does not', mistakesAfter === mistakesBefore + (offCount > 0 ? 1 : 0), `${offCount} off`)
  expect('the next question has nothing ticked', (await js(`document.querySelectorAll('.choice.picked').length`)) === 0)

  // All cards: starts at the first card of the chapter even though it was just answered, and walks through.
  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent === 'All cards').click()`)
  await wait(700)
  const firstMeta = await js(`document.querySelector('.deck-meta').textContent`)
  expect('all cards starts at number 1, already answered or not', firstMeta.startsWith('1 of 28, Frage 1'), firstMeta)
  await click('Check')
  await wait(150)
  await click('Next')
  await wait(500)
  const secondMeta = await js(`document.querySelector('.deck-meta').textContent`)
  expect('all cards moves on to the next one', secondMeta.startsWith('2 of 28, Frage 2'), secondMeta)
  await shoot('13c-all-cards')

  await click('Back to timer')
  await wait(400)
  expect('back to timer shows the timer', (await js(`Boolean(document.querySelector('.session-time'))`)))
  await shoot('14-session-with-study')
  await click('Done for now')
  await wait(500)
  await shoot('15-summary')
  await click('Done')
  await wait(400)
  await shoot('16-home')

  // Growth animation: watering a seed takes it past the sprout threshold, frame by frame.
  await click('Open garden')
  await wait(500)
  await js('window.scrollTo(0, 0)')
  const frameData = () => js(`({ leaves: document.querySelectorAll('.foliage > g[transform]').length, spurt: Boolean(document.querySelector('.foliage.spurt')) })`)
  console.log('before watering', JSON.stringify(await frameData()), (await api('getSnapshot()')).wallet)
  await click('Water')
  const seen = []
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    await wait(280)
    seen.push(await frameData())
    const image = await main.webContents.capturePage()
    writeFileSync(join(outDir, `20-growth-${name}.png`), image.toPNG())
  }
  await wait(900)
  seen.push(await frameData())
  console.log(JSON.stringify(seen), Math.round((await api('getSnapshot()')).plants[0].growth))
  expect('the plant spurts while it grows', seen.some((frame) => frame.spurt))
  expect('the spurt ends', !seen[seen.length - 1].spurt)
  expect('leaves appear one after another, not at once', new Set(seen.map((frame) => frame.leaves)).size >= 3, seen.map((frame) => frame.leaves).join(','))

  console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].join('\n')}` : 'no problems')
  app.quit()
})
