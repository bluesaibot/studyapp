/** Reads Lernskript `.qmd` sources into chapters, cards and open questions. No I/O, no AI. */

export type ItemKind = 'card' | 'question'
export type ItemSource = 'altfrage' | 'auswahl' | 'falle' | 'selbsttest'
export type ItemStatus = 'ok' | 'wrong' | 'imprecise' | 'unverified'

/** One statement of a multiple choice question. */
export interface ItemOption {
  text: string
  correct: boolean
  reason: string
  /** Set when the Lernskript marks the verdict as unsure or not from the Skript. */
  flag: 'unsure' | 'not-in-skript' | null
}

export interface ParsedItem {
  /** Stable across re-imports, so review progress survives a Lernskript update. */
  key: string
  kind: ItemKind
  source: ItemSource
  /** Short reference from the Lernskript, for example A39 or S2.1. */
  label: string | null
  front: string
  back: string
  /** How often the topic came up in past exams. */
  times: number
  status: ItemStatus | null
  options?: ItemOption[]
}

export interface ParsedChapter {
  title: string
  number: number | null
  body: string
  items: ParsedItem[]
}

export interface ParsedCourse {
  title: string | null
  chapters: ParsedChapter[]
  images: string[]
  warnings: string[]
}

export interface SourceFile {
  name: string
  text: string
}

const MACROS: readonly (readonly [RegExp, string])[] = [
  [/\\STok(\{\})?/g, '✅ korrekt'],
  [/\\STfalsch(\{\})?/g, '❌ falsch'],
  [/\\STunv(\{\})?/g, '⚠️ unvollständig/ungenau'],
  [/\\STnis(\{\})?/g, '❓ nicht im Skript'],
  [/\\Sok(\{\})?/g, '✅'],
  [/\\Swarn(\{\})?/g, '⚠️'],
  [/\\Sx(\{\})?/g, '❌'],
]

function stripFrontMatter(text: string): { body: string; title: string | null } {
  const match = /^\s*---\n([\s\S]*?)\n---[ \t]*\n/.exec(text)
  if (!match) return { body: text, title: null }
  const title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(match[1])?.[1] ?? null
  return { body: text.slice(match[0].length), title }
}

