import { expect, test } from 'bun:test'

import { AppControl, actionFromElement, normalizeAppInterface } from './app-control'
import { HubControl } from './hub-control'
import {
  flattenLauncherProcesses,
  LauncherControl,
  normalizeLauncherInfo,
  normalizeLauncherStatus,
} from './launcher-control'
import {
  normalizeGroupList,
  normalizePendingPermissions,
  normalizePermissionNames,
  normalizeWhitelistStatus,
  SecurityControl,
} from './security-control'
import {
  joinStoragePath,
  normalizeStorageFilePath,
  normalizeStorageList,
  normalizeStoragePath,
  parentStoragePath,
  planDirectoryDownload,
  planDirectoryUpload,
  StorageControl,
} from './storage-control'
import type { HubRuntimeClient } from '../runtime'
import type { HubContext } from '../types/common'
import type { AppElement } from '../types/app-interface'
import type { StorageFetch } from '../types/storage'

type HubCall = {
  path: string
  body?: unknown
  context?: HubContext
}

class MockHubClient implements HubRuntimeClient {
  connected = true
  sends: HubCall[] = []
  streams: HubCall[] = []
  sendResults = new Map<string, unknown>()
  streamResults = new Map<string, unknown[]>()

  async send<T = unknown>(path: string, body?: unknown, context?: HubContext): Promise<T> {
    this.sends.push({ path, body, context })
    return this.sendResults.get(path) as T
  }

  values<T = unknown>(path: string, body?: unknown, context?: HubContext): AsyncIterable<T> {
    this.streams.push({ path, body, context })
    return asyncValues((this.streamResults.get(path) ?? []) as T[])
  }

  stop(): void {}
}

async function* asyncValues<T>(values: T[]): AsyncIterable<T> {
  for (const value of values) yield value
}

async function first<T>(values: AsyncIterable<T>): Promise<T> {
  for await (const value of values) return value
  throw new Error('No value emitted')
}

function paths(calls: HubCall[]): string[] {
  return calls.map(call => call.path)
}

test('HubControl normalizes streams and sends exact hub payloads', async () => {
  const client = new MockHubClient()
  const control = new HubControl(client)
  const context = { service: 'svc' }

  client.sendResults.set('hub/api', ['hub/status', 'hub/key'])
  client.sendResults.set('hub/key', 'public-key')
  client.sendResults.set('hub/proxy/join', 'join-token')
  client.sendResults.set('hub/proxy', { ok: true })
  client.streamResults.set('hub/api', [['hub/status']])
  client.streamResults.set('hub/api/services', [[{ id: 's3', name: 'Storage' }]])
  client.streamResults.set('hub/status', [{ requests: 2, connections: 1, services: [], apps: [] }])
  client.streamResults.set('hub/status/badges', [{ apps: [] }])
  client.streamResults.set('hub/connections', [[{ id: 'u1', name: 'Ada', services: 1, apps: 2 }]])
  client.streamResults.set('hub/merge/status', [[{ address: 'ws://a', isConnected: true }]])
  client.streamResults.set('hub/proxy', [{ ok: true }])

  expect(await control.api()).toEqual(new Set(['hub/status', 'hub/key']))
  expect(await first(control.watchApi())).toEqual(new Set(['hub/status']))
  expect(await first(control.providers('s3/list', context))).toEqual([{ id: 's3', name: 'Storage' }])
  await control.updateProfile({ name: 'Ada' })
  expect(await control.status()).toMatchObject({ requests: 2 })
  expect(await control.badges()).toEqual({ apps: [] })
  expect(await control.publicKey()).toBe('public-key')
  expect(await control.connections()).toEqual([{ id: 'u1', name: 'Ada', services: 1, apps: 2 }])
  await control.mergeAdd('ws://a')
  await control.mergeRemove('ws://a')
  expect(await control.mergeStatus()).toEqual([{ address: 'ws://a', isConnected: true }])
  await control.proxyAdd('ws://b')
  await control.proxyRemove('ws://b')
  expect(await control.proxyJoin()).toBe('join-token')
  expect(await control.proxyCall<{ ok: boolean }>('Files', 's3/list', { path: '/' })).toEqual({ ok: true })
  await first(control.proxyStream('Files', 's3/list', { path: '/' }))
  await control.setBalancer('ocr/run', 'random')
  await control.setBalancerLimit(4)

  expect(client.sends).toEqual([
    { path: 'hub/api', body: undefined, context: undefined },
    { path: 'hub/profile/update', body: { name: 'Ada' }, context: undefined },
    { path: 'hub/key', body: undefined, context: undefined },
    { path: 'hub/merge/add', body: 'ws://a', context: undefined },
    { path: 'hub/merge/remove', body: 'ws://a', context: undefined },
    { path: 'hub/proxy/add', body: 'ws://b', context: undefined },
    { path: 'hub/proxy/remove', body: 'ws://b', context: undefined },
    { path: 'hub/proxy/join', body: undefined, context: undefined },
    { path: 'hub/proxy', body: { name: 'Files', path: 's3/list', body: { path: '/' } }, context: undefined },
    { path: 'hub/balancer/set', body: { path: 'ocr/run', type: 'random' }, context: undefined },
    { path: 'hub/balancer/limit', body: { limit: 4 }, context: undefined },
  ])
  expect(client.streams).toContainEqual({ path: 'hub/api/services', body: 's3/list', context })
  expect(client.streams).toContainEqual({ path: 'hub/proxy', body: { name: 'Files', path: 's3/list', body: { path: '/' } }, context: undefined })
})

