import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLernskript, sortSourceNames, type ParsedCourse } from './qmd'

const uni = join(homedir(), 'Desktop/uni')
const singleFile = (path: string) => [{ name: path, text: readFileSync(join(uni, path), 'utf8') }]
const CELL = 'VOs/VO_molecular_cellbiology/Lernskript/Molekulare_Zellbiologie_Lernskript.qmd'
const ECOLOGY = 'VOs/VO_introduction_ecology/Lernskript/Einf_Oekologie_Lernskript.qmd'
const BIOCHEM = 'biochemische_-bungen_seminar/Lernskript/quarto_lernskript'

function allItems(course: ParsedCourse) {
  return course.chapters.flatMap((chapter) => chapter.items)
}

describe('parseLernskript with small samples', () => {
  const sample = `---
title: "Testkurs"
---

# Überblick {.unnumbered}

Text.

# Erstes Kapitel {#sec-eins}

## Kernaussagen

Siehe Kap. [-@sec-eins] und ![Bild](fig/a.png){width=50%}

## Häufige Fallen

- **TEM ≠ REM:** TEM durchstrahlt.
- Flora ≠ Vegetation. Wer das verwechselt, verliert Punkte.

## Selbsttest

1. **(S1.1)** Warum?

## Altfragen zu diesem Kapitel

#### A39 · Genzahlen *(2×)* — ❌

**Katalog‑Antwort:** Mensch 30 000.

::: {.callout-important title="Korrektur – A39"}
**Richtig:** Mensch 20 000.
:::

# Anhang {.unnumbered}

## Anhang B: Lösungen zu den Selbsttests {.unnumbered}

**Kapitel 1**

- **S1.1** Darum.
`

  const course = parseLernskript([{ name: 'a.qmd', text: sample }])
  const chapter = course.chapters.find((c) => c.number === 1)!

  it('reads the title and numbers only real chapters', () => {
    expect(course.title).toBe('Testkurs')
    expect(course.chapters.map((c) => c.number)).toEqual([null, 1, null])
  })

  it('resolves references and strips image attributes', () => {
    expect(chapter.body).toContain('Siehe Kap. 1')
    expect(chapter.body).toContain('![Bild](fig/a.png)')
    expect(chapter.body).not.toContain('{width')
    expect(course.images).toEqual(['fig/a.png'])
  })

  it('keeps Selbsttest out of the reader but matches its answer', () => {
    expect(chapter.body).not.toContain('Selbsttest')
    const question = chapter.items.find((item) => item.key === 'selbsttest:S1.1')!
    expect(question.front).toBe('Warum?')
    expect(question.back).toBe('Darum.')
  })

  it('shows a correction before the wrong catalogue answer', () => {
    const card = chapter.items.find((item) => item.label === 'A39')!
    expect(card.status).toBe('wrong')
    expect(card.times).toBe(2)
    expect(card.front).not.toContain('30 000')
    expect(card.back.indexOf('20 000')).toBeLessThan(card.back.indexOf('30 000'))
  })

  it('builds trap cards with and without a bold term', () => {
    const fronts = chapter.items.filter((item) => item.source === 'falle').map((item) => item.front)
    expect(fronts).toEqual(['TEM ≠ REM', 'Flora ≠ Vegetation.'])
    const colon = parseLernskript([{ name: 'b.qmd', text: '# K\n\n## Häufige Fallen\n\n- Gegenionen: **Anion fällt Kation**.\n' }])
    expect(allItems(colon)[0].front).toBe('Gegenionen')
  })

  it('keeps keys stable when the same source is parsed again', () => {
    const again = parseLernskript([{ name: 'a.qmd', text: sample }])
    expect(allItems(again).map((i) => i.key)).toEqual(allItems(course).map((i) => i.key))
  })

  it('handles formulas, inner heading attributes and brackets in captions', () => {
    const course = parseLernskript([
      {
        name: 'c.qmd',
        text: '# K\n\n$$\\begin{aligned}\na &= b\n\\end{aligned}$$\n\n$$x = 1$$ {#eq-x}\n\n## Teil {.unnumbered}\n\n![bei [S] = 10](fig/s.png){width=50%}\n',
      },
    ])
    const { body } = course.chapters[0]
    expect(body).toContain('$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$')
    expect(body).toContain('$$\nx = 1\n$$')
    expect(body).toContain('## Teil\n')
    expect(course.images).toEqual(['fig/s.png'])
  })

  it('reads numbered source files in numeric order', () => {
    expect(sortSourceNames(['100_k.qmd', '20_k.qmd', '99_a.qmd', '00_h.qmd'])).toEqual([
      '00_h.qmd',
      '20_k.qmd',
      '99_a.qmd',
      '100_k.qmd',
    ])
  })
})