function cleanSource(text: string): string {
  let result = text
  for (const [pattern, replacement] of MACROS) result = result.replace(pattern, replacement)
  return result
    .replace(/^\\(newpage|pagebreak|clearpage)\s*$/gm, '')
    .replace(/\)\{(?:width|height|#fig|fig-|\.)[^}\n]*\}/g, ')')
    // Only top-level headings keep their attributes, which say whether a chapter is numbered.
    .replace(/^(#{2,6} .*?)\s*\{[^}\n]*\}[ \t]*$/gm, '$1')
    // Display formulas need their $$ on separate lines to be read as blocks.
    .replace(/^\$\$([\s\S]*?)\$\$(?:[ \t]*\{[^}\n]*\})?[ \t]*$/gm, (_, math: string) => `$$\n${math.trim()}\n$$`)
}

interface Section {
  title: string
  attributes: string
  body: string
}

/** Splits on headings of exactly one level, ignoring anything inside code fences. */
function splitHeadings(text: string, level: number): { intro: string; sections: Section[] } {
  const marker = new RegExp(`^#{${level}} +(.+?)\\s*(\\{[^}]*\\})?\\s*$`)
  const sections: Section[] = []
  const intro: string[] = []
  let current: string[] = intro
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence
    const match = inFence ? null : marker.exec(line)
    if (match) {
      current = []
      sections.push({ title: match[1], attributes: match[2] ?? '', body: '' })
      Object.defineProperty(sections[sections.length - 1], 'lines', { value: current })
    } else {
      current.push(line)
    }
  }
  for (const section of sections) {
    section.body = (section as unknown as { lines: string[] }).lines.join('\n').trim()
  }
  return { intro: intro.join('\n').trim(), sections }
}

function hashText(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

function statusOf(text: string): ItemStatus | null {
  if (text.includes('❌')) return 'wrong'
  if (text.includes('⚠')) return 'imprecise'
  if (text.includes('❓')) return 'unverified'
  if (text.includes('✅')) return 'ok'
  return null
}

/** Puts correction boxes first, so the wrong catalogue answer is never what you read first. */
function correctionsFirst(markdown: string): string {
  const callout = /^:::+\s*\{[^}]*\}[ \t]*\n[\s\S]*?^:::+[ \t]*$/gm
  const corrections: string[] = []
  const rest = markdown.replace(callout, (block) => {
    const opening = block.slice(0, block.indexOf('\n'))
    if (!/Korrektur|Ungenau|Falsch/i.test(opening)) return block
    corrections.push(block)
    return ''
  })
  return [...corrections, rest.trim()].join('\n\n').trim()
}

/** Altfragen with their own heading: `#### A39 · Titel *(1×)* — ❌`. */
function headingAltfragen(body: string): ParsedItem[] {
  const items: ParsedItem[] = []
  for (const section of splitHeadings(body, 4).sections) {
    const match = /^(A\d+\w*)\s*·\s*(.+?)(?:\s*\*\((\d+)×\)\*)?(?:\s*—\s*(.+))?$/.exec(section.title)
    if (!match) continue
    const [, label, title, times, status] = match
    items.push({
      key: `altfrage:${label}`,
      kind: 'card',
      source: 'altfrage',
      label,
      front: title,
      back: correctionsFirst(section.body),
      times: Number(times ?? 1),
      status: statusOf(status ?? ''),
    })
  }
  return items
}

interface Block {
  head: RegExpExecArray
  rest: string
}

/** Blocks that start with a bold lead-in at the start of a line and run until the next one or a heading. */
function leadInBlocks(body: string, start: RegExp): Block[] {
  const blocks: { head: RegExpExecArray; lines: string[] }[] = []
  let current: string[] | null = null
  for (const line of body.split('\n')) {
    const match = start.exec(line)
    if (match) {
      current = [line.slice(match[0].length)]
      blocks.push({ head: match, lines: current })
    } else if (/^#{1,6} /.test(line)) {
      current = null
    } else {
      current?.push(line)
    }
  }
  return blocks.map(({ head, lines }) => ({ head, rest: lines.join('\n').trim() }))
}

/** Altfragen as a paragraph: `**K-8 / K-38 – Titel** · kam 2× · Gegeben: …`. */
function paragraphAltfragen(body: string): ParsedItem[] {
  return leadInBlocks(body, /^\*\*((?:[KA]\d*-?\d+\w*)(?:\s*\/\s*[KA]\d*-?\d+\w*)*)\s*[–-]\s*([^*]+)\*\*/).map(({ head, rest }) => {
    const label = head[1]
    const times = /kam (\d+)×/.exec(rest)
    const text = rest
      .replace(/^\s*·\s*kam \d+×/, '')
      .replace(/^\s*·\s*/, '')
      .trim()
    return {
      key: `altfrage:${label.replace(/\s+/g, '')}`,
      kind: 'card' as const,
      source: 'altfrage' as const,
      label,
      front: head[2].trim(),
      back: correctionsFirst(text),
      times: Number(times?.[1] ?? 1),
      status: statusOf(rest),
    }
  })
}

/** Worked past exam questions: `**Frage 2 (Titel): ⚠️.** …`. */
function numberedAltfragen(body: string): ParsedItem[] {
  const items = leadInBlocks(body, /^\*\*Frage (\d+\w*) \((.+?)\):?\s*([^*]*)\*\*/).map(({ head, rest }) => ({
    key: `altfrage:Frage${head[1]}`,
    kind: 'card' as const,
    source: 'altfrage' as const,
    label: `Frage ${head[1]}`,
    front: head[2].trim(),
    back: correctionsFirst(rest),
    times: 1,
    status: statusOf(head[3]),
  }))
  // "Wie Frage 16." only makes sense in the book, so a card carries the answer it points to.
  return items.map((item) => {
    const target = /^Wie Frage (\d+\w*)\.?$/.exec(item.back)?.[1]
    const answer = items.find((other) => other.label === `Frage ${target}`)?.back
    return answer ? { ...item, back: `${item.back}\n\n${answer}` } : item
  })
}

function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Multiple choice: a `## Frage N` section with a table of statements, verdicts and reasons. */
function multipleChoice(section: Section): ParsedItem[] {
  const match = /^Frage (\d+\w*)/.exec(section.title)
  if (!match) return []
  const lines = section.body.split('\n')
  const header = lines.findIndex((line) => /^\|\s*Aussage\s*\|\s*Urteil/.test(line))
  if (header < 0) return []
  const options: ItemOption[] = []
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const [text, verdict, reason] = tableCells(line)
    options.push({
      text,
      correct: /\*\*R\*\*/.test(verdict),
      reason: reason ?? '',
      flag: verdict.includes('⚠') ? 'unsure' : verdict.includes('❓') ? 'not-in-skript' : null,
    })
  }
  if (options.length === 0) return []
  return [
    {
      key: `auswahl:${match[1]}`,
      kind: 'card',
      source: 'auswahl',
      label: section.title,
      front: lines.slice(0, header).join(' ').trim(),
      back: options.map((option) => `- ${option.correct ? 'Richtig' : 'Falsch'}: ${option.text}. ${option.reason}`).join('\n'),
      times: 1,
      status: null,
      options,
    },
  ]
}

/** A trap shows its bold term or first sentence on the front, and the whole trap on the back. */
function trapCard(bullet: string): ParsedItem | null {
  const text = bullet.trim()
  const bold = /^\*\*(.+?)\*\*/.exec(text)
  const leadIn = /^([^:*]{3,60}):\s+\S/.exec(text)
  let front: string | null = null
  if (bold) {
    front = bold[1].replace(/[:.]\s*$/, '')
  } else if (leadIn) {
    front = leadIn[1]
  } else {
    const sentence = /^(.{12,}?[.!?])\s+\S/.exec(text)
    if (sentence) front = sentence[1]
  }
  if (!front) return null
  return {
    key: `falle:${hashText(front)}`,
    kind: 'card',
    source: 'falle',
    label: 'Häufige Falle',
    front,
    back: text,
    times: 1,
    status: null,
  }
}

/** Top-level bullets or numbered entries, with their continuation lines. */
function listEntries(body: string, marker: RegExp): { index: string; text: string }[] {
  const entries: { index: string; lines: string[] }[] = []
  for (const line of body.split('\n')) {
    const match = marker.exec(line)
    if (match) {
      entries.push({ index: match[1] ?? '', lines: [line.slice(match[0].length)] })
    } else if (entries.length > 0) {
      entries[entries.length - 1].lines.push(line)
    }
  }
  return entries.map(({ index, lines }) => ({ index, text: lines.join('\n').trim() }))
}

function removeSections(body: string, pattern: RegExp): string {
  const { intro, sections } = splitHeadings(body, 2)
  const kept = sections
    .filter((section) => !pattern.test(section.title))
    .map((section) => `## ${section.title}\n\n${section.body}`)
  return [intro, ...kept].filter(Boolean).join('\n\n')
}

interface SolutionIndex {
  byId: Map<string, string>
  byChapter: Map<number, string[]>
  /** Solutions in chapter order, for appendices that use short names instead of numbers. */
  inOrder: string[][]
}

/** Cuts `1) … 2) …` apart, only ever looking for the next number, so `(a)` or `x 2)` in a formula is safe. */
function splitNumberedAnswers(text: string): string[] {
  const answers: string[] = []
  let position = text.search(/(^|\s)1\)\s/)
  if (position < 0) return text.trim() ? [text.trim()] : []
  for (let number = 1; ; number += 1) {
    const here = text.indexOf(`${number})`, position)
    const next = new RegExp(`(^|\\s)${number + 1}\\)\\s`).exec(text.slice(here))
    if (!next) {
      answers.push(text.slice(here + `${number})`.length).trim())
      return answers
    }
    answers.push(text.slice(here + `${number})`.length, here + next.index).trim())
    position = here + next.index
  }
}