test('LauncherControl covers launcher streams, app actions, terminal I/O, and normalization', async () => {
  const client = new MockHubClient()
  const control = new LauncherControl(client)

  client.sendResults.set('launcher/update/check', true)
  client.sendResults.set('launcher/pair/new', 'K7Q-2MX')
  client.streamResults.set('launcher/info', [{
    apps: [
      { name: 'Hub', active: true, restarts: true, updateAvailable: true, instances: 2, settings: { env: { PORT: '1997' } }, terminal: { cols: 80 } },
    ],
  }])
  client.streamResults.set('launcher/status', [{
    apps: [
      { name: 'Hub', checkingForUpdates: false, updating: true, processes: [{ pid: 10, cpu: 1.5, memory: 2048 }], started: new Date('2026-05-05T00:00:00Z') },
    ],
  }])

  expect(await control.info()).toMatchObject({ apps: [{ name: 'Hub', instances: 2, terminal: { cols: 80 } }] })
  expect(await control.status()).toMatchObject({ apps: { Hub: { updating: true, processes: [{ pid: 10 }] } } })
  expect(await control.checkLauncherUpdate()).toBe(true)
  await control.updateLauncher()
  await control.checkAllUpdates()
  await control.updateAll()
  await control.stopLauncher()
  expect(await control.newPairingCode()).toBe('K7Q-2MX')
  await control.startApp('Hub')
  await control.stopApp('Hub')
  await control.restartApp('Hub')
  await control.uninstallApp('Hub')
  await control.createApp({ name: 'Test', active: true, restarts: false, setup: { type: 'sh', run: 'bun start' } })
  await control.updateAppSettings('Hub', { env: { PORT: '1997' }, secrets: { TOKEN: 'x' } })
  await control.setAppClusterCount('Hub', 3)

  expect(paths(client.sends)).toEqual([
    'launcher/update/check',
    'launcher/update',
    'launcher/update/check/all',
    'launcher/update/all',
    'launcher/stop',
    'launcher/pair/new',
    'launcher/app/start',
    'launcher/app/stop',
    'launcher/app/restart',
    'launcher/app/uninstall',
    'launcher/app/create',
    'launcher/app/settings',
    'launcher/app/cluster',
  ])
  expect(client.sends.at(-2)).toEqual({ path: 'launcher/app/settings', body: { app: 'Hub', settings: { env: { PORT: '1997' }, secrets: { TOKEN: 'x' } } }, context: undefined })
  expect(client.sends.at(-1)).toEqual({ path: 'launcher/app/cluster', body: { name: 'Hub', count: 3 }, context: undefined })
  expect(normalizeLauncherInfo({ Hub: { name: 'Hub' } })).toMatchObject({ apps: [{ name: 'Hub', instances: 1 }] })
  expect(normalizeLauncherInfo({ apps: [], pairingCode: 'K7Q-2MX' }).pairingCode).toBe('K7Q-2MX')
  expect(normalizeLauncherInfo({ apps: [] }).pairingCode).toBeUndefined()
  const normalizedStatus = normalizeLauncherStatus({ Hub: { name: 'Hub', processes: [{ pid: 1 }] } })
  expect(flattenLauncherProcesses(normalizedStatus)).toMatchObject([{ app: 'Hub', pid: 1 }])
})

