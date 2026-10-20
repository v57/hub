/**
 * Page spec: Devices.
 *
 * Source reference:
 * - `Docs/Devices/device-layer.md` sections 5-7, `Docs/Devices/protocol.md` section 6.
 *
 * How user gets here:
 * - Home -> Hub Pages -> "Devices".
 * - `hub client devices`.
 *
 * What page displays:
 * - Summary badges: online devices of total, pending approvals.
 * - Pending Approval: one card per `hub/devices/pending` item with its name,
 *   platform, declared parent, first seen time and safety code. The safety code
 *   is shown on the device too; the owner compares both before approving.
 * - Devices: table of `hub/devices` with name, platform, presence (hub presence
 *   and, when known, Hub Network presence), service count and a capability
 *   summary. Revoked devices stay listed as tombstones.
 * - Selected device card: its services (instance, name, online, path count) and
 *   a link to the device page (rename, remove, revoke, live data).
 *
 * Actions:
 * - "Approve" sends `hub/device/approve { id }` (owners only).
 * - Selecting a row selects the device for `devices/detail`.
 *
 * Data/state needed:
 * - `hub/devices` stream (owners and granted groups).
 * - `hub/devices/pending` stream (owners); other callers see no pending list.
 *
 * Terminal port notes:
 * - The CLI itself is a client without a device unless started with
 *   `--device`, so it never appears here unless asked to.
 * - Streams run only while the page is visible.
 */
import { deviceCapabilitySummary, type HubDevice, type HubPendingDevice } from '../../hub'
import { Button, HStack, StatusBadge, Table, Text } from '../terminal'
import { errorMessage, runAction, watchInto } from './live'
import { Card, PageShell, RouteLink, Section, stateBinding } from './shared'
import type { ClientPage, ClientPageState } from './types'

type DeviceRow = HubDevice & {
  platformText: string
  presenceText: string
  servicesText: string
  capabilityText: string
}

export const devicesPage: ClientPage = {
  route: 'devices',
  title: 'Devices',
  render(context) {
    const state = context.state
    const rows = deviceRows(state.devices ?? [])
    const pending = state.pendingDevices ?? []
    const selected = rows.find(row => row.id === state.selectedDeviceId) ?? rows[0]
    const online = rows.filter(row => row.online).length

    return PageShell(this, context, [
      Section('Devices', [
        HStack([
          StatusBadge(`${online}/${rows.length} online`, online > 0 ? 'success' : 'muted'),
          StatusBadge(`${pending.length} pending`, pending.length > 0 ? 'warning' : 'muted'),
          ...(state.live ? [] : [StatusBadge('Not connected', 'muted')]),
        ], { spacing: 1 }),
        Text('A device is one OS instance with its own key. Services certified by it are listed under it.', { wrap: true }).foregroundColor('secondary'),
        ...(state.deviceNotice ? [Text(state.deviceNotice).foregroundColor(state.deviceNotice.startsWith('Failed') ? 'red' : 'green')] : []),
      ]),
      Section('Pending Approval', pending.length > 0
        ? pending.map(device => pendingCard(state, device))
        : [Text('No devices waiting for approval.').foregroundColor('secondary')]),
      Section('All Devices', rows.length > 0 ? [
        Table(rows, 'id', [
          { header: 'Name', width: { flexible: 1, min: 12 }, cell: 'name' },
          { header: 'Platform', width: 10, cell: 'platformText' },
          { header: 'Presence', width: 16, cell: 'presenceText' },
          { header: 'Services', width: 8, cell: 'servicesText' },
          { header: 'Capabilities', width: { flexible: 2, min: 16 }, cell: 'capabilityText' },
        ], {
          selection: stateBinding(state, 'selectedDeviceId', selected?.id ?? ''),
          onActivate: row => selectDevice(state, row.id),
        }).frame({ maxWidth: -1 }),
        ...(selected ? [selectedDeviceCard(state, selected)] : []),
      ] : [
        Text('No devices yet. Services that run with a device key show up here.').foregroundColor('secondary'),
      ]),
    ]).task(state.live ? 'devices-live' : 'devices-offline', async task => {
      const live = state.live
      if (!live) return
      await Promise.all([
        watchInto(state, task, live.devices.watchDevices(), devices => {
          state.devices = devices
        }, error => {
          state.deviceNotice = `Failed to load devices: ${errorMessage(error)}`
        }),
        // Only owners can list pending devices; others just don't see the section filled.
        watchInto(state, task, live.devices.watchPending(), devices => {
          state.pendingDevices = devices
        }),
      ])
    })
  },
}

function pendingCard(state: ClientPageState, device: HubPendingDevice) {
  const details = [device.platform, device.parent ? `in ${device.parent}` : undefined, device.firstSeen ? `first seen ${device.firstSeen}` : undefined]
  return Card(device.name || 'Unnamed device', [
    Text(details.filter(Boolean).join(' / ') || device.id).foregroundColor('secondary'),
    Text(`Safety code ${device.safetyCode || '-'}`).fontWeight('bold'),
    Text('Approve only if the device shows the same code.').foregroundColor('secondary'),
    HStack([
      Button('Approve', () => approveDevice(state, device), { disabled: !state.live }),
    ], { spacing: 1 }),
  ], [StatusBadge('Pending', 'warning')])
}

function selectedDeviceCard(state: ClientPageState, device: DeviceRow) {
  const services = device.services
  return Card(`Selected: ${device.name}`, [
    ...(services.length > 0
      ? services.map(service => Text(
          `${service.online ? '●' : '○'} ${service.instance || service.name || keySuffix(service.key)}`
            + `${service.name && service.instance ? ` (${service.name})` : ''} / ${service.paths.length} paths`,
        ).foregroundColor(service.online ? 'primary' : 'secondary'))
      : [Text('No services on this device.').foregroundColor('secondary')]),
    HStack([
      RouteLink('Open', 'devices/detail', 'Rename, remove or revoke the device and see its live data.'),
    ], { spacing: 1 }),
  ], [
    StatusBadge(device.presenceText, device.revoked ? 'danger' : device.online ? 'success' : 'muted'),
    ...(!device.approved && !device.revoked ? [StatusBadge('Not approved', 'warning')] : []),
  ])
}

export function deviceRows(devices: HubDevice[]): DeviceRow[] {
  return devices.map(device => ({
    ...device,
    platformText: device.platform ?? '-',
    presenceText: presenceText(device),
    servicesText: `${device.services.filter(service => service.online).length}/${device.services.length}`,
    capabilityText: deviceCapabilitySummary(device.capabilities),
  }))
}

export function presenceText(device: HubDevice): string {
  if (device.revoked) return 'revoked'
  const hub = device.online ? 'online' : 'offline'
  return device.network ? `${hub}, net ${device.network}` : hub
}

function selectDevice(state: ClientPageState, id: string): void {
  state.selectedDeviceId = id
  state.deviceNameDraft = ''
  state.deviceRevokeArmed = false
  state.deviceKeepServices = []
}

function approveDevice(state: ClientPageState, device: HubPendingDevice): void {
  const live = state.live
  if (!live) return
  const name = device.name || device.id
  runAction(state, message => (state.deviceNotice = message), () => live.devices.approve(device.id), `${name} approved`, () => {
    state.pendingDevices = (state.pendingDevices ?? []).filter(item => item.id !== device.id)
  })
}

function keySuffix(key: string): string {
  return key.length > 8 ? key.slice(-8) : key
}
