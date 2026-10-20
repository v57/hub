import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vectors from './auth/testdata/device-vectors.json'
import { decodeServiceCertificate, DeviceIdentity } from './auth/device-key'
import { BunFileHubKeyStore, hubKeyAddress, MemoryHubKeyStore } from './auth/hub-key-store'
import { MemoryKeyStore } from './auth/memory-key-store'
import { HubClient, type HubConnectionHeaders, type HubSenderLike, type HubServiceOptions } from './client'

const { keys } = vectors

/** Records connect headers and lets the test run `onConnect` against a fake hub. */
function fakeHub(answer: (path: string) => unknown) {
  const connects: HubConnectionHeaders[] = []
  let headers: (() => Promise<HubConnectionHeaders>) | undefined
  let options: HubServiceOptions | undefined
  const sender: HubSenderLike = {
    async send(path) {
      const value = answer(path)
      if (value instanceof Error) throw value
      return value
    },
    async *values() {},
  }
  return {
    connects,
    factory(nextHeaders: () => Promise<HubConnectionHeaders>, nextOptions: HubServiceOptions) {
      headers = nextHeaders
      options = nextOptions
      return { sender, start() {} }
    },
    async connect() {
      connects.push(await headers!())
      await options!.onConnect?.(sender)
    },
  }
}

function hubInfo(path: string) {
  return path === 'hub/info' ? { key: keys.hub.publicKey, protocol: 1, pro: true, mode: 'default-deny' } : undefined
}

test('client connects with v0, learns the hub key, then signs v1 for that hub', async () => {
  const hub = fakeHub(hubInfo)
  const hubKeys = new MemoryHubKeyStore()
  const client = new HubClient({ address: 1997, keyStore: new MemoryKeyStore(keys.service.keyFile), hubKeys, serviceFactory: hub.factory })
  client.start()

  await hub.connect()
  expect(hub.connects[0]!.v).toBe('0')
  expect(await hubKeys.get('ws://localhost:1997')).toBe(keys.hub.publicKey)
  expect(client.info?.mode).toBe('default-deny')

  await hub.connect()
  expect(hub.connects[1]!.v).toBe('1')
  expect(hub.connects[1]!.auth?.startsWith(`key.${keys.service.publicKey}.`)).toBe(true)
  expect(hub.connects[1]!.device).toBeUndefined()
})

test('a pinned hub key is not replaced by a different hub answering at the address', async () => {
  const hub = fakeHub(path => (path === 'hub/info' ? { key: keys.device.publicKey, protocol: 1 } : undefined))
  const hubKeys = new MemoryHubKeyStore({ 'ws://localhost:1997': keys.hub.publicKey })
  const client = new HubClient({ address: 1997, keyStore: new MemoryKeyStore(keys.service.keyFile), hubKeys, serviceFactory: hub.factory })
  client.start()
  await hub.connect()
  expect(hub.connects[0]!.v).toBe('1')
  expect(await hubKeys.get(1997)).toBe(keys.hub.publicKey)
})

test('hubs without hub/info keep v0', async () => {
  const hub = fakeHub(path => (path === 'hub/info' ? new Error('api not found') : undefined))
  const hubKeys = new MemoryHubKeyStore()
  const client = new HubClient({ address: 1997, keyStore: new MemoryKeyStore(keys.service.keyFile), hubKeys, serviceFactory: hub.factory })
  client.start()
  await hub.connect()
  await hub.connect()
  expect(hub.connects.map(headers => headers.v)).toEqual(['0', '0'])
  expect(await hubKeys.list()).toEqual({})
})

test('a supplied hub key is pinned and used from the first connect; forget clears it', async () => {
  const hub = fakeHub(hubInfo)
  const hubKeys = new MemoryHubKeyStore()
  const client = new HubClient({
    address: 'ws://hub.test:1997',
    keyStore: new MemoryKeyStore(keys.service.keyFile),
    hubKeys,
    hubKey: keys.hub.publicKey,
    serviceFactory: hub.factory,
  })
  client.start()
  await hub.connect()
  expect(hub.connects[0]!.v).toBe('1')
  expect(await client.forgetHubKey()).toBe(true)
  expect(await hubKeys.get('ws://hub.test:1997')).toBeUndefined()
})

