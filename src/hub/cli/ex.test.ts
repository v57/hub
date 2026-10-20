import { expect, test } from 'bun:test'
import { DeviceIdentity, MemoryConnectionStore, MemoryHubKeyStore, MemoryKeyStore, type HubRuntimeClient } from '../index'
import { parseExArguments, runExCommand } from './ex'

function recordingClient(answer: (path: string, body: unknown) => unknown = () => 'ok') {
  const calls: { path: string; body: unknown }[] = []
  const client: HubRuntimeClient = {
    connected: true,
    async send<T>(path: string, body?: unknown) {
      calls.push({ path, body })
      return answer(path, body) as T
    },
    async *values<T>(path: string, body?: unknown) {
      calls.push({ path, body })
      yield answer(path, body) as T
    },
    stop() {},
  }
  return { client, calls }
}

test('the CLI is a key-only client unless --device is passed', async () => {
  expect(parseExArguments(['status']).options.device).toBe(false)
  expect(parseExArguments(['status', '--device']).options.device).toBe(true)

  const device = new DeviceIdentity({ path: '/nonexistent/device.key' })
  const seen: (DeviceIdentity | undefined)[] = []
  const env = {
    connections: new MemoryConnectionStore(),
    keyStore: new MemoryKeyStore(),
    hubKeys: new MemoryHubKeyStore(),
    device,
    log: () => {},
    createClient(options: { device?: DeviceIdentity }) {
      seen.push(options.device)
      return recordingClient().client
    },
  }
  await runExCommand(['info'], env)
  await runExCommand(['info', '--device'], env)
  expect(seen).toEqual([undefined, device])
})

test('hubkey prints and forgets the pin of the selected hub', async () => {
  const lines: string[] = []
  const connections = new MemoryConnectionStore()
  await connections.add('1997', 'Local')
  const hubKeys = new MemoryHubKeyStore({ 'ws://localhost:1997': 'HUBKEY' })
  const env = { connections, hubKeys, keyStore: new MemoryKeyStore(), log: (line: string) => lines.push(line) }
  await runExCommand(['hubkey'], env)
  await runExCommand(['hubkey', 'forget', '--json'], env)
  await runExCommand(['hubkey'], env)
  expect(lines).toEqual(['HUBKEY', '{"forgotten":true}', 'not pinned'])
})

test('device commands send the device API payloads', async () => {
  const { client, calls } = recordingClient(path => (path === 'hub/devices' ? [{ id: 'd1', name: 'Mac' }] : undefined))
  const lines: string[] = []
  const env = {
    connections: new MemoryConnectionStore(),
    keyStore: new MemoryKeyStore(),
    hubKeys: new MemoryHubKeyStore(),
    log: (line: string) => lines.push(line),
    createClient: () => client,
  }
  await runExCommand(['devices', '--json'], env)
  await runExCommand(['device', 'approve', 'd1'], env)
  await runExCommand(['device', 'rename', 'd1', 'Mac', 'Studio'], env)
  await runExCommand(['device', 'remove', 'd1'], env)
  await expect(runExCommand(['device', 'revoke', 'd1'], env)).rejects.toThrow('--yes')
  await runExCommand(['device', 'revoke', 'd1', '--yes', '--keep', 'K1', '--keep', 'K2'], env)
  expect(JSON.parse(lines[0]!)[0]).toMatchObject({ id: 'd1', name: 'Mac', approved: false })
  expect(calls.slice(1)).toEqual([
    { path: 'hub/device/approve', body: { id: 'd1' } },
    { path: 'hub/device/rename', body: { id: 'd1', name: 'Mac Studio' } },
    { path: 'hub/device/remove', body: { id: 'd1' } },
    { path: 'hub/device/revoke', body: { id: 'd1', keepServices: ['K1', 'K2'] } },
  ])
})
