/**
 * Page spec: Connect / Hub introduction.
 *
 * Source reference:
 * - `Reference/Hub works.swift`
 * - `Reference/Hub Features.swift`
 *
 * How user gets here:
 * - This TS page is an empty scaffold. Reference files define two closely related
 *   explanatory pages, both scrollable feature-card grids. Use this page for
 *   the web/terminal "how Hub works" or "connect devices" overview.
 * - Likely reachable from landing/home/info navigation, not from a hub-specific
 *   permission-gated action.
 *
 * What page displays:
 * - Scrollable adaptive grid of feature cards.
 * - Cards are centered, icon-first, with title and description.
 * - Reference visual style: large SF Symbol icon, red accent, rounded card,
 *   shadow, centered multiline text.
 *
 * Feature set from `Reference/Hub works.swift` (`FeaturesView`):
 * - Device Mesh:
 *   Connect iPhone, iPad, Mac, Windows, Linux, and server devices into one Hub
 *   so idle hardware can share work.
 * - Local Compute:
 *   Use nearby devices for heavy jobs like image encoding, video compression,
 *   translation, LLM chat, content filtering, AI, and media tasks.
 * - Service APIs:
 *   Turn app features, scripts, terminal commands, and backend modules into
 *   services exposed as simple APIs across projects.
 * - Shared Storage:
 *   Combine device storage or S3 providers, including Local S3, for files,
 *   static assets, configs, and processing outputs.
 * - Auto Launcher:
 *   Keep hubs, services, servers, and processes online with restarts, resource
 *   monitoring, updates, imports, and multi-instance scaling.
 * - Load Balance:
 *   Split identical service APIs across available devices, with Pro controls for
 *   balancing strategy and active request limits.
 * - Access Control:
 *   Hub Pro supports invites, multi-hub connections, service permissions, and
 *   lockdown access for teams or remote devices.
 * - Open Source:
 *   Free, transparent, dependency-light, no ads/tracking, GitHub-based stores
 *   and community feedback.
 *
 * Alternate shorter feature set from `Reference/Hub Features.swift`
 * (`HowHubWorksView`):
 * - Connect Devices.
 * - Run Services.
 * - Balance Load.
 * - Stay Online.
 * - Share Storage.
 * - Control Access.
 *
 * Actions and menus:
 * - Reference pages have no buttons, forms, context menus, or API calls.
 * - Page is read-only.
 *
 * Data/state needed:
 * - Static feature list only.
 *
 * Web port notes:
 * - Use semantic cards with icons and concise copy.
 * - Preserve adaptive layout: many cards on wide screens, one/two columns on
 *   narrow screens.
 * - This page should not require active hub connection.
 *
 * Terminal port notes:
 * - Render as numbered feature list or selectable cards.
 * - Optional detail pane can show description for highlighted feature.
 */
import { Button, HStack, Spacer, Text, TextField, VStack } from '../terminal'
import { stateBinding } from './shared'
import type { ClientPage } from './types'