test('device mode adds a certificate for the client key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-client-'))
  try {
    const hub = fakeHub(hubInfo)
    const device = new DeviceIdentity({ path: join(directory, 'device.key'), instance: 'hub-cli' })
    const client = new HubClient({ address: 1997, keyStore: new MemoryKeyStore(keys.service.keyFile), device, serviceFactory: hub.factory })
    client.start()
    await hub.connect()
    const certificate = decodeServiceCertificate(hub.connects[0]!.device!)
    expect(certificate?.service).toBe(keys.service.publicKey)
    expect(certificate?.device).toBe(await device.publicKey())
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('pin keys are the dialed URL normalized like channel TS', () => {
  expect(hubKeyAddress(1997)).toBe('ws://localhost:1997')
  expect(hubKeyAddress('1997')).toBe('ws://localhost:1997')
  expect(hubKeyAddress('WSS://Hub.Example.COM/Path/')).toBe('wss://hub.example.com/Path')
  expect(hubKeyAddress('ws://hub.local:1997/')).toBe('ws://hub.local:1997')
})

test('file hub key store keeps pins per normalized address', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-pins-'))
  try {
    const path = join(directory, 'hubs.json')
    const store = new BunFileHubKeyStore({ path })
    await store.pin('1997', keys.hub.publicKey)
    expect(await Bun.file(path).json()).toEqual({ 'ws://localhost:1997': keys.hub.publicKey })
    expect(await new BunFileHubKeyStore({ path }).get(1997)).toBe(keys.hub.publicKey)
    expect(await store.forget('ws://localhost:1997')).toBe(true)
    expect(await store.forget('ws://localhost:1997')).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the default service sends v0 then v1 headers to a real channel server', async () => {
  // A string specifier keeps tsc out of channel's server sources, which don't typecheck against current bun-types.
  const channelServer: string = 'channel/server'
  const { Channel } = await import(channelServer)
  const seen: Record<string, string | undefined>[] = []
  const server = new Channel()
    .post('hub/info', () => ({ key: keys.hub.publicKey, protocol: 1, pro: true, mode: 'default-allow' }))
    .post('hub/service/update', () => {})
    .listen(0, {
      state(headers: Record<string, string | undefined>) {
        seen.push({ v: headers.v, auth: headers.auth })
        return {}
      },
    })
  const hubKeys = new MemoryHubKeyStore()
  const client = new HubClient({ address: `ws://localhost:${server.port}`, keyStore: new MemoryKeyStore(keys.service.keyFile), hubKeys })
  try {
    expect(await client.send('hub/info')).toMatchObject({ key: keys.hub.publicKey })
    for (let attempt = 0; attempt < 50 && !(await hubKeys.get(client.address)); attempt += 1) await Bun.sleep(10)
    expect(await client.hubKey()).toBe(keys.hub.publicKey)
    expect(seen[0]?.v).toBe('0')
    expect((await client.connectHeaders()).v).toBe('1')
  } finally {
    client.stop()
    server.stop(true)
  }
})

test('a refused hub-bound token is reported, not retried as v0', async () => {
  const versions: (string | null)[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      versions.push(request.headers.get('v'))
      return new Response('invalid signature', { status: 401 })
    },
    websocket: { message() {} },
  })
  const address = `ws://localhost:${server.port}`
  const client = new HubClient({
    address,
    keyStore: new MemoryKeyStore(keys.service.keyFile),
    hubKeys: new MemoryHubKeyStore({ [address]: keys.hub.publicKey }),
  })
  try {
    const error = await client.send('hub/info').then(() => undefined, error => error)
    expect(error).toMatchObject({ name: 'HubError', kind: 'auth', path: 'hub/info' })
    expect(error.hint).toContain('hubkey forget')
    const iterator = client.values('hub/devices')[Symbol.asyncIterator]()
    expect(await iterator.next().then(() => undefined, error => error.kind)).toBe('auth')
    expect(versions.every(version => version === '1')).toBe(true)
  } finally {
    client.stop()
    server.stop(true)
  }
})
