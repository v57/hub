import { basename } from 'node:path'
import {
  AppControl,
  BunFileConnectionStore,
  DeviceControl,
  BunFileHubKeyStore,
  DeviceIdentity,
  HubClient,
  HubControl,
  LauncherControl,
  SecurityControl,
  StorageControl,
  createDefaultKeyStore,
  type ConnectionStore,
  type HubContext,
  type HubKeyStore,
  type HubRuntimeClient,
  type KeyStore,
  type LauncherCreate,
  type LauncherSettings,
  type StorageFetch,
} from '../index'

export interface ExCommandOptions {
  json: boolean
  yes: boolean
  end: boolean
  help: boolean
  /** Connect as this device (send a certificate from the device key); off by default. */
  device: boolean
  /** Service keys to keep on `device revoke`. */
  keep: string[]
  context?: HubContext
  pid?: number
}

export interface ParsedExCommand {
  id: string
  args: string[]
  options: ExCommandOptions
  help: HelpEntry
}

export interface ExEnvironment {
  connections?: ConnectionStore
  keyStore?: KeyStore
  hubKeys?: HubKeyStore
  device?: DeviceIdentity
  createClient?: (options: { address?: string; keyStore: KeyStore; hubKeys: HubKeyStore; device?: DeviceIdentity }) => HubRuntimeClient
  log?: (line: string) => void
  fetch?: StorageFetch
}

export interface HelpEntry {
  id: string
  group: string
  usage: string
  endpoint: string
  description: string
}

interface ExContext {
  readonly options: ExCommandOptions
  readonly env: ExEnvironment
  readonly connections: ConnectionStore
  readonly keyStore: KeyStore
  readonly hubKeys: HubKeyStore
  log(value: unknown): void
  selectedAddress(): Promise<string>
  client(): Promise<HubRuntimeClient>
  hub(): Promise<HubControl>
  launcher(): Promise<LauncherControl>
  security(): Promise<SecurityControl>
  devices(): Promise<DeviceControl>
  storage(): Promise<StorageControl>
  app(): Promise<AppControl>
  stop(): void
}

type CommandRunner = (context: ExContext, args: string[]) => Promise<void>

