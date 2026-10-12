import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'

import { clientPages } from './pages/registry'
import { clientRouteIds, createClientPageState, type ClientPageState, type ClientRouteId } from './pages/types'
import { clientHelpText, createHubClientView, renderHubClientFrame, runHubClientCommand } from './index'
import { normalizeHubAddress } from './pages/connect'
import { MemoryTerminalDevice, Terminal } from './terminal'
import type { KeyStore } from '../hub'
import { MemoryConnectionStore } from '../hub'

const scaffoldedPageFiles = [
  'home.ts',
  'connect.ts',
  'services.ts',
  'help/install-hub.ts',
  'help/install-s3.ts',
  'launcher.ts',
  'launcher/create-app.ts',
  'launcher/edit-app.ts',
  'launcher/store.ts',
  'security/pending-list.ts',
  'security/permission-groups.ts',
  'security/user-connections.ts',
  'security/lockdown.ts',
]

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function renderedPlainFrame(terminal: Terminal): string {
  return stripAnsi(terminal.renderToString())
}

function focusLabel(terminal: Terminal, label: string): void {
  const candidates = ((terminal as unknown as { candidates?: { id: string }[] }).candidates ?? []).slice()
  for (const candidate of candidates) {
    terminal.focus(candidate.id)
    const frame = renderedPlainFrame(terminal)
    if (frame.includes(`>${label}<`) || frame.includes(`>${label}>`) || frame.includes(`<${label}<`)) return
  }
  throw new Error(`Could not focus ${label}. Last frame:\n${renderedPlainFrame(terminal)}`)
}

function renderInteractiveClient(state: Partial<ClientPageState> = {}, initialPath: ClientRouteId[] = []) {
  const pageState = createClientPageState(state)
  const device = new MemoryTerminalDevice({ width: 100, height: 60 })
  const terminal = new Terminal(device).controls(true)
  terminal.display(createHubClientView(pageState, initialPath))
  return { device, terminal, state: pageState }
}

function expectNavigation(label: string, title: string, initialPath: ClientRouteId[] = [], state: Partial<ClientPageState> = {}): void {
  const client = renderInteractiveClient(state, initialPath)
  focusLabel(client.terminal, label)
  client.device.emitKey({ key: 'enter' })
  expect(renderedPlainFrame(client.terminal)).toContain(`Hub Client / ${title}`)
  client.terminal.stop()
}

test('smoke frame renders Home from the client route stack', () => {
  const frame = renderHubClientFrame()

  expect(frame).toContain('Hub Client / Home')
  expect(frame).toContain('Join Hub')
  expect(frame).toContain('Saved Hubs')
  expect(frame).toContain('Connect')
  expect(frame).toContain('Services')
  expect(frame).toContain('Launcher')
  expect(frame).toContain('Offline')
})

test('home renders selected hub dashboard state', () => {
  const frame = renderHubClientFrame({
    height: 60,
    state: {
      publicKey: 'hub-public-key',
      selectedConnectionId: 'local',
      connections: [
        {
          id: 'local',
          name: 'Local Hub',
          address: 'ws://localhost:1997',
          connected: true,
          serviceCount: 4,
          requestCount: 2,
        },
      ],
    },
  })

  expect(frame).toContain('Local Hub')
  expect(frame).toContain('[Selected]')
  expect(frame).toContain('[Connected]')
  expect(frame).toContain('[Services 4]')
  expect(frame).toContain('[Requests 2]')
  expect(frame).toContain('My Key')
  expect(frame).toContain('Support this Project')
})

test('connect page renders only the centered manual address form', () => {
  const frame = renderHubClientFrame({
    route: 'connect',
  })
  const lines = stripAnsi(frame).split('\n')
  const titleLine = lines.findIndex(line => line.includes('Manual address'))

  expect(frame).toContain('Hub Client / Connect')
  expect(frame).not.toContain('<Back]')
  expect(frame).not.toContain('[Back]')
  expect(frame).toContain('Manual address')
  expect(frame).toContain('localhost, ws://localhost:1997')
  expect(frame).not.toContain('Name')
  expect(frame).not.toContain('Hub name')
  expect(frame).not.toContain('[Connect]')
  expect(frame).not.toContain('Saved Connections')
  expect(frame).not.toContain('Make Your Own')
  expect(frame).not.toContain('How Hub Works')
  expect(titleLine).toBeGreaterThan(5)
})

