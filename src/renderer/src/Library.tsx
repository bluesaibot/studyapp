import { useState } from 'react'
import type { CourseRow, ImportReport } from '../../shared/study'
import type { StudyTab } from './Workspace'

type ImportResult = ImportReport | { error: string } | null

function ReportView({ result }: { result: ImportReport | { error: string } }) {
  if ('error' in result) {
    return (
      <div className="import-report" role="alert">
        <strong>Nothing was imported.</strong> {result.error} Choose the folder that holds the Lernskript's .qmd files.
      </div>
    )
  }
  return (
    <div className="import-report" role="status">
      <strong>{result.name}</strong>: {result.chapters} chapters, {result.added} new items, {result.updated} kept with their progress.
      {result.imagesCopied > 0 && ` ${result.imagesCopied} figures copied.`}
      {(result.imagesMissing > 0 || result.warnings.length > 0 || result.retired > 0) && (
        <ul>
          {result.retired > 0 && <li>{result.retired} items are no longer in the Lernskript and are now hidden. Their progress stays saved.</li>}
          {result.imagesMissing > 0 && <li>{result.imagesMissing} figures were not found. Their captions are still shown.</li>}
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface LibraryProps {
  courses: CourseRow[]
  refresh: () => void
  open: (courseId: number, tab: StudyTab) => void
  close: () => void
}

export function Library({ courses, refresh, open, close }: LibraryProps) {
  const [result, setResult] = useState<ImportResult>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<ImportResult>) => {
    setBusy(true)
    const outcome = await action()
    setBusy(false)
    if (outcome) setResult(outcome)
    refresh()
  }

  return (
    <main className="library">
      <header className="break-head">
        <h1>Library</h1>
        <div className="row">
          <button className="button sunny" disabled={busy} onClick={() => void run(() => window.api.importCourse())}>
            {busy ? 'Importing…' : 'Import a Lernskript'}
          </button>
          <button className="button quiet" onClick={close}>
            Back
          </button>
        </div>
      </header>
      {result && <ReportView result={result} />}
      {courses.length === 0 && !result && (
        <p className="empty">Pick a course folder, and its Lernskript becomes cards, open questions and something to read. This works offline, and your original files stay untouched.</p>
      )}
      <section>
        {courses.map((course) => (
          <article className="course" key={course.id}>
            <input
              key={course.name}
              className="course-name"
              aria-label="Course name"
              defaultValue={course.name}
              onBlur={(event) => {
                if (event.target.value !== course.name) void window.api.renameCourse(course.id, event.target.value).then(refresh)
              }}
            />
            <p>
              {course.cards} cards, {course.questions} open questions, {course.chapters} chapters
              {course.reviewed > 0 && `. ${course.reviewed} practised so far`}
            </p>
            <div className="row">
              <button className="button" onClick={() => open(course.id, 'cards')}>
                Cards ({course.cardsReady} ready)
              </button>
              <button className="button" onClick={() => open(course.id, 'all')}>
                All cards ({course.cards})
              </button>
              <button className="button" onClick={() => open(course.id, 'questions')}>
                Open questions ({course.questionsReady} ready)
              </button>
              <button className="button" onClick={() => open(course.id, 'allQuestions')}>
                All open questions ({course.questions})
              </button>
              {course.mistakes > 0 && (
                <button className="button" onClick={() => open(course.id, 'mistakes')}>
                  Fehlerliste ({course.mistakes})
                </button>
              )}
              <button className="button quiet" onClick={() => open(course.id, 'read')}>
                Read
              </button>
              <button className="button quiet" disabled={busy} onClick={() => void run(() => window.api.reimportCourse(course.id))}>
                Update from Lernskript
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
