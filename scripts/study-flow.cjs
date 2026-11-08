// Drives the built app through the study features with a throwaway data folder and saves screenshots.
// Your Lernskripte are only read. Run with:
// electron-vite build && electron scripts/study-flow.cjs <output-folder> ~/Desktop/uni/biochemische_-bungen_seminar
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

// A failed step must not leave a test window open, where it looks like the real app.
process.on('unhandledRejection', (error) => {
  console.error(error)
  app.exit(1)
})

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
    // Capturing fails now and then when the window is covered. A missing picture is not a failed check.
    try {
      const image = await main.webContents.capturePage()
      writeFileSync(join(outDir, `${name}.png`), image.toPNG())
    } catch (error) {
      console.log(`  no picture for ${name}: ${error.message}`)
    }
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
  const images = (id) => { try { return readdirSync(join(dataDir, 'media', String(id)), { recursive: true }).filter((f) => /\.(png|jpe?g)$/.test(f)) } catch { return [] } }
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
    if (!select) return
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
  await wait(500)
  // The chapter just read has no cards of its own, so practise across the whole course.
  await js(`(() => {
    const select = document.querySelector('select[aria-label="Chapter"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(600)
  await shoot('06-card-front')
  const before = await api('getSnapshot()')
  expect('no session yet when only reading', before.session === null)
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`)
  await wait(500)
  await shoot('07-card-back')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`)
  await wait(900)
  let snapshot = await api('getSnapshot()')
  expect('first answer starts a session', snapshot.session !== null, snapshot.session?.task)
  for (let i = 0; i < 5; i += 1) {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`)
    await wait(150)
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`)
    await wait(350)
  }
  snapshot = await api('getSnapshot()')
  expect('six cards counted', snapshot.session.cardsReviewed === 6, snapshot.session.cardsReviewed)
  expect('cards earned sun, right or wrong', snapshot.session.earnedSun >= 3, snapshot.session.earnedSun)
  await shoot('08-session-bar')

  // Open question with a typed answer; rating it "Not yet" puts it on the Fehlerliste.
  const biochemCards = (await api('courses()')).find((c) => c.id === biochem.id).cards
  expect('Biochemie has only its 28 multiple choice cards', biochemCards === 28, biochemCards)
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
  expect('the question is on the Fehlerliste', row.mistakes >= 1, row.mistakes)

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
  const packed = await api(`nextItem({ courseId: ${biochem.id}, mode: 'all', kind: 'question', chapterId: ${waeg.id} })`)
  expect('the reviewed pack brought its open questions', packed?.key !== null && packed?.label?.startsWith('Wäg-Test'), packed?.label)
  const corrected = []
  for (let after = 0, item; (item = await api(`nextItem({ courseId: ${biochem.id}, mode: 'all', kind: 'card', chapterId: ${waeg.id}, afterPosition: ${'${after}'} })`.replace('${after}', after))); after = item.position) {
    for (const option of item.options ?? []) if (option.note) corrected.push(item.label.split(':')[0])
  }
  expect('three corrected marks are explained on their cards', corrected.length === 3, corrected.join(', '))
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

  // Open question sun: 1 when quick, topped up to 5 after a minute, and only once a day per question.
  const sunBonus = async (itemId, thinkingMs) => {
    const before = (await api('getSnapshot()')).session.earnedSun
    await api(`review({ itemId: ${itemId}, rating: 3, thinkingMs: ${thinkingMs} })`)
    return (await api('getSnapshot()')).session.earnedSun - before
  }
  const multiplier = (await api('getSnapshot()')).session.streakMultiplier
  const near = (value, expected) => Math.abs(value - expected * multiplier) < 0.5 * multiplier
  const fresh = []
  for (let after = 0, item; fresh.length < 9 && (item = await api(`nextItem({ courseId: ${biochem.id}, mode: 'all', kind: 'question', afterPosition: ${'${after}'} })`.replace('${after}', after))); after = item.position) {
    if (item.isNew) fresh.push(item.id)
  }
  const quick = await sunBonus(fresh[0], 5000)
  const quickAgain = await sunBonus(fresh[0], 5000)
  const toppedUp = await sunBonus(fresh[0], 70000)
  const thirdTime = await sunBonus(fresh[0], 70000)
  expect('a quick answer pays 1 sun', near(quick, 1), quick)
  expect('the same quick answer pays nothing more', near(quickAgain, 0), quickAgain)
  expect('a minute with it tops up to the full 5', near(toppedUp, 4), toppedUp)
  expect('after that it pays nothing more today', near(thirdTime, 0), thirdTime)
  expect('another question pays its full 5', near(await sunBonus(fresh[1], 70000), 5))

  // All open questions: only questions, in order, past the daily limit, and separate from the card deck.
  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent === 'All open questions').click()`)
  await wait(700)
  await js(`(() => {
    const select = document.querySelector('select[aria-label="Chapter"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(700)
  const questionMeta = await js(`document.querySelector('.deck-meta').textContent`)
  const questionTotal = (await api('courses()')).find((c) => c.id === biochem.id).questions
  expect('all open questions starts at 1 of all of them', questionMeta.startsWith(`1 of ${questionTotal},`), questionMeta)
  expect('all open questions shows no multiple choice', (await js(`document.querySelectorAll('.choice').length`)) === 0)
  expect('a question brings its answer field', await js(`Boolean(document.querySelector('textarea'))`))
  await click('Show answer')
  await wait(200)
  await click('Got it')
  await wait(500)
  const nextQuestion = await js(`document.querySelector('.deck-meta').textContent`)
  expect('all open questions moves on', nextQuestion.startsWith(`2 of ${questionTotal},`), nextQuestion)
  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent === 'All cards').click()`)
  await wait(500)
  await click('Check')
  await wait(150)
  await click('Next')
  await wait(500)
  const cardsAfter = await js(`document.querySelector('.deck-meta').textContent`)
  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent === 'All open questions').click()`)
  await wait(500)
  const questionsBack = await js(`document.querySelector('.deck-meta').textContent`)
  expect('the question deck keeps its place', questionsBack.startsWith(`2 of ${questionTotal},`), questionsBack)
  await js(`[...document.querySelectorAll('.tab')].find((b) => b.textContent === 'All cards').click()`)
  await wait(500)
  const cardsBack = await js(`document.querySelector('.deck-meta').textContent`)
  expect('the card deck keeps its place', cardsAfter.startsWith('2 of 28') && cardsBack.startsWith('2 of 28'), cardsBack)
  await shoot('13d-all-questions')

  // Exam time: before it the course is current, after it greyed out with a grade to enter.
  const pad = (n) => String(n).padStart(2, '0')
  const nowDate = new Date()
  const todayKey = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`
  await api(`addEvent({ title: 'Probeklausur', date: '${todayKey}', kind: 'exam', courseId: ${biochem.id}, topic: null, effort: null, time: '23:59' })`)
  const probe = (await api('getSnapshot()')).calendar.events.find((event) => event.title === 'Probeklausur')
  const funds = (await api('getSnapshot()')).funds.length
  await api(`setGrade(${probe.id}, 2)`)
  expect('no grade before the exam time', (await api('getSnapshot()')).funds.length === funds)
  await api(`setEventTime(${probe.id}, '00:00')`)
  await api(`setGrade(${probe.id}, 2)`)
  expect('after the time the grade pays', (await api('getSnapshot()')).funds.length === funds + 2)

  // Reset: asks first, then every item is new again, and sun and plants stay as they were.
  const beforeReset = await api('getSnapshot()')
  const courseBeforeReset = (await api('courses()')).find((c) => c.id === biochem.id)
  await click('Reset progress')
  await wait(300)
  expect('reset asks first', (await api('courses()')).find((c) => c.id === biochem.id).reviewed === courseBeforeReset.reviewed)
  await shoot('13e-reset-question')
  await click('Keep my progress')
  await wait(200)
  expect('keep changes nothing', (await api('courses()')).find((c) => c.id === biochem.id).reviewed === courseBeforeReset.reviewed)
  await click('Reset progress')
  await wait(200)
  await click('Yes, reset')
  await wait(600)
  const afterReset = await api('getSnapshot()')
  const courseAfterReset = (await api('courses()')).find((c) => c.id === biochem.id)
  expect('reset empties progress and the Fehlerliste', courseAfterReset.reviewed === 0 && courseAfterReset.mistakes === 0, JSON.stringify({ was: courseBeforeReset.reviewed }))
  expect('reset leaves plants alone', JSON.stringify(afterReset.plants.map((p) => p.id)) === JSON.stringify(beforeReset.plants.map((p) => p.id)) && afterReset.plants[0].growth >= beforeReset.plants[0].growth)
  expect('reset leaves sun alone', afterReset.wallet >= beforeReset.wallet && afterReset.session.earnedSun >= beforeReset.session.earnedSun)
  const restarted = await js(`document.querySelector('.deck-meta').textContent`)
  expect('the deck starts over after a reset', restarted.startsWith('1 of 28') && restarted.includes('new'), restarted)

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
  // Switching plants must not pile anything up in the side panel.
  const shelfCount = await js(`document.querySelectorAll('.shelf-plant').length`)
  if (shelfCount > 1) {
    for (let i = 0; i < 4; i += 1) {
      await js(`document.querySelectorAll('.shelf-plant')[${'${i % 2}'}].click()`.replace('${i % 2}', i % 2))
      await wait(150)
    }
  }
  expect('switching plants keeps one name field', (await js(`document.querySelectorAll('.plant-name').length`)) === 1)
  const frameData = () => js(`({ leaves: document.querySelectorAll('.foliage > g[transform]').length, spurt: Boolean(document.querySelector('.foliage.spurt')) })`)
  // Throwaway data: a seed about to sprout, and sun to water it with.
  {
    const Database = require('better-sqlite3')
    const direct = new Database(join(dataDir, 'studyapp.db'))
    direct.prepare("UPDATE plants SET growth = 19.9 WHERE location = 'garden'").run()
    direct.prepare("INSERT INTO meta (key, value) VALUES ('wallet', '20000') ON CONFLICT(key) DO UPDATE SET value = '20000'").run()
    direct.close()
    await api('dismissSummary()')
    await wait(400)
  }
  console.log('before watering', JSON.stringify(await frameData()), (await api('getSnapshot()')).wallet)
  await click('Water')
  await wait(60)
  await click('Water')
  const seen = []
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    await wait(280)
    seen.push(await frameData())
    await main.webContents.capturePage().then((image) => writeFileSync(join(outDir, `20-growth-${name}.png`), image.toPNG())).catch(() => {})
  }
  await wait(1600)
  seen.push(await frameData())
  console.log(JSON.stringify(seen), Math.round((await api('getSnapshot()')).plants[0].growth))
  expect('the plant spurts while it grows', seen.some((frame) => frame.spurt))
  expect('the spurt ends', !seen[seen.length - 1].spurt)
  expect('leaves appear one after another, not at once', seen[0].leaves < seen[seen.length - 1].leaves, seen.map((frame) => frame.leaves).join(','))

  // Shop, soil bench, beds, cutting a leaf, and pollinating next to each other, all on throwaway data.
  const place = (name) => js(`[...document.querySelectorAll('.place-tabs .tab')].find((b) => b.textContent === ${JSON.stringify(name)}).click()`)
  await place('Shop')
  await wait(400)
  await shoot('30-shop')
  await api(`buyShears('shears')`)
  await api(`buySoil('humus', 5)`)
  await api(`buySoil('sphagnum', 5)`)
  await api(`buySoil('charcoal', 5)`)
  await api(`buyPollen()`)
  await api(`buyPot(20)`)
  let snap = await api('getSnapshot()')
  expect('the shop sells shears, soil, pollen and pots', snap.shears === 12 && snap.soilStock.humus === 5 && snap.pollen === 1 && snap.ownedPots.includes(20), JSON.stringify(snap.soilStock))
  await place('Soil bench')
  await wait(400)
  // Real drag and drop: a bag into the tub.
  const bench = await js(`(() => {
    const data = new DataTransfer()
    const bag = [...document.querySelectorAll('.bag')].find((b) => b.textContent.includes('Worm humus'))
    bag.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
    const tub = document.querySelector('.mix-bowl')
    tub.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }))
    tub.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    return data.getData('text/plain')
  })()`)
  await wait(200)
  await click('Sphagnum moss')
  await wait(200)
  expect('dragging a bag fills the tub', bench === 'humus' && (await js(`document.querySelector('.mix-result h3').textContent`)) === '10 L in the tub')
  await shoot('31-soil-bench')
  await click('Mix 10 L')
  await wait(300)
  snap = await api('getSnapshot()')
  expect('mixing uses up the soil', snap.mixes.length === 1 && snap.mixes[0].litres === 10 && !snap.soilStock.humus)
  const stats = snap.mixes[0].stats
  expect('a mix has the kinds of its ingredients, near the recipe', stats.speed > 0.23 && stats.speed < 0.27 && stats.crossing > 0.23 && stats.crossing < 0.27 && stats.mutation === 0, JSON.stringify(stats))
  await api(`fillBed(${snap.beds[0].id}, ${snap.mixes[0].id})`)
  snap = await api('getSnapshot()')
  expect('a bed takes 10 L of a mix', snap.beds[0].soil && snap.mixes.length === 0)

  const garden = snap.plants.find((p) => p.location === 'garden')
  expect('the plant grows in that soil', garden && garden.soil && garden.soil.stats.speed === stats.speed)
  await api(`buyBed()`)
  await api(`buyBed()`)
  const direct = new (require('better-sqlite3'))(join(dataDir, 'studyapp.db'))
  const seedRow = (species, variety, sex, seed) => JSON.stringify({ species, seed, variety, sex, hue: 140, saturation: 45, lightness: 28, size: 1, fenestration: 0.8, variegation: 'none', variegationAmount: 0.5 })
  snap = await api('getSnapshot()')
  const beds = snap.beds
  direct.prepare('UPDATE plants SET bed_id = NULL, location = ?, growth = 700, shelf = 1 WHERE id = ?').run('greenhouse', garden.id)
  const insert = direct.prepare("INSERT INTO plants (genome, growth, created_at, location, bed_id) VALUES (?, 700, ?, 'garden', ?)")
  const female = Number(insert.run(seedRow('monstera', 'deliciosa', 'female', 7001), Date.now(), beds[0].id).lastInsertRowid)
  const male = Number(insert.run(seedRow('monstera', 'adansonii', 'male', 7002), Date.now(), beds[2].id).lastInsertRowid)
  direct.close()
  await api(`startPollination(${female}, ${male})`)
  expect('plants that are not neighbours cannot pollinate', (await api('getSnapshot()')).pollinations.length === 0)
  await api(`swapBeds(${beds[1].id}, ${beds[2].id})`)
  snap = await api('getSnapshot()')
  expect('reordering moves a bed with its plant', snap.beds[1].id === beds[2].id && snap.plants.find((p) => p.id === male).bedId === beds[2].id)
  await api(`startPollination(${female}, ${male})`)
  snap = await api('getSnapshot()')
  expect('neighbours can pollinate', snap.pollinations.length === 1 && snap.pollinations[0].needed === 400)
  const plantsBefore = snap.plants.length
  await place('Garden')
  await wait(400)
  await shoot('32-garden-pollinating')
  await api(`feedPollination(${snap.pollinations[0].id}, 400)`)
  snap = await api('getSnapshot()')
  const child = snap.plants.find((p) => p.origin && p.origin.kind === 'cross')
  expect('the first seed falls into the free bed next door', snap.plants.length === plantsBefore + 1 && child && child.bedId === beds[1].id && child.growth === 0)
  expect('both parents rest after making seeds', snap.plants.find((p) => p.id === female).restLeft > 0 && snap.plants.find((p) => p.id === male).restLeft > 0)

  const wear = snap.shears
  const cuts = snap.nursery.length
  await api(`takeCutting(${female}, 2)`)
  snap = await api('getSnapshot()')
  const cutPlant = snap.plants.find((p) => p.id === female)
  expect('cutting a leaf wears the shears and queues the leaf', snap.shears === wear - 1 && snap.nursery.length === cuts + 1 && cutPlant.leaves.queue[0].index === 2)
  await js(`[...document.querySelectorAll('.bed-plant')][0].click()`)
  await wait(400)
  const leavesBefore = await js(`document.querySelectorAll('.world-main [data-leaf]').length`)
  await click('Cut a leaf')
  await wait(400)
  await shoot('33-cut-a-leaf')
  await js(`document.querySelector('.cut-plant [data-leaf="4"] path').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await wait(400)
  snap = await api('getSnapshot()')
  expect('clicking a leaf cuts exactly that leaf', snap.plants.find((p) => p.id === female).leaves.queue.some((leaf) => leaf.index === 4), leavesBefore)
  await api(`moveToGreenhouse(${male})`)
  await api(`moveToGarden(${garden.id}, null)`)
  await place('Greenhouse')
  await wait(400)
  await shoot('34-greenhouse')
  console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].join('\n')}` : 'no problems')
  app.quit()
})