test('connect page replaces manual title with normalized URL after address entry', () => {
  const frame = renderHubClientFrame({
    route: 'connect',
    state: {
      draftConnectionAddress: 'localhost',
    },
  })

  expect(frame).toContain('ws://localhost:1997')
  expect(frame).not.toContain('Manual address')
  expect(frame).toContain('Name')
  expect(frame).toContain('Local Hub')
  expect(frame).toContain('Connect')
  expect(frame).not.toContain('Will save')
})

test('connect page normalizes Hub addresses like the reference form', () => {
  expect(normalizeHubAddress('localhost')).toEqual({
    address: 'ws://localhost:1997',
    name: 'Local Hub',
    local: true,
  })
  expect(normalizeHubAddress('studio')).toEqual({
    address: 'ws://studio:1997',
    name: 'Studio',
    local: true,
  })
  expect(normalizeHubAddress('https://example.com/team')).toEqual({
    address: 'wss://example.com/team',
    name: 'Example',
    local: false,
  })
  expect(normalizeHubAddress('192.168.1.20:2000')).toEqual({
    address: 'ws://192.168.1.20:2000',
    name: '192 168 1 20',
    local: true,
  })
  expect(normalizeHubAddress('ftp://example.com')).toBeUndefined()
})

test('connect action saves the hub and closes the connect page', () => {
  const client = renderInteractiveClient({
    draftConnectionAddress: 'studio',
  }, ['connect'])

  focusLabel(client.terminal, 'Connect')
  client.device.emitKey({ key: 'enter' })

  expect(client.state.connections).toContainEqual({
    id: 'hub-1-ws-studio-1997',
    name: 'Studio',
    address: 'ws://studio:1997',
    connected: false,
    serviceCount: 0,
    requestCount: 0,
  })
  expect(client.state.selectedConnectionId).toBe('hub-1-ws-studio-1997')
  expect(renderedPlainFrame(client.terminal)).toContain('Hub Client / Home')
  expect(renderedPlainFrame(client.terminal)).not.toContain('Hub Client / Connect')
  client.terminal.stop()
})

test('install Hub guide renders tabs and copyable commands', () => {
  const defaultFrame = renderHubClientFrame({ route: 'help/install-hub' })
  const dockerFrame = renderHubClientFrame({
    route: 'help/install-hub',
    state: { installHubTab: 'Docker' },
  })

  expect(defaultFrame).toContain('Hub Client / Install Hub')
  expect(defaultFrame).toContain('[macOS / Linux]')
  expect(defaultFrame).toContain('curl -fsSL https://bun.sh/install | bash')
  expect(defaultFrame).toContain('bunx v57/hub')
  expect(dockerFrame).toContain('[Docker]')
  expect(dockerFrame).toContain('docker pull v57dev/hub')
  expect(dockerFrame).toContain('docker run -d -p 1997:1997 --name Hub v57dev/hub')
})

test('services page renders service rows, badges, key copy, and balancer actions', () => {
  const frame = renderHubClientFrame({
    route: 'services',
    height: 40,
    state: {
      publicKey: 'hub-public-key',
      selectedConnectionId: 'local',
      connections: [
        {
          id: 'local',
          name: 'Local Hub',
          address: 'ws://localhost:1997',
          connected: true,
          serviceCount: 2,
          requestCount: 11,
        },
      ],
      selectedServiceId: 'ocr/run',
      services: [
        { id: 'ocr/run', name: 'ocr/run', services: 2, requests: 10, balancer: 'available', running: 1, pending: 3 },
        { id: 's3/list', name: 's3/list', services: 0, requests: 1, disabled: 1 },
      ],
    },
  })

  expect(frame).toContain('Hub Client / Services')
  expect(frame).toContain('[11 requests]')
  expect(frame).toContain('ocr/run')
  expect(frame).toContain('online')
  expect(frame).toContain('queued-distributed')
  expect(frame).toContain('Load Balancer')
  expect(frame).toContain('Active Limit')
  expect(frame).toContain('Copy Key')
})

