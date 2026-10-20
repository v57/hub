import { expect, test } from 'bun:test'
import { DeviceControl, SecurityControl } from '../../hub'
import { macStudio, MockHubClient } from '../../hub/api/test-support'
import { renderHubClientFrame } from '../index'
import { createClientPageState } from './types'
import { flush, plain, press, render, stripAnsi } from './test-support'

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