const helpEntries: HelpEntry[] = [
  { id: 'add', group: 'connection', usage: 'add <address> <name>', endpoint: 'connection-store add', description: 'Add and select Hub connection.' },
  { id: 'remove', group: 'connection', usage: 'remove <name-or-id>', endpoint: 'connection-store remove', description: 'Remove saved Hub connection.' },
  { id: 'connections', group: 'connection', usage: 'connections', endpoint: 'connection-store list', description: 'List saved Hub connections.' },
  { id: 'select', group: 'connection', usage: 'select <name-or-id>', endpoint: 'connection-store select', description: 'Select saved Hub connection.' },
  { id: 'selected', group: 'connection', usage: 'selected', endpoint: 'connection-store selected', description: 'Print selected Hub connection.' },
  { id: 'key', group: 'connection', usage: 'key', endpoint: 'key-store publicKey', description: 'Print local public key.' },
  { id: 'key:reset', group: 'connection', usage: 'key reset --yes', endpoint: 'key-store reset', description: 'Reset local key material.' },
  { id: 'info', group: 'connection', usage: 'info', endpoint: 'hub/info', description: 'Print the hub key, protocol and security mode.' },
  { id: 'hubkey', group: 'connection', usage: 'hubkey', endpoint: 'hubs.json', description: 'Print the pinned key of the selected hub.' },
  { id: 'hubkey:forget', group: 'connection', usage: 'hubkey forget', endpoint: 'hubs.json', description: 'Forget the pinned hub key; the next connect learns it again.' },
  { id: 'api', group: 'raw api', usage: 'api', endpoint: 'hub/api', description: 'Stream API endpoint list.' },
  { id: 'call', group: 'raw api', usage: 'call <path> [json-body]', endpoint: '<path>', description: 'Send raw request.' },
  { id: 'stream', group: 'raw api', usage: 'stream <path> [json-body]', endpoint: '<path>', description: 'Stream raw values.' },
  { id: 'providers', group: 'raw api', usage: 'providers <path>', endpoint: 'hub/api/services', description: 'Stream service providers for path.' },
  { id: 'status', group: 'status', usage: 'status', endpoint: 'hub/status', description: 'Print Hub status.' },
  { id: 'badges', group: 'status', usage: 'badges', endpoint: 'hub/status/badges', description: 'Print Hub badges.' },
  { id: 'processes', group: 'status', usage: 'processes', endpoint: 'launcher/status', description: 'Print flattened launcher processes.' },
  { id: 'apps', group: 'status', usage: 'apps', endpoint: 'hub/status', description: 'Print Hub app headers.' },
  { id: 'app', group: 'app', usage: 'app <path>', endpoint: '<path>', description: 'Stream service app interface.' },
  { id: 'launcher', group: 'launcher', usage: 'launcher', endpoint: 'launcher/info', description: 'Print launcher info.' },
  { id: 'launcher:stop', group: 'launcher', usage: 'launcher stop', endpoint: 'launcher/stop', description: 'Stop launcher.' },
  { id: 'launcher:update:check', group: 'launcher', usage: 'launcher update check', endpoint: 'launcher/update/check', description: 'Check launcher update.' },
  { id: 'launcher:update', group: 'launcher', usage: 'launcher update', endpoint: 'launcher/update', description: 'Update launcher.' },
  { id: 'launcher:app:start', group: 'launcher', usage: 'launcher app start <name>', endpoint: 'launcher/app/start', description: 'Start app.' },
  { id: 'launcher:app:stop', group: 'launcher', usage: 'launcher app stop <name>', endpoint: 'launcher/app/stop', description: 'Stop app.' },
  { id: 'launcher:app:restart', group: 'launcher', usage: 'launcher app restart <name>', endpoint: 'launcher/app/restart', description: 'Restart app.' },
  { id: 'launcher:app:uninstall', group: 'launcher', usage: 'launcher app uninstall <name>', endpoint: 'launcher/app/uninstall', description: 'Uninstall app.' },
  { id: 'launcher:app:cluster', group: 'launcher', usage: 'launcher app cluster <name> <count>', endpoint: 'launcher/app/cluster', description: 'Set app cluster count.' },
  { id: 'launcher:app:settings', group: 'launcher', usage: 'launcher app settings <name> <json-settings>', endpoint: 'launcher/app/settings', description: 'Update app settings.' },
  { id: 'launcher:app:create', group: 'launcher', usage: 'launcher app create <json-create-payload>', endpoint: 'launcher/app/create', description: 'Create app.' },
  { id: 'launcher:pro', group: 'launcher', usage: 'launcher pro', endpoint: 'launcher/pro', description: 'Promote launcher to Pro using local public key.' },
  { id: 'terminal', group: 'terminal', usage: 'terminal <app> [pid]', endpoint: 'launcher/terminal', description: 'Stream raw terminal chunks/events.' },
  { id: 'terminal:in', group: 'terminal', usage: 'terminal in <app> <data> [--pid <pid>] [--end]', endpoint: 'launcher/terminal/in', description: 'Send terminal input.' },
  { id: 'terminal:resize', group: 'terminal', usage: 'terminal resize <app> <cols> <rows> [--pid <pid>]', endpoint: 'launcher/terminal/resize', description: 'Resize terminal.' },
  { id: 'devices', group: 'devices', usage: 'devices', endpoint: 'hub/devices', description: 'Print devices with services, presence and capabilities.' },
  { id: 'devices:pending', group: 'devices', usage: 'devices pending', endpoint: 'hub/devices/pending', description: 'Print devices waiting for approval with their safety codes.' },
  { id: 'device:approve', group: 'devices', usage: 'device approve <id>', endpoint: 'hub/device/approve', description: 'Approve a pending device (compare its safety code first).' },
  { id: 'device:rename', group: 'devices', usage: 'device rename <id> <name>', endpoint: 'hub/device/rename', description: 'Rename device.' },
  { id: 'device:remove', group: 'devices', usage: 'device remove <id>', endpoint: 'hub/device/remove', description: 'Remove device; it can enrol again.' },
  { id: 'device:revoke', group: 'devices', usage: 'device revoke <id> --yes [--keep <service-key>]...', endpoint: 'hub/device/revoke', description: 'Revoke a lost device and its service keys, except kept ones.' },
  { id: 'device:data', group: 'devices', usage: 'device data <id>', endpoint: 'hub/devices/data', description: 'Stream live device data.' },
  { id: 'connections:users', group: 'security', usage: 'connections users', endpoint: 'hub/connections', description: 'Print connected Hub users.' },
  { id: 'host:pending', group: 'security', usage: 'host pending', endpoint: 'hub/host/pending', description: 'Print pending host permissions.' },
  { id: 'host:allow', group: 'security', usage: 'host allow <key> <path...>', endpoint: 'hub/host/update', description: 'Allow host permissions.' },
  { id: 'host:revoke', group: 'security', usage: 'host revoke <key> <path...>', endpoint: 'hub/host/update', description: 'Revoke host permissions.' },
  { id: 'host:allowed', group: 'security', usage: 'host allowed <key>', endpoint: 'hub/host/allowed', description: 'Print allowed host paths.' },
  { id: 'call:pending', group: 'security', usage: 'call pending', endpoint: 'hub/call/pending', description: 'Print pending call permissions.' },
  { id: 'call:allow', group: 'security', usage: 'call allow <key> <path...>', endpoint: 'hub/call/update', description: 'Allow call permissions.' },
  { id: 'call:revoke', group: 'security', usage: 'call revoke <key> <path...>', endpoint: 'hub/call/update', description: 'Revoke call permissions.' },
  { id: 'call:allowed', group: 'security', usage: 'call allowed <key>', endpoint: 'hub/call/allowed', description: 'Print allowed call paths.' },
  { id: 'groups', group: 'security', usage: 'groups', endpoint: 'hub/group/list', description: 'Print permission groups.' },
  { id: 'group:names', group: 'security', usage: 'group names', endpoint: 'hub/group/names', description: 'Print permission names.' },
  { id: 'group:create', group: 'security', usage: 'group create <name>', endpoint: 'hub/group/create', description: 'Create permission group.' },
  { id: 'group:rename', group: 'security', usage: 'group rename <old> <new>', endpoint: 'hub/group/rename', description: 'Rename permission group.' },
  { id: 'group:remove', group: 'security', usage: 'group remove <name>', endpoint: 'hub/group/remove', description: 'Remove permission group.' },
  { id: 'group:set', group: 'security', usage: 'group set <name> <path...>', endpoint: 'hub/group/update', description: 'Set group permissions.' },
  { id: 'group:add:user', group: 'security', usage: 'group add user <group> <key>', endpoint: 'hub/group/update/users', description: 'Add group user.' },
  { id: 'group:remove:user', group: 'security', usage: 'group remove user <group> <key>', endpoint: 'hub/group/update/users', description: 'Remove group user.' },
  { id: 'whitelist', group: 'security', usage: 'whitelist', endpoint: 'hub/whitelist/status', description: 'Print whitelist status.' },
  { id: 'whitelist:enable', group: 'security', usage: 'whitelist enable', endpoint: 'hub/whitelist', description: 'Enable whitelist.' },
  { id: 'whitelist:disable', group: 'security', usage: 'whitelist disable', endpoint: 'hub/whitelist', description: 'Disable whitelist.' },
  { id: 'whitelist:add', group: 'security', usage: 'whitelist add <key>', endpoint: 'hub/whitelist', description: 'Add whitelist user.' },
  { id: 'whitelist:remove', group: 'security', usage: 'whitelist remove <key>', endpoint: 'hub/whitelist', description: 'Remove whitelist user.' },
  { id: 'merge:status', group: 'merge/proxy', usage: 'merge status', endpoint: 'hub/merge/status', description: 'Print merge status.' },
  { id: 'merge:add', group: 'merge/proxy', usage: 'merge <connection-or-address>', endpoint: 'hub/merge/add', description: 'Add merge peer.' },
  { id: 'merge:remove', group: 'merge/proxy', usage: 'unmerge <connection-or-address>', endpoint: 'hub/merge/remove', description: 'Remove merge peer.' },
  { id: 'proxy:add', group: 'merge/proxy', usage: 'proxy add <address>', endpoint: 'hub/proxy/add', description: 'Add proxy.' },
  { id: 'proxy:remove', group: 'merge/proxy', usage: 'proxy remove <address>', endpoint: 'hub/proxy/remove', description: 'Remove proxy.' },
  { id: 'proxy:join', group: 'merge/proxy', usage: 'proxy join', endpoint: 'hub/proxy/join', description: 'Join proxy.' },
  { id: 'proxy:call', group: 'merge/proxy', usage: 'proxy call <proxy-name> <path> [json-body]', endpoint: 'hub/proxy', description: 'Send proxy request.' },
  { id: 'proxy:stream', group: 'merge/proxy', usage: 'proxy stream <proxy-name> <path> [json-body]', endpoint: 'hub/proxy', description: 'Stream proxy values.' },
  { id: 'storage:providers', group: 'storage', usage: 'storage providers', endpoint: 'hub/api/services', description: 'Stream storage providers.' },
  { id: 'storage:list', group: 'storage', usage: 'storage list [path]', endpoint: 's3/list', description: 'List storage path.' },
  { id: 'storage:watch', group: 'storage', usage: 'storage watch [path]', endpoint: 's3/list', description: 'Watch storage path.' },
  { id: 'storage:read', group: 'storage', usage: 'storage read <path>', endpoint: 's3/read', description: 'Get storage read URL.' },
  { id: 'storage:read:directory', group: 'storage', usage: 'storage read directory <path>', endpoint: 's3/read/directory', description: 'Read storage directory.' },
  { id: 'storage:write', group: 'storage', usage: 'storage write <path>', endpoint: 's3/write', description: 'Get storage write URL.' },
  { id: 'storage:upload', group: 'storage', usage: 'storage upload <local-file> [remote-path]', endpoint: 's3/write', description: 'Upload local file.' },
  { id: 'storage:download', group: 'storage', usage: 'storage download <remote-path> [local-path]', endpoint: 's3/read', description: 'Download remote file.' },
  { id: 'storage:delete', group: 'storage', usage: 'storage delete <path>', endpoint: 's3/delete', description: 'Delete storage file.' },
  { id: 'storage:updated', group: 'storage', usage: 'storage updated <path>', endpoint: 's3/updated', description: 'Notify storage path updated.' },
]