test('install S3 guide renders local, cloud, manual, and file-browser states', () => {
  const localFrame = renderHubClientFrame({
    route: 'help/install-s3',
    height: 36,
    state: {
      storageCanCreateLauncherApp: true,
    },
  })
  const cloudFrame = renderHubClientFrame({
    route: 'help/install-s3',
    height: 40,
    state: {
      storageTab: 'Cloud',
      storageCloudStep: 2,
      s3BucketName: 'hub-files',
      s3Region: 'ap-southeast-1',
    },
  })
  const manualFrame = renderHubClientFrame({
    route: 'help/install-s3',
    height: 60,
    state: {
      storageTab: 'Connect',
      storageAppInstalled: true,
      s3Endpoint: 'https://s3.example.com',
      s3BucketName: 'hub-files',
      s3AccessKey: 'ACCESS123',
      s3SecretKey: 'SECRET123',
    },
  })
  const filesFrame = renderHubClientFrame({
    route: 'help/install-s3',
    height: 30,
    state: {
      storageOpen: true,
      storagePath: '/Hub/Files',
      storageFiles: [
        { kind: 'directory', name: 'uploads' },
        { kind: 'file', name: 'photo.jpg', size: 2048 },
      ],
    },
  })

  expect(localFrame).toContain('Hub Client / Connect Storage')
  expect(localFrame).toContain('[Local]')
  expect(localFrame).toContain('Shared Directory')
  expect(localFrame).toContain('Create')
  expect(cloudFrame).toContain('[Cloud]')
  expect(cloudFrame).toContain('Bucket Name')
  expect(cloudFrame).toContain('ap-southeast-1')
  expect(cloudFrame).toContain('https://s3.ap-southeast-1.wasabisys.com')
  expect(manualFrame).toContain('[Connect]')
  expect(manualFrame).toContain('S3_SECRET_ACCESS_KEY=********')
  expect(manualFrame).not.toContain('SECRET123')
  expect(filesFrame).toContain('Open Files')
  expect(filesFrame).toContain('[DIR] uploads')
  expect(filesFrame).toContain('[FILE] photo.jpg 2 KB')
})

test('launcher pages render lifecycle, create, edit, and store workflows', () => {
  const launcherState = {
    publicKey: 'hub-public-key',
    launcherStatus: 'running' as const,
    launcherUpdateAvailable: true,
    selectedLauncherAppId: 'Hub Lite',
    launcherApps: [
      {
        id: 'Hub Lite',
        name: 'Hub Lite',
        active: true,
        restarts: true,
        updateAvailable: true,
        instances: 1,
        processes: [{ pid: 100, cpu: 2.5, memory: 1024 * 1024 * 64 }],
      },
      {
        id: 'S3 Storage',
        name: 'S3 Storage',
        active: false,
        instances: 1,
        settings: {
          env: { S3_BUCKET: 'hub-files' },
          secrets: { S3_SECRET_ACCESS_KEY: 'TOKENVALUE' },
        },
      },
    ],
  }
  const launcherFrame = renderHubClientFrame({
    route: 'launcher',
    height: 45,
    state: launcherState,
  })
  const createFrame = renderHubClientFrame({
    route: 'launcher/create-app',
    height: 60,
    state: {
      createAppMode: 'Bun',
      createBunRepo: 'v57/hub-s3',
    },
  })
  const editFrame = renderHubClientFrame({
    route: 'launcher/edit-app',
    height: 50,
    state: {
      ...launcherState,
      editAppName: 'S3 Storage',
    },
  })
  const storeFrame = renderHubClientFrame({
    route: 'launcher/store',
    height: 50,
    state: {
      storeFilter: 'Api',
      storeItems: [
        { id: 'local-storage', name: 'Local Storage', shortDescription: 'Share a local directory', type: 'api', setup: true },
        { id: 'notes', name: 'Notes', shortDescription: 'Desktop notes app', type: 'app', setup: true },
      ],
    },
  })

  expect(launcherFrame).toContain('Hub Client / Launcher')
  expect(launcherFrame).toContain('[Running]')
  expect(launcherFrame).toContain('Hub Lite')
  expect(launcherFrame).toContain('App Actions')
  expect(launcherFrame).toContain('Upgrade to Pro')
  expect(launcherFrame).toContain('Update All')
  expect(createFrame).toContain('Hub Client / Create App')
  expect(createFrame).toContain('[Bun]')
  expect(createFrame).toContain('setup: bun v57/hub-s3')
  expect(createFrame).toContain('name: hub s3')
  expect(editFrame).toContain('Hub Client / Edit App')
  expect(editFrame).toContain('Environment values')
  expect(editFrame).toContain('S3_BUCKET')
  expect(editFrame).not.toContain('TOKENVALUE')
  expect(storeFrame).toContain('Hub Client / Launcher Store')
  expect(storeFrame).toContain('[Api]')
  expect(storeFrame).toContain('Local Storage')
  expect(storeFrame).toContain('Get')
  expect(storeFrame).not.toContain('Notes')
})