export const connectPage: ClientPage = {
  route: 'connect',
  title: 'Connect',
  render(context) {
    const state = context.state
    const address = state.draftConnectionAddress ?? ''
    const normalized = normalizeHubAddress(address)
    const name = state.draftConnectionName?.trim() || normalized?.name || ''
    const canConnect = Boolean(normalized && name)
    const hasAddress = address.trim().length > 0
    const title = hasAddress ? (normalized?.address ?? address.trim()) : 'Address'

    return VStack([
      HStack(
        [
          Text(`Hub Client / ${this.title}`).fontWeight('bold').foregroundColor('cyan'),
          Spacer({ minLength: 1 }),
          Text(state.error ? 'Error' : state.loading ? 'Loading' : 'Offline').foregroundColor(
            state.error ? 'red' : state.loading ? 'yellow' : 'secondary',
          ),
        ],
        { spacing: 1 },
      ),
      VStack(
        [
          VStack([
            Text(title).fontWeight('bold'),
            TextField(stateBinding(state, 'draftConnectionAddress', ''), {
              placeholder: 'localhost, ws://localhost:1997',
            }).frame({ maxWidth: -1 }),
          ]),
          VStack([
            Text('Name').fontWeight('bold'),
            TextField(stateBinding(state, 'draftConnectionName', ''), {
              placeholder: normalized?.name ?? 'Hub name',
            }).frame({ maxWidth: -1 }),
          ]).visible(hasAddress),
          Button('Connect', () => saveConnection(context, normalized!, name), { disabled: !canConnect }).visible(
            hasAddress,
          ),
        ],
        { spacing: 1 },
      )
        .frame({ width: 42 })
        .frame({ maxWidth: -1, maxHeight: -1, alignment: 'center' }),
    ]).frame({ maxWidth: -1, maxHeight: -1, alignment: 'topLeading' })
  },
}

export interface NormalizedHubAddress {
  address: string
  name: string
  local: boolean
}

export function normalizeHubAddress(input: string): NormalizedHubAddress | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined

  try {
    const withScheme = withParseableScheme(trimmed)
    const url = new URL(withScheme)
    if (!url.hostname) return undefined
    const local = isLocalHost(url.hostname)
    url.protocol = local ? 'ws:' : 'wss:'
    if (local && !url.port) url.port = '1997'
    return {
      address: serializeHubUrl(url),
      name: hubNameFromUrl(url, local),
      local,
    }
  } catch {
    return undefined
  }
}

function saveConnection(
  context: Parameters<ClientPage['render']>[0],
  normalized: NormalizedHubAddress,
  name: string,
): void {
  const state = context.state
  const existing = state.connections.find(connection => connection.address === normalized.address)
  if (existing) {
    existing.name = name
    state.selectedConnectionId = existing.id
    state.connectionNotice = `${name} selected`
  } else {
    const id = `hub-${state.connections.length + 1}-${normalized.address
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()}`
    state.connections = [
      ...state.connections,
      {
        id,
        name,
        address: normalized.address,
        connected: false,
        serviceCount: 0,
        requestCount: 0,
      },
    ]
    state.selectedConnectionId = id
    state.connectionNotice = `${name} saved`
  }
  state.draftConnectionAddress = ''
  state.draftConnectionName = ''
  context.closePage()
}

function withParseableScheme(value: string): string {
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
  if (scheme === 'http') return `ws://${value.slice('http://'.length)}`
  if (scheme === 'https') return `wss://${value.slice('https://'.length)}`
  if (scheme === 'ws' || scheme === 'wss') return value
  if (scheme) throw new Error(`Unsupported Hub URL scheme: ${scheme}`)
  return `ws://${value}`
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local')) return true
  if (!host.includes('.')) return true
  if (host.startsWith('127.')) return true
  if (host.startsWith('10.')) return true
  if (host.startsWith('192.168.')) return true
  const private172 = host.match(/^172\.(\d+)\./)
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false
}

function serializeHubUrl(url: URL): string {
  const auth = url.username || url.password ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  const host = `${url.hostname}${url.port ? `:${url.port}` : ''}`
  const path = url.pathname === '/' ? '' : url.pathname
  return `${url.protocol}//${auth}${host}${path}${url.search}${url.hash}`
}

function hubNameFromUrl(url: URL, local: boolean): string {
  if (local)
    return url.hostname === 'localhost' || url.hostname.startsWith('127.')
      ? 'Local Hub'
      : titleize(url.hostname.replace(/\.local$/i, ''))
  const host = url.hostname.replace(/^www\./i, '')
  return titleize(host.split('.')[0] || host)
}

function titleize(value: string): string {
  return (
    value
      .split(/[-_.\s]+/)
      .filter(Boolean)
      .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ') || 'Hub'
  )
}
