import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { basename, dirname, join, normalize, resolve, sep } from 'node:path'
import { parseLernskript, sortSourceNames, type SourceFile } from '../core/qmd'
import type { ImportReport } from '../shared/study'
import type { Study } from './study'

const SKIPPED_FOLDERS = new Set(['_alt', '_book', '.quarto', 'node_modules', 'quarto_kurz', 'quarto_rechnen'])
const MAX_DEPTH = 4

function qmdFolders(folder: string, depth = 0): string[] {
  if (depth > MAX_DEPTH) return []
  let entries: Dirent[]
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    // A protected subfolder should not stop the search in the others.
    return []
  }
  const nested = entries
    .filter((entry) => entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith('.'))
    .flatMap((entry) => qmdFolders(join(folder, entry.name), depth + 1))
  return entries.some((entry) => entry.isFile() && entry.name.endsWith('.qmd')) ? [folder, ...nested] : nested
}

function readFolder(folder: string): SourceFile[] {
  return sortSourceNames(readdirSync(folder).filter((name) => name.endsWith('.qmd'))).map((name) => ({
    name,
    text: readFileSync(join(folder, name), 'utf8'),
  }))
}

const selftests = (files: SourceFile[]) => files.reduce((total, file) => total + (file.text.match(/^## Selbsttest/gm)?.length ?? 0), 0)

/** Finds the Lernskript inside whatever folder was picked: the folder with the most Selbsttest sections. */
export function findSources(path: string): { folder: string; files: SourceFile[] } {
  if (statSync(path).isFile()) {
    return { folder: dirname(path), files: [{ name: basename(path), text: readFileSync(path, 'utf8') }] }
  }
  let best: { folder: string; files: SourceFile[]; score: number } | null = null
  for (const folder of qmdFolders(path)) {
    const files = readFolder(folder)
    const score = selftests(files)
    if (score > 0 && (!best || score > best.score)) best = { folder, files, score }
  }
  if (!best) throw new Error('No Lernskript found here: no .qmd file with a "## Selbsttest" section.')
  return best
}

/** Stays inside the course's media folder whatever a relative path in a Lernskript says. */
function insideFolder(folder: string, relative: string): string | null {
  const target = resolve(folder, normalize(relative))
  return target.startsWith(resolve(folder) + sep) ? target : null
}

/** Copies figures to the app's data folder. Your original files are only ever read. */
function copyImages(images: string[], sourceFolder: string, mediaFolder: string): { copied: number; missing: number } {
  const searchIn = [sourceFolder, dirname(sourceFolder)]
  let copied = 0
  const unresolved: string[] = []
  for (const image of images) {
    const target = insideFolder(mediaFolder, image)
    const source = target && searchIn.map((folder) => join(folder, image)).find((path) => existsSync(path))
    if (target && source) {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      copied += 1
    } else {
      unresolved.push(image)
    }
  }

  // Some Lernskripte keep their figures in a zip next to the source.
  const archives = searchIn.flatMap((folder) =>
    readdirSync(folder)
      .filter((name) => name.endsWith('.zip') && /fig|abbild/i.test(name))
      .map((name) => join(folder, name)),
  )
  if (unresolved.length > 0 && archives.length > 0) {
    mkdirSync(mediaFolder, { recursive: true })
    for (const archive of archives) {
      try {
        execFileSync('/usr/bin/unzip', ['-o', '-q', archive, ...unresolved, '-d', mediaFolder], { stdio: 'ignore' })
      } catch {
        // unzip also exits non-zero when only some names were found, so the check below decides.
      }
    }
  }
  const found = unresolved.filter((image) => {
    const target = insideFolder(mediaFolder, image)
    return target !== null && existsSync(target)
  }).length
  return { copied: copied + found, missing: unresolved.length - found }
}

export function importLernskript(path: string, study: Study, mediaRoot: string): ImportReport {
  const { folder, files } = findSources(path)
  const parsed = parseLernskript(files)
  // Named after the course folder, not a generic "Lernskript" or "quarto_lernskript".
  const courseFolder = folder.split(sep).reverse().find((part) => !/lernskript/i.test(part)) ?? basename(folder)
  const fallbackName = courseFolder.replace(/[_-]+/g, ' ').trim()
  const report = study.saveCourse(parsed, folder, fallbackName)
  const { copied, missing } = copyImages(parsed.images, folder, join(mediaRoot, String(report.courseId)))
  return { ...report, imagesCopied: copied, imagesMissing: missing }
}