test('security pages render pending, groups, connections, and lockdown controls', () => {
  const securityState = {
    publicKey: 'current-key-12345678',
    securityCanManageHost: true,
    securityCanManageGroups: true,
    hostPending: [
      { key: 'service-key-abcdef12', name: 'Camera Service', paths: ['hub/status', 'camera/run'] },
    ],
    callPending: [
      { key: 'caller-key-99999999', name: 'Build Agent', paths: ['s3/list'] },
    ],
    permissionNames: {
      'hub/status': 'Hub: Status',
      'camera/run': 'Camera: Run',
      's3/list': 'Storage: List',
    },
    permissionGroups: [
      { name: 'Owners', permissions: ['hub/status', 'camera/run'] },
      { name: 'Files', permissions: ['s3/list'] },
    ],
    users: [
      { id: 'me', name: 'Current Device', key: 'current-key-12345678', group: 'Owners', services: 1, apps: 0 },
      { id: 'storage', name: 'Storage Service', key: 'service-key-abcdef12', services: 2, apps: 1 },
    ],
    lockdownEnabled: true,
    trustedKeys: ['current-key-12345678'],
  }

  const pendingFrame = renderHubClientFrame({ route: 'security/pending-list', height: 45, state: securityState })
  const groupsFrame = renderHubClientFrame({ route: 'security/permission-groups', height: 55, state: securityState })
  const usersFrame = renderHubClientFrame({ route: 'security/user-connections', height: 55, state: securityState })
  const lockdownFrame = renderHubClientFrame({ route: 'security/lockdown', height: 55, state: securityState })

  expect(pendingFrame).toContain('Hub Client / Security Requests')
  expect(pendingFrame).toContain('Camera Service')
  expect(pendingFrame).toContain('camera/run')
  expect(pendingFrame).toContain('Allow')
  expect(groupsFrame).toContain('Hub Client / Permission Groups')
  expect(groupsFrame).toContain('Owners')
  expect(groupsFrame).toContain('Camera')
  expect(groupsFrame).toContain('Create Group')
  expect(usersFrame).toContain('Hub Client / User Connections')
  expect(usersFrame).toContain('Current Device')
  expect(usersFrame).toContain('Owners')
  expect(usersFrame).toContain('(You)')
  expect(usersFrame).toContain('Set Group')
  expect(lockdownFrame).toContain('Hub Client / Lockdown')
  expect(lockdownFrame).toContain('Lockdown: on')
  expect(lockdownFrame).toContain('Current Device')
  expect(lockdownFrame).toContain('Trusted')
  expect(lockdownFrame).toContain('Group')
})

