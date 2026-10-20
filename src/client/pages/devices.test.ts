import { expect, test } from 'bun:test'
import { DeviceControl, SecurityControl } from '../../hub'
import { macStudio, MockHubClient } from '../../hub/api/test-support'
import { createHubClientView, renderHubClientFrame } from '../index'
import { MemoryTerminalDevice, Terminal } from '../terminal'
import { createClientPageState, type ClientPageState, type ClientRouteId } from './types'

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function plain(terminal: Terminal): string {
  return stripAnsi(terminal.renderToString())
}

type Candidate = { id: string; bounds: { x: number; y: number; width: number; height: number } }

/** Focuses the control whose on-screen bounds show `label`. */
function focusLabel(terminal: Terminal, label: string): void {
  const lines = plain(terminal).split('\n')
  // Smallest first: the navigation's escape handler spans the whole screen.
  const candidates = ((terminal as unknown as { candidates?: Candidate[] }).candidates ?? [])
    .slice()
    .sort((left, right) => left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height)
  for (const candidate of candidates) {
    const { x, y, width, height } = candidate.bounds
    const text = lines.slice(y, y + Math.max(height, 1)).map(line => line.slice(x, x + width)).join(' ')
    if (text.includes(label)) {
      terminal.focus(candidate.id)
      return
    }
  }
  throw new Error(`Could not focus ${label}. Last frame:\n${lines.join('\n')}`)
}

/** Frames flush at most every 100 ms; wait for one so the focus candidates are current. */
const flush = () => Bun.sleep(150)

async function press(client: ReturnType<typeof render>, label: string): Promise<void> {
  await flush()
  focusLabel(client.terminal, label)
  client.device.emitKey({ key: 'enter' })
  await flush()
}

function render(state: Partial<ClientPageState>, path: ClientRouteId[]) {
  const pageState = createClientPageState(state)
  const device = new MemoryTerminalDevice({ width: 120, height: 80 })
  const terminal = new Terminal(device).controls(true)
  terminal.display(createHubClientView(pageState, path))
  return { device, terminal, state: pageState }
}

function liveHub() {
  const client = new MockHubClient()
  client.streamResults.set('hub/devices', [[macStudio]])
  client.streamResults.set('hub/devices/pending', [[{ id: 'p1', key: 'PK', name: 'iPhone', platform: 'ios', safetyCode: '474 971' }]])
  client.streamResults.set('hub/devices/data', [{ cpu: 0.5, battery: 0.3, network: 'cellular', uptime: 12 }])
  return { client, live: { devices: new DeviceControl(client), security: new SecurityControl(client) } }
}

test('devices page lists devices with services, presence, capabilities and pending safety codes', () => {
  const frame = stripAnsi(renderHubClientFrame({
    route: 'devices',
    width: 120,
    height: 60,
    state: {
      devices: [macStudio as never, { ...macStudio, id: 'gone', name: 'Old Phone', revoked: true, online: false, network: undefined, services: [] } as never],
      pendingDevices: [{ id: 'p1', key: 'PK', name: 'iPhone', platform: 'ios', safetyCode: '474 971' }],
    },
  }))
  expect(frame).toContain('Hub Client / Devices')
  expect(frame).toContain('1/2 online')
  expect(frame).toContain('Safety code 474 971')
  expect(frame).toContain('Mac Studio')
  expect(frame).toContain('online, net online')
  expect(frame).toContain('revoked')
  expect(frame).toContain('1/2')
  expect(frame).toContain('M3 Ultra 24 cores')
  expect(frame).toContain('s3-local/Backup Disk (Backup Disk) / 2 paths')
})

test('devices page streams from the hub and approves a pending device', async () => {
  const { client, live } = liveHub()
  const view = render({ live }, ['devices'])
  await flush()
  expect(plain(view.terminal)).toContain('Safety code 474 971')
  expect(plain(view.terminal)).toContain('Mac Studio')

  await press(view, 'Approve')
  await flush()
  expect(client.sends).toEqual([{ path: 'hub/device/approve', body: { id: 'p1' } }])
  expect(plain(view.terminal)).toContain('iPhone approved')
  view.terminal.stop()
})

test('device page shows live data and revokes while keeping chosen service keys', async () => {
  const { client, live } = liveHub()
  const view = render({ live, devices: [macStudio as never], selectedDeviceId: macStudio.id }, ['devices', 'devices/detail'])
  await flush()
  const frame = plain(view.terminal)
  expect(frame).toContain('Hub Client / Device')
  expect(frame).toContain('CPU 50% / Battery 30% / Network cellular')
  expect(frame).toContain('uptime: 12')
  expect(frame).toContain('Simulators iPhone 18 Pro')
  expect(client.streams.at(-1)).toEqual({ path: 'hub/devices/data', body: { id: macStudio.id } })

  await press(view, 'Revoke…')
  expect(plain(view.terminal)).toContain('Cannot be undone')
  await press(view, 's3-local/Backup Disk')
  await press(view, 'Confirm Revoke')
  await flush()
  expect(client.sends).toEqual([{ path: 'hub/device/revoke', body: { id: macStudio.id, keepServices: ['S3KEY'] } }])
  expect(plain(view.terminal)).toContain('Mac Studio revoked with 1 service key, kept 1')
  view.terminal.stop()
})

test('device page renames and removes', async () => {
  const { client, live } = liveHub()
  const view = render({ live, devices: [macStudio as never], selectedDeviceId: macStudio.id, deviceNameDraft: 'Studio' }, ['devices', 'devices/detail'])
  await press(view, 'Rename')
  await flush()
  await press(view, 'Remove')
  await flush()
  expect(client.sends).toEqual([
    { path: 'hub/device/rename', body: { id: macStudio.id, name: 'Studio' } },
    { path: 'hub/device/remove', body: { id: macStudio.id } },
  ])
  view.terminal.stop()
})

test('device pages work without a hub and say so', () => {
  const frame = stripAnsi(renderHubClientFrame({ route: 'devices' }))
  expect(frame).toContain('Not connected')
  expect(frame).toContain('No devices yet')
  expect(stripAnsi(renderHubClientFrame({ route: 'devices/detail' }))).toContain('No device selected')
  expect(createClientPageState().devices).toEqual([])
})