function parseSolutions(body: string): SolutionIndex {
  const index: SolutionIndex = { byId: new Map(), byChapter: new Map(), inOrder: [] }

  for (const { index: id, text } of listEntries(body, /^- \*\*(S[\d.]+\w*)\*\*\s*/)) {
    index.byId.set(id, text.split(/\n\n\*\*/)[0].trim())
  }
  if (index.byId.size > 0) return index

  const chapters = leadInBlocks(body, /^\*\*Kapitel (\d+)[^*]*\*\*\s*$/)
  if (chapters.length > 0) {
    for (const { head, rest } of chapters) {
      index.byChapter.set(Number(head[1]), listEntries(rest, /^(\d+)\.\s+/).map((entry) => entry.text))
    }
    return index
  }

  for (const { rest } of leadInBlocks(body, /^\*\*[^*]+?\.\*\*\s*/)) {
    index.inOrder.push(splitNumberedAnswers(rest))
  }
  return index
}

const NOT_A_CHAPTER = /^(Überblick|Anhang|TEIL\b|Vorwort|Inhalt)/i
// Captions can hold brackets of their own, as in "[S] = 10 Km".
const IMAGE = /!\[(?:[^[\]]|\[[^\]]*\])*\]\(([^)\s]+)[^)]*\)/g