// These read the real Lernskripte, and are skipped on a machine without them.
describe.skipIf(!existsSync(uni))('parseLernskript with real Lernskripte', () => {
  it('Zellbiologie: single file, A39 with correction, S2.1 answered', () => {
    const course = parseLernskript(singleFile(CELL))
    const items = allItems(course)
    expect(course.chapters.filter((c) => c.number !== null)).toHaveLength(9)

    const a39 = items.find((item) => item.label === 'A39')!
    expect(a39.status).toBe('wrong')
    expect(a39.back.indexOf('Richtig (Skript)')).toBeLessThan(a39.back.indexOf('Katalog‑Antwort'))

    expect(items.find((item) => item.label === 'S2.1')!.back).toContain('RNA‑Seq')
    expect(items.filter((item) => item.source === 'altfrage').length).toBeGreaterThanOrEqual(50)
    expect(course.warnings).toEqual([])
  })

  it('Ökologie: paragraph Altfragen and answers in chapter order', () => {
    const course = parseLernskript(singleFile(ECOLOGY))
    const items = allItems(course)
    expect(course.chapters.filter((c) => c.number !== null)).toHaveLength(20)

    expect(items.filter((item) => item.source === 'altfrage').length).toBeGreaterThan(70)
    const three = items.find((item) => item.label === 'K-1 / A19-1')!
    expect(three.times).toBe(2)
    expect(three.front).toBe('Drei Stufen (traditionelle Unterteilung) der Ökologie')
    expect(three.back).toContain('Autökologie')

    const firstQuestion = items.find((item) => item.kind === 'question')!
    expect(firstQuestion.front).toContain('Indonesien')
    expect(firstQuestion.back).toContain('Amplitude')
    expect(course.warnings).toEqual([])
    expect(JSON.stringify(course.chapters)).not.toContain('\\STok')
  })

  it('Biochemie: split files, numbered answers, Wäg statements, exam questions', () => {
    const folder = join(uni, BIOCHEM)
    const names = sortSourceNames(readdirSync(folder).filter((name) => name.endsWith('.qmd')))
    const course = parseLernskript(names.map((name) => ({ name, text: readFileSync(join(folder, name), 'utf8') })))
    const items = allItems(course)
    expect(course.chapters.filter((c) => c.number !== null)).toHaveLength(14)

    const choices = items.filter((item) => item.source === 'auswahl')
    expect(choices).toHaveLength(28)
    expect(choices.every((item) => item.options?.length === 4)).toBe(true)
    const first = choices[0]
    expect(first.label).toBe('Frage 1: Fällung/Löslichkeit')
    expect(first.front).toContain('Globuline')
    expect(first.options![0]).toMatchObject({ text: '50 mM Tris/HCl pH 8,5', correct: true, flag: 'not-in-skript' })
    expect(first.options![1]).toMatchObject({ correct: false, flag: null })
    expect(first.options![2].flag).toBe('unsure')
    expect(first.options![1].reason).toContain('Halbsättigung')

    // Frage 33 has no answer text in the Lernskript, so it is reported rather than shown blank.
    expect(items.filter((item) => item.key.startsWith('altfrage:Frage'))).toHaveLength(34)
    expect(items.find((item) => item.key === 'altfrage:Frage21')!.back).toContain('Wie Frage 16.\n\n')
    expect(course.chapters[course.chapters.length - 1].title).toBe('Anhang')
    expect(items.find((item) => item.key === 'selbsttest:S2.1')!.back).toContain('Anionenaustauscher')
    expect(items.find((item) => item.key === 'selbsttest:S12.2')!.back).toContain('Unterphase')
    expect(course.warnings).toHaveLength(1)
    expect(course.warnings[0]).toContain('Frage 33')
  })
})
