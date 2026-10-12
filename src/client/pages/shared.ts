import {
  Button,
  HStack,
  NavigationLink,
  ScrollView,
  Spacer,
  StatusBadge,
  Text,
  VStack,
  type Binding,
  type ViewNode,
} from '../terminal'
import type { ClientConnectionSummary, ClientPage, ClientPageContext, ClientPageState, ClientRouteId } from './types'

export interface StaticPageSection {
  title: string
  rows: string[]
}

export function PageShell(
  page: ClientPage,
  context: ClientPageContext,
  content: ViewNode[],
  options: { empty?: string } = {},
): ViewNode {
  const state = context.state
  const status = state.loading
    ? 'Loading'
    : state.error
      ? 'Error'
      : state.connections.length > 0
        ? `${state.connections.length} hub${state.connections.length === 1 ? '' : 's'}`
        : 'Offline'

  const body =
    content.length > 0
      ? VStack(content, { spacing: 1, alignment: 'leading' })
      : Text(options.empty ?? 'Nothing to show yet.').foregroundColor('secondary')

  return VStack(
    [
      HStack(
        [
          Text(`Hub Client / ${page.title}`).fontWeight('bold').foregroundColor('cyan'),
          Spacer({ minLength: 1 }),
          Text(status).foregroundColor(state.error ? 'red' : state.loading ? 'yellow' : 'secondary'),
        ],
        { spacing: 1 },
      ),
      ...(state.error ? [Text(state.error).foregroundColor('red')] : []),
      ScrollView(body.frame({ maxWidth: -1, alignment: 'leading' }), { axis: 'vertical' }).frame({
        maxWidth: -1,
        maxHeight: -1,
      }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 })
}

export function Section(title: string, rows: ViewNode[]): ViewNode {
  return VStack([Text(title).fontWeight('bold'), ...rows], { spacing: 0 }).frame({
    maxWidth: -1,
    alignment: 'topLeading',
  })
}

export function Card(title: string, rows: ViewNode[], badges: ViewNode[] = []): ViewNode {
  return VStack(
    [HStack([Text(title).fontWeight('bold'), Spacer({ minLength: 1 }), ...badges], { spacing: 1 }), ...rows],
    { spacing: 1 },
  ).frame({
    maxWidth: -1,
    alignment: 'topLeading',
  })
}

export function TextRows(rows: string[]): ViewNode[] {
  return rows.map(row => Text(row, { wrap: true }).foregroundColor(row.startsWith('-') ? 'secondary' : 'primary'))
}

export function RouteLink(label: string, route: ClientRouteId, detail?: string): ViewNode {
  return NavigationLink(label, route, detail)
}

export function ConnectionRows(connections: ClientConnectionSummary[]): ViewNode[] {
  if (connections.length === 0) {
    return [
      Text('No saved hubs.'),
      Text('Use Connect to add a local or remote Hub address.').foregroundColor('secondary'),
    ]
  }

  return connections.map(connection => {
    const status = connection.connected ? 'connected' : 'offline'
    const serviceCount = connection.serviceCount ?? 0
    const requestCount = connection.requestCount ?? 0
    return Text(
      `${connection.name} ${connection.address} [${status}] services:${serviceCount} requests:${requestCount}`,
    )
  })
}

export function stateBinding<K extends keyof ClientPageState>(
  state: ClientPageState,
  key: K,
  fallback: NonNullable<ClientPageState[K]>,
): Binding<NonNullable<ClientPageState[K]>> {
  return {
    get() {
      return (state[key] ?? fallback) as NonNullable<ClientPageState[K]>
    },
    set(value) {
      state[key] = value as ClientPageState[K]
    },
  }
}

export function selectedConnection(state: ClientPageState): ClientConnectionSummary | undefined {
  return state.connections.find(connection => connection.id === state.selectedConnectionId) ?? state.connections[0]
}

export function SelectConnectionButton(state: ClientPageState, connection: ClientConnectionSummary): ViewNode {
  const selected = selectedConnection(state)?.id === connection.id
  return Button(
    selected ? 'Selected' : 'Select',
    () => {
      state.selectedConnectionId = connection.id
      state.connectionNotice = `${connection.name} selected`
    },
    { disabled: selected },
  )
}

export function ConnectionCard(state: ClientPageState, connection: ClientConnectionSummary): ViewNode {
  const selected = selectedConnection(state)?.id === connection.id
  const serviceCount = connection.serviceCount ?? 0
  const requestCount = connection.requestCount ?? 0
  const status = connection.connected ? StatusBadge('Online', 'success') : StatusBadge('Offline', 'muted')
  const selection = selected ? StatusBadge('Selected', 'default') : StatusBadge('Saved', 'muted')
  return Card(
    connection.name,
    [
      Text(connection.address).foregroundColor('secondary'),
      HStack(
        [Text(`Services ${serviceCount}`), Text(`Requests ${requestCount}`), SelectConnectionButton(state, connection)],
        { spacing: 2 },
      ),
    ],
    [selection, status],
  ).contextMenu([
    {
      label: 'Select',
      action: () => {
        state.selectedConnectionId = connection.id
        state.connectionNotice = `${connection.name} selected`
      },
    },
    {
      label: 'Remove',
      action: () => {
        state.connections = state.connections.filter(item => item.id !== connection.id)
        if (state.selectedConnectionId === connection.id) state.selectedConnectionId = state.connections[0]?.id
        state.connectionNotice = `${connection.name} removed`
      },
    },
  ])
}

export function createStaticPage(route: ClientRouteId, title: string, sections: StaticPageSection[]): ClientPage {
  return {
    route,
    title,
    render(context) {
      return PageShell(
        this,
        context,
        sections.map(section => Section(section.title, TextRows(section.rows))),
      )
    },
  }
}
