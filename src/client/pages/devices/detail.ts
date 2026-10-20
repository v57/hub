/**
 * Page spec: Device.
 *
 * Source reference:
 * - `Docs/Devices/device-layer.md` sections 7-8, `Docs/Devices/protocol.md` sections 6 and 8.
 *
 * How user gets here:
 * - Devices -> select a device -> "Open".
 *
 * What page displays:
 * - Device facts: name, id, key, platform / OS / architecture, declared parent,
 *   approval, hub presence, Hub Network presence and last seen time.
 * - Capabilities (claims by the device; they steer placement and never grant
 *   access): CPU, memory, GPU, disks, power, tools, SSH.
 * - Services certified by the device with instance, name, presence and paths.
 * - Live Data from `hub/devices/data { id }`: CPU, memory, battery, charging,
 *   network and thermal state, plus any other keys the reporter sends.
 *
 * Actions (owners):
 * - Rename: `hub/device/rename { id, name }`; the hub's name wins over the
 *   name the device suggests from then on.
 * - Remove: `hub/device/remove { id }`. Closes its connections and removes its
 *   grants and group memberships; it can enrol again as pending.
 * - Revoke: two steps. "Revoke…" arms it and shows one toggle per service:
 *   checked services keep their keys (`keepServices`), for keys known to be
 *   safe elsewhere. "Confirm Revoke" sends `hub/device/revoke { id,
 *   keepServices }`: the device is tombstoned and every other service key on
 *   it is revoked.
 *
 * Data/state needed:
 * - Selected device id and `hub/devices` (from the Devices page).
 * - `hub/devices/data` stream while the page is visible.
 */
import { deviceCapabilitySummary, deviceDataSummary, formatBytes, type HubDevice, type HubDeviceData } from '../../../hub'
import { Button, HStack, StatusBadge, Table, Text, TextField, Toggle, type Binding, type ViewNode } from '../../terminal'
import { presenceText } from '../devices'
import { errorMessage, runAction, watchInto } from '../live'
import { Card, PageShell, Section, stateBinding } from '../shared'
import type { ClientPage, ClientPageState } from '../types'

export const deviceDetailPage: ClientPage = {
  route: 'devices/detail',
  title: 'Device',
  render(context) {
    const state = context.state
    const device = selectedDevice(state)
    if (!device) {
      return PageShell(this, context, [
        Section('Device', [Text('No device selected. Choose one on the Devices page.').foregroundColor('secondary')]),
      ])
    }
    const data = state.deviceData?.[device.id]

    return PageShell(this, context, [
      Section(device.name, [
        HStack([
          StatusBadge(presenceText(device), device.revoked ? 'danger' : device.online ? 'success' : 'muted'),
          StatusBadge(device.approved ? 'Approved' : 'Not approved', device.approved ? 'success' : 'warning'),
        ], { spacing: 1 }),
        ...factRows(device).map(([label, value]) => Text(`${label.padEnd(10)} ${value}`).foregroundColor('secondary')),
        ...(state.deviceNotice ? [Text(state.deviceNotice).foregroundColor(state.deviceNotice.startsWith('Failed') ? 'red' : 'green')] : []),
      ]),
      Section('Capabilities', capabilityRows(device)),
      Section('Services', device.services.length > 0 ? [
        Table(device.services.map(service => ({
          ...service,
          instanceText: service.instance || '-',
          nameText: service.name ?? '-',
          presence: service.online ? 'online' : 'offline',
          pathText: service.paths.length > 0 ? service.paths.join(', ') : '-',
        })), 'key', [
          { header: 'Instance', width: { flexible: 1, min: 12 }, cell: 'instanceText' },
          { header: 'Name', width: { flexible: 1, min: 10 }, cell: 'nameText' },
          { header: 'Presence', width: 8, cell: 'presence' },
          { header: 'Paths', width: { flexible: 2, min: 16 }, cell: 'pathText' },
        ]).frame({ maxWidth: -1 }),
      ] : [Text('No services on this device.').foregroundColor('secondary')]),
      Section('Live Data', liveDataRows(data)),
      Section('Manage', manageRows(state, device)),
    ]).task(state.live ? `device-data:${device.id}` : 'device-data-offline', async task => {
      const live = state.live
      if (!live || device.revoked) return
      await watchInto(state, task, live.devices.watchData(device.id), value => {
        state.deviceData = { ...state.deviceData, [device.id]: value }
      }, error => {
        state.deviceNotice = `Failed to load live data: ${errorMessage(error)}`
      })
    })
  },
}

function selectedDevice(state: ClientPageState): HubDevice | undefined {
  const devices = state.devices ?? []
  return devices.find(device => device.id === state.selectedDeviceId) ?? devices[0]
}

function factRows(device: HubDevice): [string, string][] {
  const system = [device.platform, device.os, device.arch].filter(Boolean).join(' / ')
  return [
    ['Id', device.id],
    ['Key', device.key || '-'],
    ['System', system || '-'],
    ...(device.parent ? [['Parent', device.parent] as [string, string]] : []),
    ['Network', device.network ?? 'not a member'],
    ['Last seen', device.lastSeen ?? '-'],
  ]
}