test('home navigation links push every primary page route', () => {
  expectNavigation('Connect', 'Connect')
  expectNavigation('Install Hub', 'Install Hub')
  expectNavigation('Services', 'Services')
  expectNavigation('Launcher', 'Launcher')
  expectNavigation('Storage Setup', 'Connect Storage')
  expectNavigation('Requests', 'Security Requests')
  expectNavigation('Permissions', 'Permission Groups')
  expectNavigation('Connections', 'User Connections')
  expectNavigation('Lockdown', 'Lockdown')
})

test('launcher navigation links push nested page routes', () => {
  const launcherState = {
    selectedLauncherAppId: 'Demo',
    launcherApps: [
      { id: 'Demo', name: 'Demo', active: true, settings: { env: { PORT: '1997' } } },
    ],
  }

  expectNavigation('Create', 'Create App', ['launcher'], launcherState)
  expectNavigation('Get More', 'Launcher Store', ['launcher'], launcherState)
  expectNavigation('Settings', 'Edit App', ['launcher'], launcherState)
})

test('client page interactions cover tab, context-menu overlay, form action, and escape key paths', () => {
  const services = renderInteractiveClient({
    services: [
      { id: 'ocr/run', name: 'ocr/run', services: 1, requests: 2, balancer: 'counter' },
    ],
    selectedServiceId: 'ocr/run',
  }, ['services'])
  focusLabel(services.terminal, 'Load Balancer')
  services.device.emitKey({ key: 'char', char: ' ' })
  expect(renderedPlainFrame(services.terminal)).toContain('Load balancer: Random')
  services.device.emitKey({ key: 'enter' })
  expect(services.state.serviceBalancerRequests).toEqual([{ path: 'ocr/run', type: 'random' }])
  services.terminal.stop()

  const storage = renderInteractiveClient({}, ['help/install-s3'])
  storage.device.emitKey({ key: 'tab' })
  expect(storage.state.storageTab).toBe('Cloud')
  storage.terminal.stop()

  const create = renderInteractiveClient({
    createAppMode: 'Bun',
    createBunRepo: 'v57/hub-s3',
  }, ['launcher/create-app'])
  focusLabel(create.terminal, 'Create')
  create.device.emitKey({ key: 'enter' })
  expect(create.state.launcherApps?.map(app => app.name)).toContain('hub s3')
  create.terminal.stop()

  const navigation = renderInteractiveClient({}, ['services'])
  navigation.device.emitKey({ key: 'escape' })
  expect(renderedPlainFrame(navigation.terminal)).toContain('Hub Client / Home')
  navigation.terminal.stop()
})

test('client can smoke render every scaffolded page route', () => {
  for (const route of clientRouteIds) {
    const frame = renderHubClientFrame({ route, height: 50 })
    expect(frame).toContain('Hub Client /')
  }
})

test('client command smoke writes one deterministic frame', async () => {
  const writes: string[] = []

  await runHubClientCommand({
    args: ['--smoke'],
    stdout: {
      write(text) {
        writes.push(text)
      },
    },
  })

  expect(writes).toEqual([renderHubClientFrame()])
})

test('client command keeps the controls row enabled in interactive mode', async () => {
  const device = new MemoryTerminalDevice({ width: 80, height: 24 })

  await runHubClientCommand({
    args: [],
    device,
  })

  expect(device.writes.at(-1)).toContain('↵ Connect')
  expect(device.writes.at(-1)).not.toContain('↵ Install Hub')
  device.emitKey({ key: 'ctrl-c' })
})

test('client command loads the public key before the first interactive frame', async () => {
  const device = new MemoryTerminalDevice({ width: 80, height: 24 })
  let publicKeyCalls = 0
  const keyStore: KeyStore = {
    async getOrCreatePrivateKey() {
      return 'private-key'
    },
    async publicKey() {
      publicKeyCalls += 1
      return 'stored-public-key'
    },
    async sign() {
      return 'signature'
    },
    async authHeaders() {
      return { auth: 'auth', v: '1' }
    },
  }

  await runHubClientCommand({
    args: [],
    device,
    keyStore,
  })

  expect(publicKeyCalls).toBe(1)
  expect(device.writes.at(-1)).toBe(renderHubClientFrame({ height: 24, state: { publicKey: 'stored-public-key' } }))
  device.emitKey({ key: 'ctrl-c' })
})