const helpById = new Map(helpEntries.map(entry => [entry.id, entry]))

const commandRunners: Record<string, CommandRunner> = {
  add: async (context, args) => context.log(await context.connections.add(expectArg(args, 0, 'address'), args.slice(1).join(' ') || undefined)),
  remove: async (context, args) => context.log({ removed: await context.connections.remove(expectArg(args, 0, 'name-or-id')) }),
  connections: async context => {
    const [connections, selected] = await Promise.all([context.connections.list(), context.connections.selected()])
    context.log(connections.map(connection => ({ ...connection, selected: connection.id === selected?.id })))
  },
  select: async (context, args) => context.log(await expectFound(context.connections.select(expectArg(args, 0, 'name-or-id')), 'Connection not found')),
  selected: async context => context.log(await expectFound(context.connections.selected(), 'No selected Hub connection')),
  key: async context => context.log(await context.keyStore.publicKey()),
  'key:reset': async context => {
    if (!context.options.yes) throw new Error('key reset requires --yes')
    if (!context.keyStore.reset) throw new Error('Configured key store does not support reset')
    await context.keyStore.reset()
    context.log('ok')
  },
  info: async context => context.log(await (await context.client()).send('hub/info')),
  hubkey: async context => context.log((await context.hubKeys.get(await context.selectedAddress())) ?? 'not pinned'),
  'hubkey:forget': async context => context.log({ forgotten: await context.hubKeys.forget(await context.selectedAddress()) }),
  api: async context => printStream(context, (await context.hub()).watchApi()),
  call: async (context, args) => context.log(await (await context.client()).send(expectArg(args, 0, 'path'), parseJsonArg(args[1]), context.options.context)),
  stream: async (context, args) => printStream(context, (await context.client()).values(expectArg(args, 0, 'path'), parseJsonArg(args[1]), context.options.context)),
  providers: async (context, args) => printStream(context, (await context.hub()).providers(expectArg(args, 0, 'path'), context.options.context)),
  status: async context => context.log(await (await context.hub()).status()),
  badges: async context => context.log(await (await context.hub()).badges()),
  processes: async context => context.log(await (await context.launcher()).processes()),
  apps: async context => context.log((await (await context.hub()).status()).apps),
  app: async (context, args) => printStream(context, (await context.app()).appInterface(expectArg(args, 0, 'path'), context.options.context)),
  launcher: async context => context.log(await (await context.launcher()).info()),
  'launcher:stop': async context => ok(context, (await context.launcher()).stopLauncher()),
  'launcher:update:check': async context => context.log(await (await context.launcher()).checkLauncherUpdate()),
  'launcher:update': async context => ok(context, (await context.launcher()).updateLauncher()),
  'launcher:app:start': async (context, args) => ok(context, (await context.launcher()).startApp(expectArg(args, 0, 'name'))),
  'launcher:app:stop': async (context, args) => ok(context, (await context.launcher()).stopApp(expectArg(args, 0, 'name'))),
  'launcher:app:restart': async (context, args) => ok(context, (await context.launcher()).restartApp(expectArg(args, 0, 'name'))),
  'launcher:app:uninstall': async (context, args) => ok(context, (await context.launcher()).uninstallApp(expectArg(args, 0, 'name'))),
  'launcher:app:cluster': async (context, args) => ok(context, (await context.launcher()).setAppClusterCount(expectArg(args, 0, 'name'), parseNumberArg(args[1], 'count'))),
  'launcher:app:settings': async (context, args) => ok(context, (await context.launcher()).updateAppSettings(expectArg(args, 0, 'name'), parseJsonRequired(args[1], 'json-settings') as LauncherSettings)),
  'launcher:app:create': async (context, args) => ok(context, (await context.launcher()).createApp(parseJsonRequired(args[0], 'json-create-payload') as LauncherCreate)),
  'launcher:pro': async context => ok(context, (await context.launcher()).promoteToPro(await context.keyStore.publicKey())),
  terminal: async (context, args) => printStream(context, (await context.launcher()).terminal(expectArg(args, 0, 'app'), context.options.pid ?? optionalNumberArg(args[1], 'pid'))),
  'terminal:in': async (context, args) => ok(context, (await context.launcher()).terminalInput(expectArg(args, 0, 'app'), expectRest(args, 1, 'data').join(' '), context.options.pid, context.options.end)),
  'terminal:resize': async (context, args) => ok(context, (await context.launcher()).terminalResize(expectArg(args, 0, 'app'), parseNumberArg(args[1], 'cols'), parseNumberArg(args[2], 'rows'), context.options.pid)),
  devices: async context => context.log(await (await context.devices()).devices()),
  'devices:pending': async context => context.log(await (await context.devices()).pending()),
  'device:approve': async (context, args) => context.log(await (await context.devices()).approve(expectArg(args, 0, 'id'))),
  'device:rename': async (context, args) => context.log(await (await context.devices()).rename(expectArg(args, 0, 'id'), expectRest(args, 1, 'name').join(' '))),
  'device:remove': async (context, args) => ok(context, (await context.devices()).remove(expectArg(args, 0, 'id'))),
  'device:revoke': async (context, args) => {
    if (!context.options.yes) throw new Error('device revoke requires --yes')
    await ok(context, (await context.devices()).revoke(expectArg(args, 0, 'id'), context.options.keep))
  },
  'device:data': async (context, args) => printStream(context, (await context.devices()).watchData(expectArg(args, 0, 'id'))),
  'connections:users': async context => context.log(await (await context.hub()).connections()),
  'host:pending': async context => context.log(await (await context.security()).hostPending()),
  'host:allow': async (context, args) => ok(context, (await context.security()).allowHost(expectArg(args, 0, 'key'), expectRest(args, 1, 'path'))),
  'host:revoke': async (context, args) => ok(context, (await context.security()).revokeHost(expectArg(args, 0, 'key'), expectRest(args, 1, 'path'))),
  'host:allowed': async (context, args) => context.log(await (await context.security()).hostAllowed(expectArg(args, 0, 'key'))),
  'call:pending': async context => context.log(await (await context.security()).callPending()),
  'call:allow': async (context, args) => ok(context, (await context.security()).allowCall(expectArg(args, 0, 'key'), expectRest(args, 1, 'path'))),
  'call:revoke': async (context, args) => ok(context, (await context.security()).revokeCall(expectArg(args, 0, 'key'), expectRest(args, 1, 'path'))),
  'call:allowed': async (context, args) => context.log(await (await context.security()).callAllowed(expectArg(args, 0, 'key'))),
  groups: async context => context.log(await (await context.security()).groupList()),
  'group:names': async context => context.log(await (await context.security()).groupNames()),
  'group:create': async (context, args) => ok(context, (await context.security()).createGroup(expectArg(args, 0, 'name'))),
  'group:rename': async (context, args) => ok(context, (await context.security()).renameGroup(expectArg(args, 0, 'old'), expectArg(args, 1, 'new'))),
  'group:remove': async (context, args) => ok(context, (await context.security()).removeGroup(expectArg(args, 0, 'name'))),
  'group:set': async (context, args) => ok(context, (await context.security()).setGroupPermissions(expectArg(args, 0, 'name'), expectRest(args, 1, 'path'))),
  'group:add:user': async (context, args) => ok(context, (await context.security()).addGroupUsers(expectArg(args, 0, 'group'), [expectArg(args, 1, 'key')])),
  'group:remove:user': async (context, args) => ok(context, (await context.security()).removeGroupUsers(expectArg(args, 0, 'group'), [expectArg(args, 1, 'key')])),
  whitelist: async context => context.log(await (await context.security()).whitelistStatus()),
  'whitelist:enable': async context => ok(context, (await context.security()).enableWhitelist()),
  'whitelist:disable': async context => ok(context, (await context.security()).disableWhitelist()),
  'whitelist:add': async (context, args) => ok(context, (await context.security()).addWhitelistUsers(expectRest(args, 0, 'key'))),
  'whitelist:remove': async (context, args) => ok(context, (await context.security()).removeWhitelistUsers(expectRest(args, 0, 'key'))),
  'merge:status': async context => context.log(await (await context.hub()).mergeStatus()),
  'merge:add': async (context, args) => ok(context, (await context.hub()).mergeAdd(expectArg(args, 0, 'connection-or-address'))),
  'merge:remove': async (context, args) => ok(context, (await context.hub()).mergeRemove(expectArg(args, 0, 'connection-or-address'))),
  'proxy:add': async (context, args) => ok(context, (await context.hub()).proxyAdd(expectArg(args, 0, 'address'))),
  'proxy:remove': async (context, args) => ok(context, (await context.hub()).proxyRemove(expectArg(args, 0, 'address'))),
  'proxy:join': async context => context.log(await (await context.hub()).proxyJoin()),
  'proxy:call': async (context, args) => context.log(await (await context.hub()).proxyCall(expectArg(args, 0, 'proxy-name'), expectArg(args, 1, 'path'), parseJsonArg(args[2]))),
  'proxy:stream': async (context, args) => printStream(context, (await context.hub()).proxyStream(expectArg(args, 0, 'proxy-name'), expectArg(args, 1, 'path'), parseJsonArg(args[2]))),
  'storage:providers': async context => printStream(context, (await context.storage()).providers()),
  'storage:list': async (context, args) => context.log(await (await context.storage()).list(args[0] ?? '', context.options.context)),
  'storage:watch': async (context, args) => printStream(context, (await context.storage()).watchList(args[0] ?? '', context.options.context)),
  'storage:read': async (context, args) => context.log(await (await context.storage()).readUrl(expectArg(args, 0, 'path'), context.options.context)),
  'storage:read:directory': async (context, args) => context.log(await (await context.storage()).readDirectory(expectArg(args, 0, 'path'), context.options.context)),
  'storage:write': async (context, args) => context.log(await (await context.storage()).writeUrl(expectArg(args, 0, 'path'), context.options.context)),
  'storage:upload': async (context, args) => context.log(await (await context.storage()).uploadFile(expectArg(args, 0, 'local-file'), args[1], { context: context.options.context })),
  'storage:download': async (context, args) => {
    const remote = expectArg(args, 0, 'remote-path')
    context.log(await (await context.storage()).downloadToFile(remote, args[1] ?? basename(remote), { context: context.options.context }))
  },
  'storage:delete': async (context, args) => ok(context, (await context.storage()).delete(expectArg(args, 0, 'path'), context.options.context)),
  'storage:updated': async (context, args) => ok(context, (await context.storage()).updated(expectArg(args, 0, 'path'), context.options.context)),
}