function capabilityRows(device: HubDevice): ViewNode[] {
  const capabilities = device.capabilities
  if (!capabilities) return [Text('The device has not described itself yet.').foregroundColor('secondary')]
  const rows: string[] = [deviceCapabilitySummary(capabilities)]
  for (const disk of capabilities.disks ?? []) {
    const sizes = [disk.free !== undefined ? `${formatBytes(disk.free)} free` : undefined, disk.total !== undefined ? `of ${formatBytes(disk.total)}` : undefined]
    rows.push(`Disk ${disk.name} ${sizes.filter(Boolean).join(' ')}`.trim())
  }
  if (capabilities.tools?.simulators?.length) rows.push(`Simulators ${capabilities.tools.simulators.join(', ')}`)
  if (capabilities.ssh) rows.push(`SSH ${capabilities.ssh.user ? `${capabilities.ssh.user}@` : ''}:${capabilities.ssh.port} ${capabilities.ssh.hostKey}`)
  return [
    ...rows.map(row => Text(row, { wrap: true })),
    Text('Capabilities are claims by the device. They steer placement and never grant access.', { wrap: true }).foregroundColor('secondary'),
  ]
}

function liveDataRows(data: HubDeviceData | undefined): ViewNode[] {
  if (!data) return [Text('Waiting for the device reporter...').foregroundColor('secondary')]
  const known = new Set(['cpu', 'memoryUsed', 'battery', 'charging', 'network', 'thermal'])
  const extra = Object.entries(data).filter(([key]) => !known.has(key))
  return [
    Text(deviceDataSummary(data)),
    ...extra.map(([key, value]) => Text(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).foregroundColor('secondary')),
  ]
}

function manageRows(state: ClientPageState, device: HubDevice): ViewNode[] {
  if (device.revoked) return [Text('Revoked. The key stays tombstoned and cannot be approved again.').foregroundColor('secondary')]
  const disabled = !state.live
  const name = (state.deviceNameDraft ?? '').trim()
  const rows: ViewNode[] = [
    HStack([
      TextField(stateBinding(state, 'deviceNameDraft', ''), { placeholder: device.name }).frame({ maxWidth: -1 }),
      Button('Rename', () => renameDevice(state, device, name), { disabled: disabled || !name || name === device.name }),
    ], { spacing: 1 }),
    HStack([
      Button('Remove', () => removeDevice(state, device), { disabled, role: 'destructive' }),
      Button(state.deviceRevokeArmed ? 'Cancel Revoke' : 'Revoke…', () => {
        state.deviceRevokeArmed = !state.deviceRevokeArmed
        state.deviceKeepServices = []
      }, { disabled, role: state.deviceRevokeArmed ? 'cancel' : 'destructive' }),
    ], { spacing: 1 }),
    Text('Remove detaches it; it can enrol again. Revoke is for a lost device: it also revokes its service keys.', { wrap: true }).foregroundColor('secondary'),
  ]
  if (state.deviceRevokeArmed) {
    rows.push(Card('Revoke', [
      Text(device.services.length > 0 ? 'Keep these service keys (known to be safe elsewhere):' : 'No service keys to keep.').foregroundColor('secondary'),
      ...device.services.map(service => Toggle(service.instance || service.name || service.key, keepBinding(state, service.key))),
      Button('Confirm Revoke', () => revokeDevice(state, device), { disabled, role: 'destructive' }),
    ], [StatusBadge('Cannot be undone', 'danger')]))
  }
  return rows
}

function keepBinding(state: ClientPageState, key: string): Binding<boolean> {
  return {
    get: () => (state.deviceKeepServices ?? []).includes(key),
    set(value) {
      const keep = new Set(state.deviceKeepServices ?? [])
      if (value) keep.add(key)
      else keep.delete(key)
      state.deviceKeepServices = [...keep]
    },
  }
}

function renameDevice(state: ClientPageState, device: HubDevice, name: string): void {
  const live = state.live
  if (!live || !name) return
  runAction(state, message => (state.deviceNotice = message), () => live.devices.rename(device.id, name), `Renamed to ${name}`, () => {
    state.devices = (state.devices ?? []).map(item => (item.id === device.id ? { ...item, name } : item))
    state.deviceNameDraft = ''
  })
}

function removeDevice(state: ClientPageState, device: HubDevice): void {
  const live = state.live
  if (!live) return
  runAction(state, message => (state.deviceNotice = message), () => live.devices.remove(device.id), `${device.name} removed`, () => {
    state.devices = (state.devices ?? []).filter(item => item.id !== device.id)
  })
}

function revokeDevice(state: ClientPageState, device: HubDevice): void {
  const live = state.live
  if (!live) return
  const keep = (state.deviceKeepServices ?? []).filter(key => device.services.some(service => service.key === key))
  const revoked = device.services.length - keep.length
  runAction(state, message => (state.deviceNotice = message), () => live.devices.revoke(device.id, keep),
    `${device.name} revoked with ${revoked} service key${revoked === 1 ? '' : 's'}${keep.length > 0 ? `, kept ${keep.length}` : ''}`, () => {
      state.devices = (state.devices ?? []).map(item => (item.id === device.id ? { ...item, revoked: true, online: false } : item))
      state.deviceRevokeArmed = false
      state.deviceKeepServices = []
    })
}
