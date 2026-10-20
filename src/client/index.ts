import { MemoryTerminalDevice, NavigationStack, State, Terminal, type TerminalDevice, type ViewNode } from './terminal'
import { clientPages, renderClientRoute } from './pages/registry'
import { clientRouteIds, createClientPageState, type ClientPageState, type ClientRouteId } from './pages/types'
import {
  DeviceControl,
  DeviceIdentity,
  HubClient,
  HubControl,
  SecurityControl,
  MemoryHubKeyStore,
  createDefaultKeyStore,
  type ConnectionStore,
  type HubKeyStore,
  type KeyStore,
} from '../hub'

export interface RunHubClientCommandOptions {
  args?: string[]
  state?: Partial<ClientPageState>
  connectionStore?: ConnectionStore
  keyStore?: KeyStore
  /** Pinned hub keys; defaults to memory (the `hub client` command passes `~/.hub-lib/hubs.json`). */
  hubKeys?: HubKeyStore
  /** Used with `--device`; defaults to the device key at `HUB_DEVICE_KEY` or `~/.hub/device.key`. */
  deviceIdentity?: DeviceIdentity
  connectionProbe?: ConnectionProbe
  device?: TerminalDevice
  stdout?: OutputWriter
}

export interface OutputWriter {
  write(text: string): unknown
}

interface ClientCommand {
  route: ClientRouteId
  smoke: boolean
  device: boolean
}

export interface ConnectionAuth {
  hubKeys: HubKeyStore
  device?: DeviceIdentity
}

export type ConnectionProbe = (
  connection: ClientPageState['connections'][number],
  keyStore: KeyStore,
  auth: ConnectionAuth,
) => Promise<Partial<ClientPageState['connections'][number]>>

export interface RenderHubClientFrameOptions {
  state?: Partial<ClientPageState>
  route?: ClientRouteId
  width?: number
  height?: number
}

const routeIdSet = new Set<string>(clientRouteIds)

export function createHubClientView(
  state: ClientPageState = createClientPageState(),
  initialPath: ClientRouteId[] = [],
): () => ViewNode {
  const path = State<ClientRouteId[]>(initialPath)
  const closePage = () => {
    path.set(path.get().slice(0, -1))
  }
  return () =>
    NavigationStack(
      path,
      () => renderClientRoute('home', { state, closePage }),
      route => renderClientRoute(route, { state, closePage }),
    )
}

export function renderHubClientFrame(options: RenderHubClientFrameOptions = {}): string {
  const device = new MemoryTerminalDevice({
    width: options.width ?? 80,
    height: options.height ?? 30,
  })
  const terminal = new Terminal(device).controls(true)
  const initialPath = options.route && options.route !== 'home' ? [options.route] : []
  terminal.display(createHubClientView(createClientPageState(options.state), initialPath))
  terminal.stop()
  return device.writes.at(-1) ?? ''
}

export async function runHubClientCommand(options: RunHubClientCommandOptions = {}): Promise<void> {
  const args = options.args ?? process.argv.slice(2)
  const stdout = options.stdout ?? process.stdout
  if (isClientHelpRequest(args)) {
    stdout.write(clientHelpText())
    return
  }

  const command = parseClientCommand(args)
  if (command.smoke) {
    stdout.write(renderHubClientFrame({ route: command.route, state: options.state }))
    return
  }

  const auth: ConnectionAuth = {
    hubKeys: options.hubKeys ?? new MemoryHubKeyStore(),
    device: command.device ? (options.deviceIdentity ?? new DeviceIdentity()) : undefined,
  }
  const terminal = new Terminal(options.device).controls(true)
  const initialPath = command.route === 'home' ? [] : [command.route]
  terminal.display(createHubClientView(await resolveStartupState(options, auth), initialPath))
}

export function clientHelpText(): string {
  return [
    'Usage: hub client [page] [options]',
    '',
    'Pages:',
    ...clientPages.map(page => `  ${page.route.padEnd(26)} ${page.title}`),
    '',
    'Options:',
    '  --smoke     Render one deterministic frame and exit',
    '  --device    Connect as this device (certificate from ~/.hub/device.key); key only by default',
    '  -h, --help  Show this help message',
    '',
  ].join('\n')
}

function isClientHelpRequest(args: string[]): boolean {
  return (
    args[0] === '-h' ||
    args[0] === '--help' ||
    (args[0] === 'help' && (args.length === 1 || args[1]?.startsWith('-') === true))
  )
}

function parseClientCommand(args: string[]): ClientCommand {
  const smoke = args.includes('--smoke')
  const device = args.includes('--device')
  const routeArgs = args.filter(arg => arg !== '--smoke' && arg !== '--device')
  return {
    route: resolveClientRoute(routeArgs),
    smoke,
    device,
  }
}

function resolveClientRoute(args: string[]): ClientRouteId {
  if (args.length === 0) return 'home'

  const route = args.join('/')
  if (isClientRouteId(route)) return route

  if (args.length === 1) {
    const pageName = args[0]
    const page = clientPages.find(candidate => candidate.route.split('/').at(-1) === pageName)
    if (page) return page.route
  }

  throw new Error(`Unknown client page: ${args.join(' ')}`)
}

function isClientRouteId(route: string): route is ClientRouteId {
  return routeIdSet.has(route)
}

async function resolveStartupState(options: RunHubClientCommandOptions, auth: ConnectionAuth): Promise<ClientPageState> {
  const state = createClientPageState(options.state)
  const keyStore = options.keyStore ?? createDefaultKeyStore()
  if (!state.publicKey) {
    try {
      state.publicKey = await keyStore.publicKey()
    } catch {
      // Keep the client usable if the local key store is unavailable.
    }
  }
  try {
    if (options.connectionStore) {
      const [connections, selected] = await Promise.all([options.connectionStore.list(), options.connectionStore.selected()])
      const selectedId = selected?.id ?? connections[0]?.id
      const summaries = connections.map(connection => ({
        ...connection,
        connected: false,
        serviceCount: 0,
        requestCount: 0,
      }))
      if (selectedId) {
        const index = summaries.findIndex(connection => connection.id === selectedId)
        if (index >= 0) {
          const probe = options.connectionProbe ?? defaultConnectionProbe
          const refreshed = await probe(summaries[index]!, keyStore, auth)
          summaries[index] = { ...summaries[index]!, ...refreshed }
        }
      }
      state.connections = summaries
      state.selectedConnectionId = selectedId
      const active = summaries.find(connection => connection.id === selectedId)
      if (active && !state.live) {
        // Connects on the first request, which only pages with live data make.
        const client = new HubClient({ address: active.address, keyStore, hubKeys: auth.hubKeys, device: auth.device })
        state.live = { devices: new DeviceControl(client), security: new SecurityControl(client) }
      }
    }
  } catch {
    // Keep the client usable if the saved connection store is unavailable.
  }
  return state
}

async function defaultConnectionProbe(
  connection: ClientPageState['connections'][number],
  keyStore: KeyStore,
  auth: ConnectionAuth,
): Promise<Partial<ClientPageState['connections'][number]>> {
  const client = new HubClient({ address: connection.address, keyStore, hubKeys: auth.hubKeys, device: auth.device })
  try {
    const status = await new HubControl(client).status()
    return {
      connected: true,
      serviceCount: status.services.length,
      requestCount: status.requests,
    }
  } catch {
    return {
      connected: false,
    }
  } finally {
    client.stop()
  }
}