export function parseLernskript(files: readonly SourceFile[]): ParsedCourse {
  const warnings: string[] = []
  let title: string | null = null
  const merged = files
    .map((file) => {
      const stripped = stripFrontMatter(file.text)
      title ??= stripped.title?.replace(/\s*[–-]\s*Lernskript\s*$/i, '') ?? null
      return cleanSource(stripped.body)
    })
    .join('\n\n')

  const top = splitHeadings(merged, 1).sections.filter(
    // Part dividers such as "TEIL A" hold no content of their own.
    (section) => !(/^TEIL\b/i.test(section.title) && section.body.length < 400),
  )

  let number = 0
  const numbered = top.map((section) => {
    const unnumbered = /\.unnumbered|\{-\}/.test(section.attributes) || NOT_A_CHAPTER.test(section.title)
    if (!unnumbered) number += 1
    return { section, number: unnumbered ? null : number }
  })

  const labels = new Map<string, number>()
  for (const { section, number: chapter } of numbered) {
    const label = /#(sec-[\w-]+)/.exec(section.attributes)?.[1]
    if (label && chapter !== null) labels.set(label, chapter)
  }
  const resolveReferences = (text: string) =>
    text
      .replace(/\[-@(sec-[\w-]+)\]/g, (_, label: string) => String(labels.get(label) ?? '?'))
      .replace(/\[?@(sec-[\w-]+)\]?/g, (_, label: string) => `Kapitel ${labels.get(label) ?? '?'}`)
      .replace(/\[?@fig-[\w-]+\]?/g, 'die Abbildung')
      .replace(/\[?@tbl-[\w-]+\]?/g, 'die Tabelle')

  const appendix = numbered.find(({ section }) => /^Anhang/i.test(section.title))
  const solutionSection = appendix
    ? splitHeadings(appendix.section.body, 2).sections.find((section) => /Lösungen zu den Selbsttests/i.test(section.title))
    : undefined
  const solutions = parseSolutions(resolveReferences(solutionSection?.body ?? ''))
  if (!solutionSection) warnings.push('No appendix with Selbsttest answers found.')

  const seen = new Set<string>()
  let chaptersWithTest = 0
  const images = new Set<string>()

  const chapters = numbered.map(({ section, number: chapter }) => {
    const body = resolveReferences(section.body)
    const items: ParsedItem[] = []
    for (const image of body.matchAll(IMAGE)) images.add(image[1])

    if (chapter !== null) {
      const parts = splitHeadings(body, 2).sections
      items.push(...headingAltfragen(body))
      items.push(...numberedAltfragen(body))
      for (const part of parts) {
        if (/^Altfragen/i.test(part.title)) items.push(...paragraphAltfragen(part.body))
        items.push(...multipleChoice(part))
        if (/^Häufige Fallen/i.test(part.title)) {
          for (const { text } of listEntries(part.body, /^- +/)) {
            const card = trapCard(text)
            if (card) items.push(card)
          }
        }
      }

      const test = parts.find((part) => /^Selbsttest/i.test(part.title))
      if (test) {
        const order = solutions.inOrder[chaptersWithTest]
        chaptersWithTest += 1
        listEntries(test.body, /^(\d+)\.\s+/).forEach(({ index, text }, i) => {
          const idMatch = /^\*\*\((S[\d.]+\w*)\)\*\*\s*/.exec(text)
          const id = idMatch?.[1] ?? `S${chapter}.${index}`
          const answer =
            solutions.byId.get(id) ?? solutions.byChapter.get(chapter)?.[i] ?? order?.[i] ?? ''
          if (!answer) warnings.push(`No stored answer for ${id} (${section.title}).`)
          items.push({
            key: `selbsttest:${id}`,
            kind: 'question',
            source: 'selbsttest',
            label: id,
            front: idMatch ? text.slice(idMatch[0].length) : text,
            back: answer,
            times: 1,
            status: null,
          })
        })
      }
    }

    const unique = items.filter((item) => {
      if (item.kind === 'card' && !item.back) {
        warnings.push(`Skipped ${item.label ?? item.front} (${section.title}): the Lernskript has no answer text for it.`)
        return false
      }
      if (seen.has(item.key)) return false
      seen.add(item.key)
      return true
    })
    return {
      title: section.title,
      number: chapter,
      body: removeSections(body, /^Selbsttest/i),
      items: unique,
    }
  })

  // Split Lernskripte can number the appendix before their last chapters; it always reads last.
  const inReadingOrder = [
    ...chapters.filter((chapter) => !/^Anhang/i.test(chapter.title)),
    ...chapters.filter((chapter) => /^Anhang/i.test(chapter.title)),
  ]
  return { title, chapters: inReadingOrder, images: [...images], warnings }
}

/** The order files are read in: numeric prefix first, so 100_kap12 follows 97_kap11. */
export function sortSourceNames(names: readonly string[]): string[] {
  const prefix = (name: string) => Number(/^(\d+)/.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER)
  return [...names].sort((a, b) => prefix(a) - prefix(b) || a.localeCompare(b))
}