test('SecurityControl covers pending, allowed, groups, users, names, and whitelist payloads', async () => {
  const client = new MockHubClient()
  const control = new SecurityControl(client)

  client.sendResults.set('hub/host/allowed', ['hub/status'])
  client.sendResults.set('hub/call/allowed', ['s3/list'])
  client.streamResults.set('hub/host/pending', [[{ key: 'user', paths: ['hub/status'] }, { id: 'second', pending: ['hub/key'] }]])
  client.streamResults.set('hub/call/pending', [[{ key: 'caller', paths: ['s3/list'] }]])
  client.streamResults.set('hub/group/list', [{ admins: ['hub/status'], editors: ['s3/list'] }])
  client.streamResults.set('hub/group/users', [{ admins: ['key-a'] }])
  client.streamResults.set('hub/group/names', [{ 'hub/status': 'Hub Status' }])
  client.streamResults.set('hub/whitelist/status', [{ enabled: true, whitelist: ['key-a'] }])

  expect(await control.hostPending()).toEqual([
    { id: 'second', key: 'second', name: undefined, pending: ['hub/key'], raw: { id: 'second', pending: ['hub/key'] } },
    { id: 'user', key: 'user', name: undefined, pending: ['hub/status'], raw: { key: 'user', paths: ['hub/status'] } },
  ])
  expect(await control.hostAllowed('key-a')).toEqual(['hub/status'])
  await control.allowHost('key-a', ['hub/status'])
  await control.revokeHost('key-a', ['hub/key'])
  expect(await control.callPending()).toEqual([{ id: 'caller', key: 'caller', pending: ['s3/list'], raw: { key: 'caller', paths: ['s3/list'] } }])
  expect(await control.callAllowed('key-b')).toEqual(['s3/list'])
  await control.allowCall('key-b', ['s3/list'])
  await control.revokeCall('key-b', ['s3/write'])
  await control.createGroup('admins')
  await control.renameGroup('admins', 'owners')
  await control.removeGroup('guests')
  await control.addGroupPermissions('admins', ['hub/status'])
  await control.removeGroupPermissions('admins', ['hub/key'])
  await control.setGroupPermissions('admins', ['hub/status'])
  await control.addGroupUsers('admins', ['key-a'])
  await control.removeGroupUsers('admins', ['key-b'])
  expect(await control.groupList()).toEqual([
    { id: 'admins', name: 'admins', permissions: ['hub/status'], raw: { name: 'admins', permissions: ['hub/status'] } },
    { id: 'editors', name: 'editors', permissions: ['s3/list'], raw: { name: 'editors', permissions: ['s3/list'] } },
  ])
  expect(await control.groupUsers()).toEqual({ admins: ['key-a'] })
  expect(await control.groupNames()).toEqual({ 'hub/status': 'Hub Status' })
  expect(await control.whitelistStatus()).toEqual({ enabled: true, users: ['key-a'], raw: { enabled: true, whitelist: ['key-a'] } })
  await control.enableWhitelist()
  await control.disableWhitelist()
  await control.addWhitelistUsers(['key-a'])
  await control.removeWhitelistUsers(['key-b'])
  await control.allowCurrentWhitelistUsers()

  expect(client.sends).toEqual([
    { path: 'hub/host/allowed', body: 'key-a', context: undefined },
    { path: 'hub/host/update', body: { key: 'key-a', allow: ['hub/status'] }, context: undefined },
    { path: 'hub/host/update', body: { key: 'key-a', revoke: ['hub/key'] }, context: undefined },
    { path: 'hub/call/allowed', body: 'key-b', context: undefined },
    { path: 'hub/call/update', body: { key: 'key-b', allow: ['s3/list'] }, context: undefined },
    { path: 'hub/call/update', body: { key: 'key-b', revoke: ['s3/write'] }, context: undefined },
    { path: 'hub/group/create', body: 'admins', context: undefined },
    { path: 'hub/group/rename', body: { group: 'admins', name: 'owners' }, context: undefined },
    { path: 'hub/group/remove', body: 'guests', context: undefined },
    { path: 'hub/group/update', body: { group: 'admins', add: ['hub/status'] }, context: undefined },
    { path: 'hub/group/update', body: { group: 'admins', remove: ['hub/key'] }, context: undefined },
    { path: 'hub/group/update', body: { group: 'admins', set: ['hub/status'] }, context: undefined },
    { path: 'hub/group/update/users', body: { group: 'admins', add: ['key-a'] }, context: undefined },
    { path: 'hub/group/update/users', body: { group: 'admins', remove: ['key-b'] }, context: undefined },
    { path: 'hub/whitelist', body: { enabled: true }, context: undefined },
    { path: 'hub/whitelist', body: { enabled: false }, context: undefined },
    { path: 'hub/whitelist', body: { add: ['key-a'] }, context: undefined },
    { path: 'hub/whitelist', body: { remove: ['key-b'] }, context: undefined },
    { path: 'hub/whitelist', body: { allowsCurrent: true }, context: undefined },
  ])
  expect(normalizePendingPermissions({ key: { paths: ['a'] } })).toEqual([{ id: 'key', key: 'key', name: undefined, pending: ['a'], raw: { id: 'key', pending: { paths: ['a'] } } }])
  expect(normalizeGroupList({ users: ['hub/key'] })).toEqual([{ id: 'users', name: 'users', permissions: ['hub/key'], raw: { name: 'users', permissions: ['hub/key'] } }])
  expect(normalizePermissionNames({ 'hub/key': 1 })).toEqual({ 'hub/key': '1' })
  expect(normalizeWhitelistStatus({ enabled: false, users: ['a'] })).toEqual({ enabled: false, users: ['a'], raw: { enabled: false, users: ['a'] } })
})

