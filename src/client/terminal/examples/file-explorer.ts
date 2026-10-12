import { closeSync, lstatSync, openSync, readSync, readdirSync, readlinkSync, statSync, type Dirent, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { HStack, List, NavigationStack, OutlineGroup, ScrollView, Spacer, State, Terminal, Text, TextField, VStack, type RowId } from '../index'

type FileKind = 'folder' | 'file' | 'symlink' | 'other' | 'empty' | 'error' | 'placeholder' | 'more'

type FileNode = {
  id: string
  path: string
  name: string
  kind: FileKind
  size?: string
  modified?: string
  preview?: string
}

const maxDirectoryEntries = 200
const maxPreviewBytes = 4096
const maxPreviewLines = 18

const terminal = new Terminal()

const homePath = process.env.HOME || homedir()
const selectedId = State<string | undefined>(homePath)
const expanded = State<string[]>([homePath])
const path = State<string[]>([])
const scrollOffset = State(0)
const detailSelection = State<RowId | undefined>(undefined)
const detailScrollOffset = State(0)
const openPrompt = State(false)
const openInput = State('')
const openStatus = State('')

const openInputFocusId = 'file-explorer-open-path'

const nodeCache = new Map<string, FileNode>()
const directoryCache = new Map<string, FileNode[]>()
const previewCache = new Map<string, string>()

const rootNode = inspectPath(homePath, '~')
const tree: FileNode[] = [rootNode]

function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, '?')
}

function remember(node: FileNode): FileNode {
  nodeCache.set(node.id, node)
  return node
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function kindFromStats(stats: Stats): FileKind {
  if (stats.isDirectory()) return 'folder'
  if (stats.isFile()) return 'file'
  if (stats.isSymbolicLink()) return 'symlink'
  return 'other'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function inspectPath(filePath: string, name = basename(filePath) || filePath): FileNode {
  const cached = nodeCache.get(filePath)
  if (cached) return cached

  try {
    const stats = lstatSync(filePath)
    return remember({
      id: filePath,
      path: filePath,
      name: clean(name),
      kind: kindFromStats(stats),
      size: stats.isDirectory() ? undefined : formatSize(stats.size),
      modified: formatDate(stats.mtime),
    })
  } catch (error) {
    return remember({
      id: filePath,
      path: filePath,
      name: clean(name),
      kind: 'error',
      preview: errorMessage(error),
    })
  }
}

function nodeFromDirent(parentPath: string, dirent: Dirent): FileNode {
  const filePath = join(parentPath, dirent.name)
  if (!dirent.isSymbolicLink()) return inspectPath(filePath, dirent.name)

  return remember({
    id: filePath,
    path: filePath,
    name: clean(dirent.name),
    kind: 'symlink',
    preview: symlinkPreview(filePath),
  })
}

function marker(parent: FileNode, kind: FileKind, name: string, preview?: string): FileNode {
  return remember({
    id: `${parent.path}::${kind}`,
    path: parent.path,
    name,
    kind,
    preview,
  })
}

function directoryChildren(dirPath: string): FileNode[] {
  const cached = directoryCache.get(dirPath)
  if (cached) return cached

  const parent = inspectPath(dirPath)
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
      .sort((a, b) => {
        const aFolder = a.isDirectory() ? 0 : 1
        const bFolder = b.isDirectory() ? 0 : 1
        if (aFolder !== bFolder) return aFolder - bFolder
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })

    const children = entries.slice(0, maxDirectoryEntries).map(entry => nodeFromDirent(dirPath, entry))
    if (entries.length > maxDirectoryEntries) {
      children.push(marker(parent, 'more', `... ${entries.length - maxDirectoryEntries} more`, `Showing first ${maxDirectoryEntries} entries.`))
    }
    if (children.length === 0) children.push(marker(parent, 'empty', '(empty)', 'Directory has no entries.'))

    directoryCache.set(dirPath, children)
    return children
  } catch (error) {
    const children = [marker(parent, 'error', '(unreadable)', errorMessage(error))]
    directoryCache.set(dirPath, children)
    return children
  }
}

function childrenFor(node: FileNode): FileNode[] | undefined {
  if (node.kind !== 'folder') return undefined
  if (!expanded.get().includes(node.id)) return [marker(node, 'placeholder', '(not loaded)')]
  return directoryChildren(node.path)
}

function nodeById(id: string | undefined): FileNode {
  if (!id) return rootNode
  return nodeCache.get(id) ?? inspectPath(id)
}

function selectedNode() {
  return nodeById(selectedId.get())
}

function selectedDirectoryPath(): string {
  const current = selectedNode()
  return current.kind === 'folder' ? current.path : dirname(current.path)
}

function visibleTreeRows(nodes = tree): FileNode[] {
  const rows: FileNode[] = []
  const visit = (items: FileNode[]) => {
    for (const item of items) {
      rows.push(item)
      if (item.kind === 'folder' && expanded.get().includes(item.id)) visit(directoryChildren(item.path))
    }
  }
  visit(nodes)
  return rows
}

function visibleRowCount(reservedRows: number): number {
  return Math.max(1, (process.stdout.rows || 24) - reservedRows)
}

function keepVisible(offset: { get(): number; set(value: number): void }, index: number, visibleRows: number): void {
  const current = offset.get()
  if (index < current) offset.set(index)
  else if (index >= current + visibleRows) offset.set(index - visibleRows + 1)
}

function openPathPrompt(): void {
  openPrompt.set(true)
  openInput.set('')
  openStatus.set('')
  terminal.focus(openInputFocusId)
}

function closePathPrompt(): void {
  openPrompt.set(false)
  openStatus.set('')
}

function submitOpenPath(): void {
  const result = resolveDirectoryInput(openInput.get())
  if (!result.ok) {
    openStatus.set(result.error)
    terminal.focus(openInputFocusId)
    return
  }

  const node = inspectPath(result.path)
  selectedId.set(node.id)
  detailSelection.set(undefined)
  detailScrollOffset.set(0)
  expandVisibleAncestors(result.path)
  directoryChildren(result.path)
  path.set([node.id])
  closePathPrompt()
}

function resolveDirectoryInput(value: string): { ok: true; path: string } | { ok: false; error: string } {
  const raw = value.trim()
  if (!raw) return { ok: false, error: 'empty path' }

  const expanded = raw === '~' ? homePath : raw.startsWith('~/') ? join(homePath, raw.slice(2)) : raw
  const absolute = isAbsolute(expanded) ? expanded : resolve(selectedDirectoryPath(), expanded)
  const candidates = expandGlobPath(absolute)

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return { ok: true, path: candidate }
    } catch {}
  }

  return { ok: false, error: 'directory not found' }
}