export function parseExArguments(argv: string[]): ParsedExCommand {
  const { words, options } = extractOptions(argv)
  if (options.help && words.length === 0) return parsed('help', [], options)
  if (words[0] === 'help') return parsed('help', words.slice(1), options)
  if (options.help) return parsed('help', words, options)
  const routed = route(words)
  return parsed(routed.id, routed.args, options)
}

export async function runExCommand(argv: string[], env: ExEnvironment = {}): Promise<void> {
  const parsed = parseExArguments(argv)
  if (parsed.id === 'help') {
    const log = env.log ?? console.log
    log(formatHelp(parsed.args))
    return
  }

  const runner = commandRunners[parsed.id]
  if (!runner) throw new Error(`Command not implemented: ${parsed.id}`)
  const context = createContext(parsed.options, env)
  try {
    await runner(context, parsed.args)
  } finally {
    context.stop()
  }
}

export async function runExCli(argv: string[] = runtimeArgv(), env: ExEnvironment = {}): Promise<void> {
  await runExCommand(argv, env)
}

export function formatHelp(topics: string[] = []): string {
  const topic = topics.join(' ')
  const entries = topic ? helpEntries.filter(entry => entryMatchesTopic(entry, topic)) : helpEntries
  if (topic && entries.length === 0) throw new Error(`Unknown help topic: ${topic}`)

  const groups = Array.from(new Set(entries.map(entry => entry.group)))
  const lines = [
    'Usage: bun ex <command> [subcommand] [...args] [--json] [--service <id>] [--device]',
    '',
    `Groups: ${groups.join(', ')}`,
    '',
  ]

  for (const group of groups) {
    lines.push(`${group}:`)
    for (const entry of entries.filter(item => item.group === group)) {
      lines.push(`  ${entry.usage}`)
      lines.push(`    endpoint: ${entry.endpoint}`)
      lines.push(`    ${entry.description}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function createContext(options: ExCommandOptions, env: ExEnvironment): ExContext {
  const connections = env.connections ?? new BunFileConnectionStore()
  const keyStore = env.keyStore ?? defaultCliKeyStore()
  const hubKeys = env.hubKeys ?? new BunFileHubKeyStore()
  const device = options.device ? (env.device ?? new DeviceIdentity()) : undefined
  const log = env.log ?? console.log
  let client: HubRuntimeClient | undefined
  let hub: HubControl | undefined
  let launcher: LauncherControl | undefined
  let security: SecurityControl | undefined
  let devices: DeviceControl | undefined
  let storage: StorageControl | undefined
  let app: AppControl | undefined

  return {
    options,
    env,
    connections,
    keyStore,
    hubKeys,
    log(value: unknown) {
      log(formatValue(value, options.json))
    },
    async selectedAddress() {
      return new HubClient({ address: (await connections.selected())?.address }).address
    },
    async client() {
      if (!client) {
        const address = (await connections.selected())?.address
        client = env.createClient?.({ address, keyStore, hubKeys, device }) ?? new HubClient({ address, keyStore, hubKeys, device })
      }
      return client
    },
    async hub() {
      hub ??= new HubControl(await this.client())
      return hub
    },
    async launcher() {
      launcher ??= new LauncherControl(await this.client())
      return launcher
    },
    async security() {
      security ??= new SecurityControl(await this.client())
      return security
    },
    async devices() {
      devices ??= new DeviceControl(await this.client())
      return devices
    },
    async storage() {
      storage ??= new StorageControl(await this.client(), { fetch: env.fetch, onProgress: progress => this.log(progress) })
      return storage
    },
    async app() {
      app ??= new AppControl(await this.client())
      return app
    },
    stop() {
      client?.stop()
    },
  }
}

function extractOptions(argv: string[]): { words: string[]; options: ExCommandOptions } {
  const words: string[] = []
  const options: ExCommandOptions = { json: false, yes: false, end: false, help: false, device: false, keep: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') {
      options.json = true
    } else if (value === '--yes') {
      options.yes = true
    } else if (value === '--end') {
      options.end = true
    } else if (value === '--device') {
      options.device = true
    } else if (value === '--keep') {
      const key = argv[index + 1]
      if (!key) throw new Error('--keep requires value')
      options.keep.push(key)
      index += 1
    } else if (value === '--help' || value === '-h') {
      options.help = true
    } else if (value === '--service') {
      const service = argv[index + 1]
      if (!service) throw new Error('--service requires value')
      options.context = { service }
      index += 1
    } else if (value === '--pid') {
      options.pid = parseNumberArg(argv[index + 1], 'pid')
      index += 1
    } else if (value?.startsWith('-')) {
      throw new Error(`Unknown option: ${value}`)
    } else if (value !== undefined) {
      words.push(value)
    }
  }

  return { words, options }
}

function route(words: string[]): { id: string; args: string[] } {
  const [first, second, third, fourth] = words
  if (!first) return { id: 'help', args: [] }

  switch (first) {
    case 'add':
    case 'remove':
    case 'connections':
    case 'select':
    case 'selected':
    case 'api':
    case 'stream':
    case 'providers':
    case 'status':
    case 'badges':
    case 'processes':
    case 'apps':
    case 'groups':
      if (first === 'connections' && second === 'users') return { id: 'connections:users', args: words.slice(2) }
      return { id: first, args: words.slice(1) }
    case 'info':
      return { id: 'info', args: words.slice(1) }
    case 'devices':
      return second === 'pending' ? { id: 'devices:pending', args: words.slice(2) } : { id: 'devices', args: words.slice(1) }
    case 'device':
      if (second === 'approve' || second === 'rename' || second === 'remove' || second === 'revoke' || second === 'data') {
        return { id: `device:${second}`, args: words.slice(2) }
      }
      break
    case 'hubkey':
      return second === 'forget' ? { id: 'hubkey:forget', args: words.slice(2) } : { id: 'hubkey', args: words.slice(1) }
    case 'key':
      return second === 'reset' ? { id: 'key:reset', args: words.slice(2) } : { id: 'key', args: words.slice(1) }
    case 'call':
      if (second === 'pending') return { id: 'call:pending', args: words.slice(2) }
      if (second === 'allow') return { id: 'call:allow', args: words.slice(2) }
      if (second === 'revoke') return { id: 'call:revoke', args: words.slice(2) }
      if (second === 'allowed') return { id: 'call:allowed', args: words.slice(2) }
      return { id: 'call', args: words.slice(1) }
    case 'app':
      return { id: 'app', args: words.slice(1) }
    case 'launcher':
      if (!second) return { id: 'launcher', args: [] }
      if (second === 'stop') return { id: 'launcher:stop', args: words.slice(2) }
      if (second === 'update' && third === 'check') return { id: 'launcher:update:check', args: words.slice(3) }
      if (second === 'update') return { id: 'launcher:update', args: words.slice(2) }
      if (second === 'pro') return { id: 'launcher:pro', args: words.slice(2) }
      if (second === 'app') {
        if (third === 'start') return { id: 'launcher:app:start', args: words.slice(3) }
        if (third === 'stop') return { id: 'launcher:app:stop', args: words.slice(3) }
        if (third === 'restart') return { id: 'launcher:app:restart', args: words.slice(3) }
        if (third === 'uninstall') return { id: 'launcher:app:uninstall', args: words.slice(3) }
        if (third === 'cluster') return { id: 'launcher:app:cluster', args: words.slice(3) }
        if (third === 'settings') return { id: 'launcher:app:settings', args: words.slice(3) }
        if (third === 'create') return { id: 'launcher:app:create', args: words.slice(3) }
      }
      break
    case 'terminal':
      if (second === 'in') return { id: 'terminal:in', args: words.slice(2) }
      if (second === 'resize') return { id: 'terminal:resize', args: words.slice(2) }
      return { id: 'terminal', args: words.slice(1) }
    case 'host':
      if (second === 'pending') return { id: 'host:pending', args: words.slice(2) }
      if (second === 'allow') return { id: 'host:allow', args: words.slice(2) }
      if (second === 'revoke') return { id: 'host:revoke', args: words.slice(2) }
      if (second === 'allowed') return { id: 'host:allowed', args: words.slice(2) }
      break
    case 'group':
      if (second === 'names') return { id: 'group:names', args: words.slice(2) }
      if (second === 'create') return { id: 'group:create', args: words.slice(2) }
      if (second === 'rename') return { id: 'group:rename', args: words.slice(2) }
      if (second === 'remove' && third === 'user') return { id: 'group:remove:user', args: words.slice(3) }
      if (second === 'remove') return { id: 'group:remove', args: words.slice(2) }
      if (second === 'set') return { id: 'group:set', args: words.slice(2) }
      if (second === 'add' && third === 'user') return { id: 'group:add:user', args: words.slice(3) }
      break
    case 'whitelist':
      if (second === 'enable') return { id: 'whitelist:enable', args: words.slice(2) }
      if (second === 'disable') return { id: 'whitelist:disable', args: words.slice(2) }
      if (second === 'add') return { id: 'whitelist:add', args: words.slice(2) }
      if (second === 'remove') return { id: 'whitelist:remove', args: words.slice(2) }
      return { id: 'whitelist', args: words.slice(1) }
    case 'merge':
      return second === 'status' ? { id: 'merge:status', args: words.slice(2) } : { id: 'merge:add', args: words.slice(1) }
    case 'unmerge':
      return { id: 'merge:remove', args: words.slice(1) }
    case 'proxy':
      if (second === 'add') return { id: 'proxy:add', args: words.slice(2) }
      if (second === 'remove') return { id: 'proxy:remove', args: words.slice(2) }
      if (second === 'join') return { id: 'proxy:join', args: words.slice(2) }
      if (second === 'call') return { id: 'proxy:call', args: words.slice(2) }
      if (second === 'stream') return { id: 'proxy:stream', args: words.slice(2) }
      break
    case 'storage':
      if (second === 'providers') return { id: 'storage:providers', args: words.slice(2) }
      if (second === 'list') return { id: 'storage:list', args: words.slice(2) }
      if (second === 'watch') return { id: 'storage:watch', args: words.slice(2) }
      if (second === 'read' && third === 'directory') return { id: 'storage:read:directory', args: words.slice(3) }
      if (second === 'read') return { id: 'storage:read', args: words.slice(2) }
      if (second === 'write') return { id: 'storage:write', args: words.slice(2) }
      if (second === 'upload') return { id: 'storage:upload', args: words.slice(2) }
      if (second === 'download') return { id: 'storage:download', args: words.slice(2) }
      if (second === 'delete') return { id: 'storage:delete', args: words.slice(2) }
      if (second === 'updated') return { id: 'storage:updated', args: words.slice(2) }
      break
  }

  throw new Error(`Unknown command: ${[first, second, third, fourth].filter(Boolean).join(' ')}`)
}

function parsed(id: string, args: string[], options: ExCommandOptions): ParsedExCommand {
  return {
    id,
    args,
    options,
    help: helpById.get(id) ?? { id: 'help', group: 'help', usage: 'help [command]', endpoint: 'none', description: 'Print help.' },
  }
}

async function printStream(context: ExContext, values: AsyncIterable<unknown>): Promise<void> {
  for await (const value of values) context.log(value)
}

async function ok(context: ExContext, promise: Promise<unknown>): Promise<void> {
  await promise
  context.log('ok')
}

async function expectFound<T>(promise: Promise<T | undefined>, message: string): Promise<T> {
  const value = await promise
  if (value === undefined) throw new Error(message)
  return value
}

function expectArg(args: string[], index: number, name: string): string {
  const value = args[index]
  if (value === undefined || value === '') throw new Error(`Missing ${name}`)
  return value
}

function expectRest(args: string[], index: number, name: string): string[] {
  const values = args.slice(index).filter(Boolean)
  if (values.length === 0) throw new Error(`Missing ${name}`)
  return values
}

function parseJsonArg(value: string | undefined): unknown {
  if (value === undefined) return undefined
  return parseJsonRequired(value, 'json-body')
}

function parseJsonRequired(value: string | undefined, name: string): unknown {
  if (value === undefined) throw new Error(`Missing ${name}`)
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseNumberArg(value: string | undefined, name: string): number {
  const parsed = optionalNumberArg(value, name)
  if (parsed === undefined) throw new Error(`Missing ${name}`)
  return parsed
}

function optionalNumberArg(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${name}: ${value}`)
  return parsed
}

function formatValue(value: unknown, asJson: boolean): string {
  const normalized = normalizeForOutput(value)
  if (asJson) return JSON.stringify(normalized)
  if (typeof normalized === 'string') return normalized
  if (normalized === undefined) return 'ok'
  return JSON.stringify(normalized, null, 2)
}

function normalizeForOutput(value: unknown): unknown {
  if (value instanceof Set) return Array.from(value)
  if (Array.isArray(value)) return value.map(normalizeForOutput)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) output[key] = normalizeForOutput(item)
    return output
  }
  return value
}

function entryMatchesTopic(entry: HelpEntry, topic: string): boolean {
  return entry.id.replace(/:/g, ' ').startsWith(topic) || entry.usage.startsWith(topic) || entry.group === topic
}

function runtimeArgv(): string[] {
  const runtime = globalThis as typeof globalThis & { Bun?: { argv?: string[] } }
  return runtime.Bun?.argv?.slice(2) ?? []
}

function defaultCliKeyStore(): KeyStore {
  return createDefaultKeyStore()
}
