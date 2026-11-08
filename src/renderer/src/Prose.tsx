import { memo, useMemo, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { mediaUrl } from '../../shared/media'

interface TreeNode {
  type: string
  value?: string
  children?: TreeNode[]
  data?: { hName: string }
}

const SUB_SUP = /~([^\s~]+)~|\^([^\s^]+)\^/g

/** Pandoc writes H~2~O and Ca^2+^, which plain Markdown does not know. */
function remarkSubSup() {
  const split = (value: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    let last = 0
    for (const match of value.matchAll(SUB_SUP)) {
      if (match.index > last) nodes.push({ type: 'text', value: value.slice(last, match.index) })
      const isSub = match[1] !== undefined
      nodes.push({
        type: isSub ? 'subscript' : 'superscript',
        data: { hName: isSub ? 'sub' : 'sup' },
        children: [{ type: 'text', value: match[1] ?? match[2] }],
      })
      last = match.index + match[0].length
    }
    if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) })
    return nodes
  }
  const walk = (node: TreeNode) => {
    if (!node.children) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text' && child.value) return split(child.value)
      walk(child)
      return [child]
    })
  }
  return walk
}

type Part = { type: 'text'; text: string } | { type: 'box'; kind: string | null; title: string | null; text: string }

/** Pandoc `:::` blocks: callouts get a box, anything else is shown as plain content. */
function splitBoxes(markdown: string): Part[] {
  const parts: Part[] = []
  let text: string[] = []
  let inner: string[] = []
  let opening = ''
  let depth = 0
  const flush = () => {
    if (text.length > 0) parts.push({ type: 'text', text: text.join('\n') })
    text = []
  }
  for (const line of markdown.split('\n')) {
    const closes = /^:::+\s*$/.test(line)
    const opens = !closes && /^:::+\s*\S/.test(line)
    if (depth === 0 && opens) {
      flush()
      opening = line
      inner = []
      depth = 1
    } else if (depth === 0) {
      text.push(line)
    } else {
      if (opens) depth += 1
      if (closes) depth -= 1
      if (depth === 0) {
        parts.push({
          type: 'box',
          kind: /\.callout-(\w+)/.exec(opening)?.[1] ?? null,
          title: /title="([^"]*)"/.exec(opening)?.[1] ?? null,
          text: inner.join('\n'),
        })
      } else {
        inner.push(line)
      }
    }
  }
  if (depth > 0) text.push(opening, ...inner)
  flush()
  return parts
}

/** Captions arrive as plain text, so their markup is handled here. */
function Caption({ text }: { text: string }) {
  const plain = text.replace(/\*+/g, '')
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of plain.matchAll(SUB_SUP)) {
    nodes.push(plain.slice(last, match.index))
    nodes.push(match[1] !== undefined ? <sub key={match.index}>{match[1]}</sub> : <sup key={match.index}>{match[2]}</sup>)
    last = match.index + match[0].length
  }
  nodes.push(plain.slice(last))
  return <span className="figure-caption">{nodes}</span>
}

function Figure({ courseId, src, alt }: { courseId: number; src?: string; alt?: string }) {
  const url = src ? mediaUrl(courseId, src) : null
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  return (
    <span className="figure">
      {url && url !== brokenUrl && (
        <img src={url} alt={alt?.replace(/[*~^]/g, '') ?? ''} loading="lazy" onError={() => setBrokenUrl(url)} />
      )}
      {alt && <Caption text={alt} />}
    </span>
  )
}

function Parts({ markdown, components }: { markdown: string; components: Components }) {
  return splitBoxes(markdown).map((part, index) =>
    part.type === 'text' ? (
      <Markdown
        key={index}
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, remarkSubSup]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {part.text}
      </Markdown>
    ) : part.kind ? (
      <aside key={index} className={`callout callout-${part.kind}`}>
        {part.title && <p className="callout-title">{part.title}</p>}
        <Parts markdown={part.text} components={components} />
      </aside>
    ) : (
      <Parts key={index} markdown={part.text} components={components} />
    ),
  )
}

/** Shows Lernskript text: tables, formulas, callouts, figures. */
export const Prose = memo(function Prose({ markdown, courseId }: { markdown: string; courseId: number }) {
  const components = useMemo<Components>(
    () => ({ img: ({ src, alt }) => <Figure courseId={courseId} src={typeof src === 'string' ? src : undefined} alt={alt} /> }),
    [courseId],
  )
  return (
    <div className="prose" lang="de">
      <Parts markdown={markdown} components={components} />
    </div>
  )
})