function expandGlobPath(pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern]

  let current = isAbsolute(pattern) ? [sep] : [process.cwd()]
  for (const segment of pattern.split(sep).filter(Boolean)) {
    const next: string[] = []
    for (const base of current) {
      if (segment.includes('*')) {
        try {
          const matcher = new RegExp(`^${segment.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*')}$`)
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (matcher.test(entry.name)) next.push(join(base, entry.name))
          }
        } catch {}
      } else {
        next.push(join(base, segment))
      }
    }
    current = next.slice(0, maxDirectoryEntries)
    if (current.length === 0) break
  }
  return current.sort((a, b) => a.localeCompare(b))
}

function expandVisibleAncestors(filePath: string): void {
  if (filePath !== homePath && !filePath.startsWith(`${homePath}${sep}`)) return

  const next = new Set(expanded.get())
  let current = filePath
  while (current.startsWith(homePath)) {
    next.add(current)
    if (current === homePath) break
    current = dirname(current)
  }
  expanded.set([...next])
}

function visiblePath(filePath: string): string {
  if (filePath === homePath) return '~'
  if (filePath.startsWith(`${homePath}${sep}`)) return `~/${filePath.slice(homePath.length + 1)}`
  return filePath
}

function iconFor(node: FileNode, open = false): string {
  if (node.kind === 'folder') return open ? '[-]' : '[+]'
  if (node.kind === 'file') return ' - '
  if (node.kind === 'symlink') return ' @ '
  if (node.kind === 'error') return ' ! '
  if (node.kind === 'more') return '...'
  return '   '
}

function colorFor(node: FileNode) {
  if (node.kind === 'folder') return 'yellow'
  if (node.kind === 'error') return 'red'
  if (node.kind === 'symlink') return 'magenta'
  if (node.kind === 'empty' || node.kind === 'placeholder' || node.kind === 'more') return 'secondary'
  return 'primary'
}

function metaFor(node: FileNode): string {
  if (node.kind === 'folder') return `${realChildCount(node)} items`
  if (node.kind === 'symlink') return 'symlink'
  if (node.kind === 'empty' || node.kind === 'placeholder' || node.kind === 'more') return ''
  return [node.size, node.modified].filter(Boolean).join('  ')
}

function realChildCount(node: FileNode): number {
  if (node.kind !== 'folder') return 0
  return directoryChildren(node.path).filter(child => child.kind !== 'empty' && child.kind !== 'error' && child.kind !== 'more').length
}

function symlinkPreview(filePath: string): string {
  try {
    return `Points to ${readlinkSync(filePath)}`
  } catch (error) {
    return errorMessage(error)
  }
}

