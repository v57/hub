import { expect, test } from 'bun:test'
import {
  deviceCapabilitySummary,
  deviceDataSummary,
  DeviceControl,
  normalizeDevices,
  normalizePendingDevices,
} from './device-control'
import { macStudio, MockHubClient } from './test-support'

test('DeviceControl streams devices and sends exact device payloads', async () => {
  const client = new MockHubClient()
  client.streamResults.set('hub/devices', [[{ ...macStudio, online: false, name: 'B' }, macStudio, { name: 'no id' }]])
  client.streamResults.set('hub/devices/pending', [[{ id: 'p1', key: 'PK', safetyCode: '474 971', firstSeen: '2026-10-20T09:00:00Z' }]])
  client.streamResults.set('hub/devices/data', [{ cpu: 0.25, battery: 0.8, charging: true, network: 'wifi' }])
  client.sendResults.set('hub/device/approve', { ...macStudio, id: 'p1' })
  const devices = new DeviceControl(client)

  const list = await devices.devices()
  expect(list.map(device => device.name)).toEqual(['Mac Studio', 'B'])
  expect(list[0]!.services[0]).toEqual(macStudio.services[0]!)
  expect(await devices.pending()).toEqual([{ id: 'p1', key: 'PK', safetyCode: '474 971', firstSeen: '2026-10-20T09:00:00Z' }])
  expect((await devices.approve('p1'))?.id).toBe('p1')
  await devices.rename('p1', 'Studio')
  await devices.remove('p1')
  await devices.revoke('p1')
  await devices.revoke('p1', ['S3KEY'])
  expect(await devices.data('p1')).toEqual({ cpu: 0.25, battery: 0.8, charging: true, network: 'wifi' })

  expect(client.sends).toEqual([
    { path: 'hub/device/approve', body: { id: 'p1' } },
    { path: 'hub/device/rename', body: { id: 'p1', name: 'Studio' } },
    { path: 'hub/device/remove', body: { id: 'p1' } },
    { path: 'hub/device/revoke', body: { id: 'p1' } },
    { path: 'hub/device/revoke', body: { id: 'p1', keepServices: ['S3KEY'] } },
  ])
  expect(client.streams.at(-1)).toEqual({ path: 'hub/devices/data', body: { id: 'p1' } })
})

test('device normalizers tolerate partial records', () => {
  expect(normalizeDevices(null)).toEqual([])
  expect(normalizeDevices([macStudio])[0]!.overlay).toEqual(macStudio.overlay)
  expect(normalizeDevices([{ id: 'x', overlay: { authority: 'a' } }])[0]!.overlay).toBeUndefined()
  expect(normalizeDevices([{ id: 'x' }])[0]).toMatchObject({ id: 'x', name: 'x', approved: false, revoked: false, online: false, services: [] })
  expect(normalizePendingDevices({ devices: [{ id: 'b', firstSeen: '2' }, { id: 'a', firstSeen: '1' }] }).map(device => device.id)).toEqual(['a', 'b'])
})

test('device summaries describe capabilities and live data in one line', () => {
  expect(deviceCapabilitySummary(macStudio.capabilities as never)).toBe(
    'M3 Ultra 24 cores / 64 GB RAM / Backup Disk 1.1 TB free / AC power / xcode 27.0, docker, 1 simulators',
  )
  expect(deviceCapabilitySummary(undefined)).toBe('-')
  expect(deviceDataSummary({ cpu: 0.25, memoryUsed: 8 * 1024 ** 3, battery: 0.8, charging: true, network: 'wifi' })).toBe(
    'CPU 25% / Memory 8.0 GB / Battery 80% charging / Network wifi',
  )
  expect(deviceDataSummary({})).toBe('No live data')
})
