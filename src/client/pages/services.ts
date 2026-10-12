/**
 * Page spec: Services / Hub API.
 *
 * Source reference:
 * - `Reference/Services.swift`
 *
 * How user gets here:
 * - Home -> selected hub section -> "Services" card.
 * - In Swift reference this is pushed as a hub-scoped destination/sheet and
 *   inherits current Hub environment.
 *
 * What page displays:
 * - List page for APIs produced by services connected to selected hub.
 * - First list section is explanatory placeholder:
 *   - Icon: hexagon.
 *   - Title: "Hub API".
 *   - Text explains that APIs produced by services live here, load balancer
 *     settings can be changed for each API, and request counts are visible.
 * - After placeholder, one row per `status.services` entry.
 * - Navigation title:
 *   - Connected: "<total request count> requests".
 *   - Disconnected: "Disconnected".
 *
 * Service row display:
 * - Primary line: service/API name.
 * - Small online status dot:
 *   - Blue = online when `service.services > 0`.
 *   - Orange = unauthorized when no live service but `disabled > 0`.
 *   - Red = offline otherwise.
 * - Secondary badges:
 *   - Request count with number icon when `requests > 0`.
 *   - Load balancer icon when balancer is not default round-robin/counter.
 *   - Running count with clock/active icon when `running > 0`.
 *   - Pending count with tray icon when `pending > 0`.
 *
 * Toolbar actions:
 * - "Copy Key" copies local public key to clipboard.
 * - Web should show toast or temporary copied state.
 * - Terminal should print/copy key depending available clipboard support.
 *
 * Row context menu:
 * - Menu section title: "Load balancer".
 * - Options:
 *   - Random: icon dice, raw value `random`.
 *   - Round-robin: icon arrow.triangle.2.circlepath, raw value `counter`.
 *   - Queued Non Distributed: icon line.3.horizontal.decrease, raw value `first`.
 *   - Queued Distributed: icon arrow.clockwise.circle, raw value `available`.
 * - Selecting option sends `hub/balancer/set` with:
 *   - `path`: service name.
 *   - `type`: selected balancer raw value.
 *
 * Permissions:
 * - Reference does not explicitly hide rows or balancer menu by permission here;
 *   caller should still rely on hub API errors if current key cannot update.
 *
 * Data/state needed:
 * - Hub connection status.
 * - Hub status stream with `requests` and `services`.
 * - Local public key.
 *
 * Web port notes:
 * - Use list/table with service name, status dot, count badges, and per-row
 *   overflow menu for balancer.
 * - Keep disconnected state prominent in page title/header.
 *
 * Terminal port notes:
 * - Use table columns: API, status, requests, balancer, running, pending.
 * - Provide command/menu for selected row: `set-balancer random|counter|first|available`.
 * - Copy key can be `key` or toolbar command.
 */
import { Button, CopyButton, HStack, StatusBadge, Table, Text, VStack } from '../terminal'
import type { HubBalancerType } from '../../hub'
import { Card, PageShell, Section, selectedConnection, stateBinding } from './shared'
import type { ClientPage, ClientPageState, ClientServiceRow } from './types'

type ServiceViewRow = ClientServiceRow & {
  id: string
  status: string
  balancerLabel: string
  runningText: string
  pendingText: string
}

const balancerOptions: { label: string; type: HubBalancerType; detail: string }[] = [
  { label: 'Random', type: 'random', detail: 'dice' },
  { label: 'Round-robin', type: 'counter', detail: 'arrow.triangle.2.circlepath' },
  { label: 'Queued Non Distributed', type: 'first', detail: 'line.3.horizontal.decrease' },
  { label: 'Queued Distributed', type: 'available', detail: 'arrow.clockwise.circle' },
]

export const servicesPage: ClientPage = {
  route: 'services',
  title: 'Services',
  render(context) {
    const state = context.state
    const active = selectedConnection(state)
    const rows = serviceRows(state)
    const selected = rows.find(row => row.id === state.selectedServiceId) ?? rows[0]
    const connected = active?.connected || rows.length > 0
    const totalRequests = rows.length > 0
      ? rows.reduce((sum, row) => sum + row.requests, 0)
      : active?.requestCount ?? 0

    return PageShell(this, context, [
      Section('Hub API', [
        HStack([
          StatusBadge(connected ? `${totalRequests} requests` : 'Disconnected', connected ? 'default' : 'danger'),
          StatusBadge(`${rows.length} APIs`, rows.length > 0 ? 'success' : 'muted'),
        ], { spacing: 1 }),
        Text('APIs produced by services live here. Request counts and load balancer settings are shown per API.', { wrap: true }).foregroundColor('secondary'),
        HStack([
          CopyButton('Copy Key', () => state.publicKey ?? '', { disabled: !state.publicKey, copiedLabel: 'Copied' }),
          ...(selected ? [balancerMenuButton(state, selected)] : []),
        ], { spacing: 1 }),
        ...(state.serviceNotice ? [Text(state.serviceNotice).foregroundColor('green')] : []),
      ]),
      Section('Service Rows', rows.length > 0 ? [
        Table(rows, 'id', [
          { header: 'API', width: { flexible: 2, min: 12 }, cell: 'name' },
          { header: 'Status', width: 12, cell: 'status' },
          { header: 'Requests', width: 8, cell: 'requests' },
          { header: 'Balancer', width: { flexible: 1, min: 8 }, cell: 'balancerLabel' },
          { header: 'Running', width: 7, cell: 'runningText' },
          { header: 'Pending', width: 7, cell: 'pendingText' },
        ], {
          selection: stateBinding(state, 'selectedServiceId', selected?.id ?? ''),
          onActivate: row => {
            state.selectedServiceId = row.id
            state.serviceNotice = `${row.name} selected`
          },
        }).frame({ maxWidth: -1 }),
        ...(selected ? [selectedServiceCard(state, selected)] : []),
      ] : emptyServiceRows(connected)),
    ])
  },
}