function filePreview(filePath: string): string {
  const cached = previewCache.get(filePath)
  if (cached) return cached

  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(maxPreviewBytes)
    const bytes = readSync(fd, buffer, 0, maxPreviewBytes, 0)
    if (bytes === 0) return cachePreview(filePath, 'Empty file.')

    const chunk = buffer.subarray(0, bytes)
    if (chunk.includes(0)) return cachePreview(filePath, 'Binary file. Preview skipped.')

    const text = clean(chunk.toString('utf8').replace(/\r/g, ''))
      .split('\n')
      .slice(0, maxPreviewLines)
      .join('\n')
    return cachePreview(filePath, text || 'No printable text.')
  } catch (error) {
    return cachePreview(filePath, errorMessage(error))
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function cachePreview(filePath: string, value: string): string {
  previewCache.set(filePath, value)
  return value
}

function previewFor(node: FileNode): string {
  if (node.preview) return node.preview
  if (node.kind === 'folder') {
    const children = directoryChildren(node.path)
    const names = children.slice(0, 8).map(child => child.name).join(', ')
    return names ? names : 'Directory has no entries.'
  }
  if (node.kind === 'file') return filePreview(node.path)
  if (node.kind === 'symlink') return symlinkPreview(node.path)
  if (node.kind === 'other') return 'Special file.'
  return ''
}

function canOpenDetail(node: FileNode): boolean {
  return node.kind === 'folder' || node.kind === 'file' || node.kind === 'symlink' || node.kind === 'other' || node.kind === 'error'
}

function Row(node: FileNode, _depth = 0, open = false) {
  const selected = node.id === selectedId.get()
  return Text(`${selected ? '*' : ' '} ${iconFor(node, open)} ${node.name}`)
    .frame({ maxWidth: -1, alignment: 'leading' })
    .foregroundColor(selected ? 'cyan' : colorFor(node))
    .id(node.id)
}

function Master() {
  const current = selectedNode()
  const rows = visibleTreeRows()
  keepVisible(scrollOffset, Math.max(0, rows.findIndex(row => row.id === current.id)), visibleRowCount(4))
  return HStack(
    [
      VStack(
        [
          HStack([Text('Home').fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Text(visiblePath(homePath)).foregroundColor('secondary')]),
          ScrollView(
            OutlineGroup(tree, (node, depth, open) => Row(node, depth, open), {
              id: 'id',
              children: childrenFor,
              expanded,
              selection: selectedId,
              onActivate: node => {
                if (canOpenDetail(node)) path.set([node.id])
              },
            }),
            { axis: 'vertical', offset: scrollOffset },
          ).frame({ maxWidth: -1, maxHeight: -1 }),
        ],
        { spacing: 1 },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
      VStack(
        [
          HStack([Text(current.kind === 'folder' ? 'Folder' : 'File').foregroundColor('secondary'), Spacer({ minLength: 1 }), Text(metaFor(current))]),
          Text(current.name).fontWeight('bold'),
          Text(visiblePath(current.path), { truncation: 'middle' }).foregroundColor('secondary'),
          Text(previewFor(current), { wrap: true, lineLimit: 9 }),
        ],
        { spacing: 1 },
      ).frame({ width: 40, maxHeight: -1 }).padding(1),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 })
}

function Detail(id: string) {
  const node = nodeById(id)
  const children = node.kind === 'folder' ? directoryChildren(node.path) : []
  if (node.kind === 'folder' && children.length > 0 && !children.some(child => child.id === detailSelection.get())) {
    detailSelection.set(children[0]!.id)
    detailScrollOffset.set(0)
  }
  const detailIndex = children.findIndex(child => child.id === detailSelection.get())
  if (detailIndex >= 0) keepVisible(detailScrollOffset, detailIndex, visibleRowCount(5))
  return VStack(
    [
      HStack([Text(node.name).fontWeight('bold').foregroundColor(colorFor(node)), Spacer({ minLength: 1 }), Text(metaFor(node)).foregroundColor('secondary')]),
      Text(visiblePath(node.path), { truncation: 'middle' }).foregroundColor('secondary'),
      node.kind === 'folder'
        ? ScrollView(
            List(
              children,
              'id',
              child => Text(`${iconFor(child)} ${child.name}${metaFor(child) ? `  ${metaFor(child)}` : ''}`).frame({ maxWidth: -1, alignment: 'leading' }),
              {
                selection: detailSelection,
                onActivate: child => {
                  selectedId.set(child.id)
                  if (canOpenDetail(child)) path.set([child.id])
                },
                empty: Text('(empty)').foregroundColor('secondary'),
              },
            ),
            { axis: 'vertical', offset: detailScrollOffset },
          ).frame({ maxWidth: -1, maxHeight: -1 })
        : ScrollView(Text(previewFor(node), { wrap: true }), { axis: 'vertical' }).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  ).padding(1).frame({ maxWidth: -1, maxHeight: -1 })
}

function OpenPathInput() {
  return HStack(
    [
      Text('Open').foregroundColor('cyan'),
      TextField(openInput, { placeholder: '~/folder', onSubmit: submitOpenPath })
        .frame({ maxWidth: -1 })
        .focusId(openInputFocusId),
      Text(openStatus.get()).foregroundColor('red'),
    ],
    { spacing: 1 },
  )
    .frame({ maxWidth: -1 })
    .keyBinding('escape', 'Close', closePathPrompt)
}

terminal.display(() => {
  const children = [
    NavigationStack(
      path,
      Master,
      Detail,
    ).frame({ maxWidth: -1, maxHeight: -1 }),
  ]

  if (openPrompt.get()) children.push(OpenPathInput())

  return VStack(children, { spacing: 1 })
    .frame({ maxWidth: -1, maxHeight: -1 })
    .keyBinding('ctrl+o', 'Open path', openPathPrompt)
})