test('StorageControl covers provider/list/watch/read/write/delete/upload/download/update flows and path helpers', async () => {
  const client = new MockHubClient()
  const context = { service: 'Storage' }
  const fetchCalls: Array<{ url: string; init?: { method?: string; body?: unknown } }> = []
  const fetchImpl: StorageFetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init })
    return new Response('file-bytes', { status: 200 })
  }
  const control = new StorageControl(client, { fetch: fetchImpl })

  client.sendResults.set('s3/list', { count: 1, files: [{ name: 'a.txt', size: 4 }], directories: ['nested'] })
  client.sendResults.set('s3/read/directory', [{ name: 'b.txt', size: 5 }])
  client.sendResults.set('s3/read', 'https://read.example/file')
  client.sendResults.set('s3/write', 'https://write.example/file')
  client.streamResults.set('hub/api/services', [[{ id: 'local-s3' }]])
  client.streamResults.set('s3/list', [{ files: ['a.txt'], directories: ['nested'] }])

  expect(await first(control.providers())).toEqual([{ id: 'local-s3' }])
  expect(await control.list('/docs', context)).toMatchObject({ path: 'docs/', files: [{ name: 'a.txt', size: 4 }], directories: ['nested/'] })
  expect(await first(control.watchList('/docs', context))).toMatchObject({ path: 'docs/', files: [{ name: 'a.txt' }] })
  expect(await control.readDirectory('/docs', context)).toEqual([{ name: 'b.txt', size: 5, raw: { name: 'b.txt', size: 5 } }])
  expect(await control.readUrl('/docs/a.txt', context)).toBe('https://read.example/file')
  expect(await control.writeUrl('/docs/a.txt', context)).toBe('https://write.example/file')
  await control.delete('/docs/a.txt', context)
  await control.updated('/docs', context)
  expect(await control.uploadData('/docs/a.txt', 'data', { context })).toMatchObject({ path: 'docs/a.txt', sent: 4, total: 4, ratio: 1, state: 'done' })
  expect(await control.download('/docs/a.txt', { context })).toEqual(new TextEncoder().encode('file-bytes'))
  await control.notifyUploaded('/docs/nested/a.txt', context)

  expect(client.streams).toContainEqual({ path: 'hub/api/services', body: 's3/list', context: undefined })
  expect(client.sends).toEqual([
    { path: 's3/list', body: 'docs/', context },
    { path: 's3/read/directory', body: 'docs/', context },
    { path: 's3/read', body: 'docs/a.txt', context },
    { path: 's3/write', body: 'docs/a.txt', context },
    { path: 's3/delete', body: 'docs/a.txt', context },
    { path: 's3/updated', body: 'docs/', context },
    { path: 's3/write', body: 'docs/a.txt', context },
    { path: 's3/updated', body: 'docs/', context },
    { path: 's3/updated', body: '', context },
    { path: 's3/read', body: 'docs/a.txt', context },
    { path: 's3/updated', body: 'docs/nested/', context },
    { path: 's3/updated', body: 'docs/', context },
  ])
  expect(fetchCalls).toEqual([
    { url: 'https://write.example/file', init: { method: 'PUT', body: 'data' } },
    { url: 'https://read.example/file', init: undefined },
  ])
  expect(normalizeStoragePath(' /docs//nested ')).toBe('docs/nested/')
  expect(normalizeStorageFilePath(' /docs//a.txt ')).toBe('docs/a.txt')
  expect(parentStoragePath('docs/nested/a.txt')).toBe('docs/nested/')
  expect(joinStoragePath('docs', 'a.txt')).toBe('docs/a.txt')
  expect(normalizeStorageList({ files: ['a.txt'], directories: ['docs'] }, 'root')).toMatchObject({ path: 'root/', files: [{ name: 'a.txt' }], directories: ['docs/'] })
  expect(planDirectoryUpload('root', [{ relativePath: './a.txt', localPath: '/tmp/a.txt', size: 3 }])).toEqual([{ relativePath: 'a.txt', remotePath: 'root/a.txt', localPath: '/tmp/a.txt', size: 3 }])
  expect(planDirectoryDownload('root', [{ name: 'a.txt', size: 3 }], '/tmp')).toEqual([{ remotePath: 'root/a.txt', localPath: '/tmp/a.txt', size: 3 }])
})