function serviceRows(state: ClientPageState): ServiceViewRow[] {
  return (state.services ?? []).map((service, index) => {
    const id = service.id ?? service.name
    const status = serviceStatus(service)
    return {
      ...service,
      id: id || `service-${index}`,
      status,
      balancerLabel: balancerLabel(service.balancer),
      runningText: countText(service.running),
      pendingText: countText(service.pending),
    }
  })
}

function emptyServiceRows(connected: boolean) {
  return connected
    ? [
        Text('No service APIs are published yet.').foregroundColor('secondary'),
        Text('Start a Hub service or install storage to populate this list.').foregroundColor('secondary'),
      ]
    : [
        Text('Disconnected.').foregroundColor('red'),
        Text('Connect to a Hub before editing service load balancers.').foregroundColor('secondary'),
      ]
}

function selectedServiceCard(state: ClientPageState, service: ServiceViewRow) {
  const badges = [
    StatusBadge(service.status, service.status === 'online' ? 'success' : service.status === 'unauthorized' ? 'warning' : 'danger'),
    StatusBadge(`${service.requests} requests`, service.requests > 0 ? 'default' : 'muted'),
    StatusBadge(service.balancerLabel, service.balancer && service.balancer !== 'counter' ? 'warning' : 'muted'),
  ]
  return Card(
    `Selected: ${service.name}`,
    [
      HStack([
        Text(`Running ${service.running ?? 0}`),
        Text(`Pending ${service.pending ?? 0}`),
        Text(`Disabled ${service.disabled ?? 0}`),
        ...(service.limit ? [Text(`Limit ${service.limit}`)] : []),
      ], { spacing: 2 }).foregroundColor('secondary'),
      HStack([balancerMenuButton(state, service), activeLimitMenuButton(state, service)], { spacing: 1 }),
    ],
    badges,
  )
}

function balancerMenuButton(state: ClientPageState, service: ServiceViewRow) {
  return Button('Load Balancer', () => {
    state.selectedServiceId = service.id
    state.serviceNotice = `Open ${service.name} balancer menu with Space`
  }).contextMenu(balancerOptions.map(option => ({
    label: `Load balancer: ${option.label}`,
    action: () => setServiceBalancer(state, service, option.type),
  })))
}

function activeLimitMenuButton(state: ClientPageState, service: ServiceViewRow) {
  const limits = [1, 2, 4, 8, 16]
  return Button('Active Limit', () => {
    state.selectedServiceId = service.id
    state.serviceNotice = `Open ${service.name} active limit menu with Space`
  }).contextMenu(limits.map(limit => ({
    label: `Set active request limit: ${limit}`,
    action: () => setServiceLimit(state, service, limit),
  })))
}

function setServiceBalancer(state: ClientPageState, service: ServiceViewRow, type: HubBalancerType): void {
  state.services = (state.services ?? []).map(row => ((row.id ?? row.name) === service.id ? { ...row, balancer: type } : row))
  state.selectedServiceId = service.id
  state.serviceBalancerRequests = [...(state.serviceBalancerRequests ?? []), { path: service.name, type }]
  state.serviceNotice = `${service.name} balancer set to ${balancerLabel(type)}`
}

function setServiceLimit(state: ClientPageState, service: ServiceViewRow, limit: number): void {
  state.services = (state.services ?? []).map(row => ((row.id ?? row.name) === service.id ? { ...row, limit } : row))
  state.selectedServiceId = service.id
  state.serviceNotice = `${service.name} active request limit set to ${limit}`
}

function serviceStatus(service: ClientServiceRow): string {
  if (service.services > 0) return 'online'
  if ((service.disabled ?? 0) > 0) return 'unauthorized'
  return 'offline'
}

function balancerLabel(value: string | undefined): string {
  if (!value || value === 'counter') return 'round-robin'
  if (value === 'random') return 'random'
  if (value === 'first') return 'queued-local'
  if (value === 'available') return 'queued-distributed'
  return value
}

function countText(value: number | undefined): string {
  return value && value > 0 ? String(value) : '-'
}
