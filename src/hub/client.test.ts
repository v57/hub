import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signHubData } from './auth/key-material'
import vectors from './auth/testdata/device-vectors.json'
import { decodeServiceCertificate, DeviceIdentity } from './auth/device-key'
import { BunFileHubKeyStore, hubKeyAddress, MemoryHubKeyStore } from './auth/hub-key-store'
import { MemoryKeyStore } from './auth/memory-key-store'
import { HubClient, type HubConnectionHeaders, type HubSenderLike, type HubServiceOptions } from './client'

const { keys } = vectors

/** Records connect headers and lets the test run `onConnect` against a fake hub. */
function fakeHub(answer: (path: string) => unknown = () => undefined) {
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

/** `hub/info` from the vectors' hub: it holds the key it claims, so its proof holds. */
async function provenInfo(_address: string, nonce: string, claimKey = keys.hub.publicKey) {
  const proof = await signHubData(keys.hub.keyFile, `hubinfo1:${claimKey}:${nonce}`)
  return { key: claimKey, protocol: 2, pro: true, mode: 'default-deny', challenge: 'challenge', proof }
}

test('client asks the hub to prove its key, pins it, and signs v1 over the challenge', async () => {
  const hub = fakeHub()
  const hubKeys = new MemoryHubKeyStore()
  const client = new HubClient({
    address: 1997,
    keyStore: new MemoryKeyStore(keys.service.keyFile),
    hubKeys,
    serviceFactory: hub.factory,
    askHubInfo: provenInfo,
  })
  client.start()

  await hub.connect()
  expect(hub.connects[0]!.v).toBe('1')
  expect(hub.connects[0]!.auth?.startsWith(`key.${keys.service.publicKey}.`)).toBe(true)
  expect(hub.connects[0]!.auth?.endsWith('.challenge')).toBe(true)
  expect(hub.connects[0]!.device).toBeUndefined()
  expect(await hubKeys.get('ws://localhost:1997')).toBe(keys.hub.publicKey)
  expect(client.info?.mode).toBe('default-deny')
})

test('a hub claiming another key without proof gets nothing and is not pinned', async () => {
  const hub = fakeHub()
  const hubKeys = new MemoryHubKeyStore()
  let asked = 0
  const client = new HubClient({
    address: 1997,
    keyStore: new MemoryKeyStore(keys.service.keyFile),
    hubKeys,
    serviceFactory: hub.factory,
    // Signed with the hub's key, but claiming the device's: the proof doesn't hold for the claimed key
    async askHubInfo(_address, nonce) {
      asked += 1
      if (asked > 1) client.stop()
      return { key: keys.device.publicKey, protocol: 2, challenge: 'challenge', proof: await signHubData(keys.hub.keyFile, `hubinfo1:${keys.device.publicKey}:${nonce}`) }
    },
  })
  client.start()
  await hub.connect()
  expect(asked).toBe(2)
  expect(hub.connects[0]).toEqual({})
  expect(await hubKeys.list()).toEqual({})
})

test('a hub that can prove only a different key than the pinned one gets nothing', async () => {
  const hub = fakeHub()
  const hubKeys = new MemoryHubKeyStore({ 'ws://localhost:1997': keys.device.publicKey })
  const client = new HubClient({
    address: 1997,
    keyStore: new MemoryKeyStore(keys.service.keyFile),
    hubKeys,
    serviceFactory: hub.factory,
    askHubInfo: provenInfo,
  })
  client.start()
  await hub.connect()
  expect(hub.connects[0]).toEqual({})
  expect(await hubKeys.get(1997)).toBe(keys.device.publicKey)
})

test('a plain address beyond the local network is refused before dialing', async () => {
  let asked = false
  const client = new HubClient({
    address: 'ws://hub.example.com:1997',
    keyStore: new MemoryKeyStore(keys.service.keyFile),
    askHubInfo: async () => {
      asked = true
    },
  })
  const error = await client.send('hub/info').then(() => undefined, error => error)
  expect(error).toMatchObject({ name: 'HubError', kind: 'connection' })
  expect(error.hint).toContain('wss://')
  expect(asked).toBe(false)
  expect(new HubClient({ address: 'ws://hub.example.com:1997', allowPlaintext: true, serviceFactory: fakeHub().factory }).start().status).toBe('connecting')
})

test('a supplied hub key is pinned and used from the first connect; forget clears it', async () => {
  const hub = fakeHub()
  const hubKeys = new MemoryHubKeyStore()
  const client = new HubClient({
    address: 'wss://hub.test:1997',
    keyStore: new MemoryKeyStore(keys.service.keyFile),
    hubKeys,
    hubKey: keys.hub.publicKey,
    serviceFactory: hub.factory,
    askHubInfo: provenInfo,
  })
  client.start()
  await hub.connect()
  expect(hub.connects[0]!.v).toBe('1')
  expect(await client.forgetHubKey()).toBe(true)
  expect(await hubKeys.get('wss://hub.test:1997')).toBeUndefined()
})

test('device mode adds a certificate for the client key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-client-'))
  try {
    const hub = fakeHub()
    const device = new DeviceIdentity({ path: join(directory, 'device.key'), instance: 'hub-cli' })
    const client = new HubClient({ address: 1997, keyStore: new MemoryKeyStore(keys.service.keyFile), device, serviceFactory: hub.factory, askHubInfo: provenInfo })
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

/** A channel server like a hub: `hub/info` for anyone, and `refuse` decides keyed upgrades. */
async function fakeChannelHub(refuse: () => boolean = () => false) {
  // A string specifier keeps tsc out of channel's server sources, which don't typecheck against current bun-types.
  const channelServer: string = 'channel/server'
  const { Channel } = await import(channelServer)
  const seen: Record<string, string | undefined>[] = []
  // A refused connection fails the upgrade like hub-server, without the test runner reporting the throw
  const serve = Bun.serve
  ;(Bun as any).serve = (options: any) => serve({ ...options, error: () => new Response('refused', { status: 403 }) })
  const server = new Channel()
    .post('hub/info', async ({ body }: { body: { nonce: string } }) => provenInfo('', body.nonce))
    .post('hub/service/update', () => {})
    .listen(0, {
      state(headers: Record<string, string | undefined>) {
        seen.push({ v: headers.v, auth: headers.auth })
        if (headers.auth && refuse()) throw 'invalid nonce'
        return {}
      },
    })
  ;(Bun as any).serve = serve
  return { seen, server, address: `ws://localhost:${server.port}` }
}

test('the default service asks anonymously, then connects with a v1 token', async () => {
  const hub = await fakeChannelHub()
  const hubKeys = new MemoryHubKeyStore()
  const client = new HubClient({ address: hub.address, keyStore: new MemoryKeyStore(keys.service.keyFile), hubKeys })
  try {
    expect(await client.send('hub/service/update', {})).toBeUndefined()
    expect(await client.hubKey()).toBe(keys.hub.publicKey)
    // Nothing keyed reached the hub before its proof
    expect(hub.seen[0]).toEqual({ v: undefined, auth: undefined })
    expect(hub.seen.find(headers => headers.auth)?.v).toBe('1')
  } finally {
    client.stop()
    hub.server.stop(true)
  }
})

test('a refused token tries once more, then is reported', async () => {
  const hub = await fakeChannelHub(() => true)
  const client = new HubClient({ address: hub.address, keyStore: new MemoryKeyStore(keys.service.keyFile) })
  try {
    const error = await client.send('hub/service/update', {}).then(() => undefined, error => error)
    expect(error).toMatchObject({ name: 'HubError', kind: 'auth', path: 'hub/service/update' })
    const iterator = client.values('hub/devices')[Symbol.asyncIterator]()
    expect(await iterator.next().then(() => undefined, error => error.kind)).toBe('auth')
    expect(hub.seen.filter(headers => headers.auth).length).toBe(2)
  } finally {
    client.stop()
    hub.server.stop(true)
  }
})

test('a refused token succeeds on the second try when the first challenge was stale', async () => {
  let refusals = 1
  const hub = await fakeChannelHub(() => refusals-- > 0)
  const client = new HubClient({ address: hub.address, keyStore: new MemoryKeyStore(keys.service.keyFile) })
  try {
    expect(await client.send('hub/service/update', {})).toBeUndefined()
    expect(hub.seen.filter(headers => headers.auth).length).toBe(2)
  } finally {
    client.stop()
    hub.server.stop(true)
  }
})

test('an address that is not a hub is reported', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('not a hub', { status: 404 }), websocket: { message() {} } })
  const client = new HubClient({ address: `ws://localhost:${server.port}`, keyStore: new MemoryKeyStore(keys.service.keyFile) })
  try {
    const error = await client.send('hub/info').then(() => undefined, error => error)
    expect(error).toMatchObject({ name: 'HubError', kind: 'connection' })
  } finally {
    client.stop()
    server.stop(true)
  }
})