test('client command loads saved hubs before the first interactive frame', async () => {
  const device = new MemoryTerminalDevice({ width: 80, height: 24 })
  const connectionStore = new MemoryConnectionStore({
    connections: [
      {
        id: 'local-hub',
        name: 'Local Hub',
        address: 'ws://localhost:1997',
      },
    ],
    selectedId: 'local-hub',
  })

  const keyStore: KeyStore = {
    async getOrCreatePrivateKey() {
      return 'private-key'
    },
    async publicKey() {
      return 'stored-public-key'
    },
    async sign() {
      return 'signature'
    },
    async authHeaders() {
      return { auth: 'auth', v: '1' }
    },
  }

  await runHubClientCommand({
    args: [],
    device,
    connectionStore,
    keyStore,
    connectionProbe: async connection => ({
      connected: connection.address === 'ws://localhost:1997',
      serviceCount: connection.address === 'ws://localhost:1997' ? 3 : 0,
      requestCount: connection.address === 'ws://localhost:1997' ? 1 : 0,
    }),
  })

  const frame = device.writes.at(-1) ?? ''
  expect(frame).toContain('Local Hub')
  expect(frame).toContain('[Selected]')
  expect(frame).toContain('[Connected]')
  expect(frame).toContain('[Services 3]')
  expect(frame).toContain('[Requests 1]')
  device.emitKey({ key: 'ctrl-c' })
})

test('route link detail appears in the control bar instead of a separate row', () => {
  const client = renderInteractiveClient()
  const candidates = ((client.terminal as unknown as { candidates?: { id: string }[] }).candidates ?? []).slice()
  let matched = false

  for (const candidate of candidates) {
    client.terminal.focus(candidate.id)
    const frame = renderedPlainFrame(client.terminal)
    const lines = frame.split('\n').map(line => line.trim())
    if (frame.includes('↵ Connect - Add or select saved Hub connections.')) {
      expect(lines).not.toContain('Add or select saved Hub connections.')
      matched = true
      break
    }
  }

  expect(matched).toBe(true)

  client.terminal.stop()
})

test('client command can start from every page route', async () => {
  for (const page of clientPages) {
    const writes: string[] = []

    await runHubClientCommand({
      args: [...page.route.split('/'), '--smoke'],
      stdout: {
        write(text) {
          writes.push(text)
        },
      },
    })

    expect(writes).toEqual([renderHubClientFrame({ route: page.route })])
  }
})

test('client command supports page-name shortcuts for nested pages', async () => {
  const writes: string[] = []

  await runHubClientCommand({
    args: ['install-s3', '--smoke'],
    stdout: {
      write(text) {
        writes.push(text)
      },
    },
  })

  expect(writes).toEqual([renderHubClientFrame({ route: 'help/install-s3' })])
})

test('client help lists every page command route', () => {
  const help = clientHelpText()

  expect(help).toContain('Usage: hub client [page] [options]')
  for (const page of clientPages) {
    expect(help).toContain(page.route)
    expect(help).toContain(page.title)
  }
})

test('all scaffolded pages keep their Page spec comments and route contracts', () => {
  const pageRoutes = clientPages.map(page => page.route)

  expect(pageRoutes).toEqual([...clientRouteIds])
  expect(new Set(pageRoutes).size).toBe(pageRoutes.length)

  for (const file of scaffoldedPageFiles) {
    const source = readFileSync(new URL(`./pages/${file}`, import.meta.url), 'utf8')
    expect(source.trimStart().startsWith('/**')).toBe(true)
    expect(source.slice(0, 600)).toContain('Page spec:')
  }
})
