import { Button, ForEach, HStack, ProgressBar, ScrollView, Spacer, State, TabBar, TaskHost, Terminal, Text, VStack } from '../index'

type Tab = 'Scripts' | 'Deps' | 'Status'
type Dependency = { id: string; name: string; version: string; installed: boolean }

const terminal = new Terminal()

const tab = State<Tab>('Scripts')
const installProgress = State(0)
const installing = State(false)
const lastAction = State('Idle')

const scripts = [
  { id: 'dev', name: 'dev', command: 'bun run index.ts' },
  { id: 'test', name: 'test', command: 'bun test' },
  { id: 'check', name: 'check', command: 'bunx tsc --noEmit' },
]

let dependencies: Dependency[] = [
  { id: 'bun-types', name: '@types/bun', version: 'latest', installed: true },
  { id: 'typescript', name: 'typescript', version: '^5', installed: true },
  { id: 'ansi', name: 'ansi-diff-stream', version: '^1', installed: false },
]

function startInstall(dep?: Dependency) {
  installing.set(true)
  installProgress.set(0)
  lastAction.set(dep ? `Installing ${dep.name}` : 'Installing dependencies')
}

function ScriptsPage() {
  return VStack([
    ForEach(
      scripts,
      script => script.id,
      script => HStack([Button(script.name, () => { lastAction.set(`Would run ${script.command}`) }, { disabled: installing }), Text(script.command).foregroundColor('secondary').frame({ maxWidth: -1 })], { spacing: 1 }).id(script.id),
    ),
  ])
}

function DepsPage() {
  return VStack([
    ForEach(
      dependencies,
      dep => dep.id,
      dep =>
        HStack(
          [
            Text(dep.name).frame({ maxWidth: -1 }),
            Text(dep.version).foregroundColor('secondary').frame({ width: 8 }),
            Text(dep.installed ? 'installed' : 'missing').foregroundColor(dep.installed ? 'green' : 'yellow').frame({ width: 10 }),
            Button('Install', () => startInstall(dep), { disabled: dep.installed, loading: installing }),
          ],
          { spacing: 1 },
        ).id(dep.id),
    ),
  ])
}

function StatusPage() {
  return VStack(
    [
      Text(() => lastAction.get()),
      ProgressBar(installProgress).frame({ maxWidth: -1 }),
      Text(() => (installing.get() ? 'Task running' : 'No active task')).foregroundColor(installing.get() ? 'yellow' : 'secondary'),
    ],
    { spacing: 1 },
  )
}

function CurrentPage() {
  if (tab.get() === 'Deps') return DepsPage()
  if (tab.get() === 'Status') return StatusPage()
  return ScriptsPage()
}

terminal.display(() =>
  VStack(
    [
      HStack([Text('Package Manager').fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Button('Install All', () => startInstall(), { loading: installing })]),
      TabBar(['Scripts', 'Deps', 'Status'] as Tab[], tab),
      ScrollView(CurrentPage(), { axis: 'vertical' }).frame({ maxWidth: -1, maxHeight: -1 }),
      TaskHost(installing.get() ? 'installing' : 'idle', async context => {
        while (installing.get() && !context.signal.aborted) {
          await Bun.sleep(300)
          if (context.signal.aborted) return
          installProgress.set(Math.min(1, installProgress.get() + 0.15))
          if (installProgress.get() >= 1) {
            installing.set(false)
            dependencies = dependencies.map(dep => ({ ...dep, installed: true }))
            lastAction.set('Install complete')
          }
          context.setNeedsUpdate()
        }
      }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }),
)