test('AppControl normalizes app-service interfaces and maps action bodies and outputs', async () => {
  const client = new MockHubClient()
  const control = new AppControl(client)
  const data: Record<string, unknown> = { input: 'Ada', keep: true }
  const nestedData: Record<string, unknown> = { nested: 42 }
  const context = { service: 'App' }

  client.streamResults.set('app/interface', [{
    header: { name: 'Demo', path: 'app/interface', services: 0 },
    body: [
      'Hello',
      { type: 'button', title: 'Run', action: { path: 'app/run', body: { name: 'input', count: 'nested' }, output: { result: 'answer' } } },
      { type: 'unknown' },
    ],
    top: { type: 'text', value: 'Top', secondary: true },
    data,
  }])
  client.sendResults.set('app/run', { result: 'OK', untouched: 1 })

  const appInterface = await first(control.watchInterface('app/interface', context))
  expect(appInterface.header).toMatchObject({ name: 'Demo', isOnline: false })
  expect(appInterface.warnings).toBe(1)
  expect(appInterface.body).toHaveLength(2)
  const action = actionFromElement((appInterface.body as AppElement[])[1]!)
  expect(action).toEqual({ path: 'app/run', body: { name: 'input', count: 'nested' }, output: { result: 'answer' }, raw: { path: 'app/run', body: { name: 'input', count: 'nested' }, output: { result: 'answer' } } })

  const result = await control.executeAction(action!, { data, nestedData, extraData: { extra: 'x' }, context })
  expect(result).toEqual({
    body: { name: 'Ada', count: 42, extra: 'x' },
    result: { result: 'OK', untouched: 1 },
    output: { untouched: 1, answer: 'OK' },
  })
  expect(nestedData).toEqual({ nested: 42, untouched: 1, answer: 'OK' })
  expect(client.streams).toEqual([{ path: 'app/interface', body: undefined, context }])
  expect(client.sends).toEqual([{ path: 'app/run', body: { name: 'Ada', count: 42, extra: 'x' }, context }])
})
