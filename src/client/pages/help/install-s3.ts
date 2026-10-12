/**
 * Page spec: Connect Storage / Install S3.
 *
 * Source reference:
 * - `Reference/Help/Install S3.swift`
 *
 * How user gets here:
 * - Home -> selected hub section -> "Files" when hub lacks storage but can
 *   install storage.
 * - Navigation title is "Connect Storage".
 * - Page is hub-scoped.
 *
 * Top-level flow:
 * - If `open` is true, show Hub file browser.
 * - Otherwise show one of three guide tabs:
 *   - "Local" (`Share`) for local directory storage via launcher.
 *   - "Cloud" (`Host`) for Wasabi cloud S3 setup wizard.
 *   - "Connect" (`Connect`) for manual S3-compatible provider setup.
 * - Bottom tab bar is visible only while cloud wizard step is 0.
 *
 * Local tab:
 * - Title: "Share your local directory".
 * - Text: "Install storage service from your Hub Launcher".
 * - Code-like block:
 *   - Title: "Shared Directory".
 *   - Icon: folder.
 *   - Path: `~/Hub/Files`.
 * - Secondary text: "Only this directory will be shared".
 * - Status/action logic:
 *   - If current key can already read files (`s3/read`), show "Test".
 *   - Test sends `s3/list`.
 *   - If test succeeds, status becomes "Open Files"; action opens file browser.
 *   - If test fails, stay in test state and show failure via state.
 *   - If key cannot read files but can create launcher apps
 *     (`launcher/app/create`) and no pending storage permission exists, show
 *     "Create"; sends launcher create for Local Storage app:
 *       name `Local Storage`, repo `v57/hub-s3-local`, active true,
 *       restarts true.
 *   - If pending S3 permission exists and current key can allow
 *     (`hub/host/update`), show "Allow"; sends host allow for pending key/paths.
 *   - If cannot create, show error: "You don't have permissions to install services".
 *   - If cannot allow, show error:
 *     "Ask hub owner to give access to Local Storage service".
 *
 * Cloud tab:
 * - Four-step Wasabi wizard using `step`.
 * - Step 0:
 *   - Title: "Wasabi Cloud Storage".
 *   - Static buttons/badges: "30 day trial", "$7 / TB / month".
 *   - Secondary note says Hub is not associated with Wasabi, Wasabi is believed
 *     cheapest S3 provider, user can suggest better in Discord.
 *   - Button: "Start".
 * - Step 1:
 *   - Title: "Create account".
 *   - Instructions: go to Wasabi website and create account, then login.
 *   - Buttons: Back, Continue.
 * - Step 2:
 *   - Title: "Create bucket".
 *   - Instructions: go to Buckets, click Create bucket, name bucket, select
 *     server, fill fields.
 *   - Inputs:
 *     - Bucket Name.
 *     - Server Region picker.
 *   - Continue enabled only when bucket name and region are selected.
 * - Step 3:
 *   - Title: "Create access key for your service".
 *   - Instructions: go to Access Keys, Create Access Key, Create, enter keys.
 *   - Inputs:
 *     - Access Key.
 *     - Secret Key.
 *   - Shows CreationButtons for create/update/test/allow.
 * - Region options:
 *   - Tokyo `ap-northeast-1`, endpoint `https://s3.ap-northeast-1.wasabisys.com`.
 *   - Osaka `ap-northeast-2`.
 *   - Singapore `ap-southeast-1`.
 *   - Sydney `ap-southeast-2`.
 *   - Toronto `ca-central-1`.
 *   - Amsterdam `eu-central-1`.
 *   - Frankfurt `eu-central-2`.
 *   - Milan `eu-south-1`.
 *   - United Kingdom `eu-west-1`.
 *   - Paris `eu-west-2`.
 *   - United Kingdom `eu-west-3`.
 *   - Texas `us-central-1`.
 *   - N. Virginia `us-east-1`, endpoint `https://s3.wasabisys.com`.
 *   - N. Virginia `us-east-2`.
 *   - Oregon `us-west-1`.
 *   - San Jose `us-west-2`.
 *   - All non-N. Virginia endpoints use `https://s3.<region>.wasabisys.com`.
 *
 * Manual Connect tab:
 * - Title: "Connect Manually".
 * - Text: connect to other S3 services like AWS, Azure, Google Cloud, etc.
 * - Inputs:
 *   - Endpoint.
 *   - Region (optional).
 *   - Bucket name.
 *   - Access Key.
 *   - Secret Key.
 * - Shows CreationButtons when required fields are filled.
 *
 * CreationButtons behavior:
 * - Builds launcher app settings:
 *   - Env:
 *     - `S3_ACCESS_KEY_ID`
 *     - `S3_ENDPOINT`
 *     - `S3_BUCKET`
 *     - optional `S3_REGION`
 *   - Secrets:
 *     - `S3_SECRET_ACCESS_KEY`
 * - If installer has pending permission, show "Allow Access"; allow pending
 *   key/paths.
 * - Else if storage app is installed, show "Test"; sends `s3/list` and shows
 *   green check or red x result.
 * - Always show "Update" when storage app already installed, otherwise "Create".
 * - Create installs launcher app:
 *   - name `S3 Storage`.
 *   - repo `v57/hub-s3`.
 *   - active true.
 *   - restarts true.
 *   - settings from form.
 * - Update sends app settings update for `S3 Storage`.
 * - Buttons are disabled/50 percent opacity when settings are incomplete.
 *
 * Installer streams/state:
 * - `launcher/info`: detect whether app named `S3 Storage` exists.
 * - `hub/status`: detect S3 service availability by service name starting
 *   with `S3 Storage`.
 * - `hub/host/pending`: detect pending permission with path starting `s3/`.
 *
 * Web port notes:
 * - Use wizard with clear step state and disabled buttons.
 * - Secret key fields must be password inputs.
 * - Preserve S3 env/secret names exactly.
 *
 * Terminal port notes:
 * - Use guided prompts for local/cloud/manual.
 * - For cloud flow, show step number and only ask fields required by step.
 * - Mask secret input.
 * - Commands: create-local, allow, test, create-s3, update-s3, open-files.
 */
import { Button, CopyButton, HStack, Picker, StatusBadge, TabBar, Text, TextField, VStack, type ViewNode } from '../../terminal'
import { Card, PageShell, Section, stateBinding } from '../shared'
import type { ClientPage, ClientPageState, ClientStorageFileEntry, ClientStorageTab } from '../types'

type WasabiRegion = {
  label: string
  region: string
  endpoint: string
}

const storageTabs: ClientStorageTab[] = ['Local', 'Cloud', 'Connect']

const wasabiRegions: WasabiRegion[] = [
  region('Tokyo', 'ap-northeast-1'),
  region('Osaka', 'ap-northeast-2'),
  region('Singapore', 'ap-southeast-1'),
  region('Sydney', 'ap-southeast-2'),
  region('Toronto', 'ca-central-1'),
  region('Amsterdam', 'eu-central-1'),
  region('Frankfurt', 'eu-central-2'),
  region('Milan', 'eu-south-1'),
  region('United Kingdom', 'eu-west-1'),
  region('Paris', 'eu-west-2'),
  region('United Kingdom 3', 'eu-west-3'),
  region('Texas', 'us-central-1'),
  { label: 'N. Virginia', region: 'us-east-1', endpoint: 'https://s3.wasabisys.com' },
  region('N. Virginia 2', 'us-east-2'),
  region('Oregon', 'us-west-1'),
  region('San Jose', 'us-west-2'),
]

export const installS3Page: ClientPage = {
  route: 'help/install-s3',
  title: 'Connect Storage',
  render(context) {
    const state = context.state

    if (state.storageOpen) {
      return PageShell(this, context, [
        fileBrowserSection(state),
      ])
    }

    const tab = state.storageTab ?? 'Local'
    return PageShell(this, context, [
      Section('Storage Modes', [
        TabBar(storageTabs, stateBinding(state, 'storageTab', 'Local')),
        HStack([
          StatusBadge(state.storageCanRead ? 'Read allowed' : 'Read locked', state.storageCanRead ? 'success' : 'muted'),
          StatusBadge(state.storageAppInstalled ? 'S3 Storage installed' : 'No storage app', state.storageAppInstalled ? 'success' : 'muted'),
          ...(state.storagePendingPermission ? [StatusBadge('Permission pending', 'warning')] : []),
        ], { spacing: 1 }),
        ...(state.storageNotice ? [Text(state.storageNotice).foregroundColor(state.storageTestStatus === 'failed' ? 'red' : 'green')] : []),
      ]),
      tab === 'Local' ? localStorageSection(state) : tab === 'Cloud' ? cloudStorageSection(state) : manualStorageSection(state),
    ])
  },
}

function localStorageSection(state: ClientPageState): ViewNode {
  return Section('Share your local directory', [
    Text('Install storage service from your Hub Launcher.').foregroundColor('secondary'),
    Card('Shared Directory', [
      Text(state.storagePath ?? '~/Hub/Files').foregroundColor('cyan'),
      Text('Only this directory will be shared.').foregroundColor('secondary'),
    ], [StatusBadge('folder', 'default')]),
    HStack(localStorageActions(state), { spacing: 1 }),
    permissionHint(state),
  ])
}

function localStorageActions(state: ClientPageState): ViewNode[] {
  if (state.storageCanRead) {
    return [
      Button(state.storageTestStatus === 'ok' ? 'Open Files' : 'Test', () => {
        if (state.storageTestStatus === 'ok') openFiles(state)
        else testStorage(state)
      }),
    ]
  }

  if (state.storagePendingPermission) {
    return [
      Button('Allow', () => allowPendingStorage(state), { disabled: !state.storageCanAllowPending }),
    ]
  }

  if (state.storageCanCreateLauncherApp) {
    return [
      Button('Create', () => createLocalStorage(state)),
    ]
  }

  return [
    Button('Create', () => {}, { disabled: true }),
  ]
}

function cloudStorageSection(state: ClientPageState): ViewNode {
  const step = Math.max(0, Math.min(3, state.storageCloudStep ?? 0))
  return Section('Wasabi Cloud Storage', [
    HStack([
      StatusBadge(`Step ${step + 1}/4`, 'default'),
      StatusBadge('30 day trial', 'success'),
      StatusBadge('$7 / TB / month', 'muted'),
    ], { spacing: 1 }),
    ...(step === 0 ? cloudIntroStep(state) : step === 1 ? cloudAccountStep(state) : step === 2 ? cloudBucketStep(state) : cloudKeysStep(state)),
  ])
}

function cloudIntroStep(state: ClientPageState): ViewNode[] {
  return [
    Text('Wasabi is an S3-compatible provider. Hub is not associated with Wasabi.', { wrap: true }).foregroundColor('secondary'),
    Button('Start', () => {
      state.storageCloudStep = 1
      state.storageNotice = 'Cloud setup started'
    }),
  ]
}

function cloudAccountStep(state: ClientPageState): ViewNode[] {
  return [
    Text('Create a Wasabi account, then log in to continue.').foregroundColor('secondary'),
    HStack([
      Button('Back', () => { state.storageCloudStep = 0 }),
      Button('Continue', () => { state.storageCloudStep = 2 }),
    ], { spacing: 1 }),
  ]
}

function cloudBucketStep(state: ClientPageState): ViewNode[] {
  const regionCodes = wasabiRegions.map(item => item.region)
  const selected = selectedRegion(state)
  const ready = Boolean((state.s3BucketName ?? '').trim() && selected)
  return [
    Text('Create a bucket, choose a server region, then fill both fields here.').foregroundColor('secondary'),
    Text('Bucket Name').fontWeight('bold'),
    TextField(stateBinding(state, 's3BucketName', ''), { placeholder: 'hub-files' }).frame({ maxWidth: -1 }),
    Picker('Server Region', regionCodes, stateBinding(state, 's3Region', wasabiRegions[0]!.region)),
    Text(selected ? `${selected.label} / ${selected.endpoint}` : 'Select a region.').foregroundColor(selected ? 'secondary' : 'red'),
    HStack([
      Button('Back', () => { state.storageCloudStep = 1 }),
      Button('Continue', () => { state.storageCloudStep = 3 }, { disabled: !ready }),
    ], { spacing: 1 }),
  ]
}

function cloudKeysStep(state: ClientPageState): ViewNode[] {
  const selected = selectedRegion(state) ?? wasabiRegions[0]!
  return [
    Text('Create an access key for this service, then enter the key pair.').foregroundColor('secondary'),
    Text('Access Key').fontWeight('bold'),
    TextField(stateBinding(state, 's3AccessKey', ''), { placeholder: 'Access key' }).frame({ maxWidth: -1 }),
    Text('Secret Key').fontWeight('bold'),
    TextField(stateBinding(state, 's3SecretKey', ''), { placeholder: 'Secret key', secure: true }).frame({ maxWidth: -1 }),
    Card('Settings Preview', settingsRows({
      endpoint: selected.endpoint,
      region: selected.region,
      bucket: state.s3BucketName ?? '',
      accessKey: state.s3AccessKey ?? '',
      secretKey: state.s3SecretKey ?? '',
    })),
    HStack([
      Button('Back', () => { state.storageCloudStep = 2 }),
      ...creationButtons(state, {
        endpoint: selected.endpoint,
        region: selected.region,
        bucket: state.s3BucketName ?? '',
        accessKey: state.s3AccessKey ?? '',
        secretKey: state.s3SecretKey ?? '',
      }),
    ], { spacing: 1 }),
  ]
}

function manualStorageSection(state: ClientPageState): ViewNode {
  const config = {
    endpoint: state.s3Endpoint ?? '',
    region: state.s3ManualRegion ?? '',
    bucket: state.s3BucketName ?? '',
    accessKey: state.s3AccessKey ?? '',
    secretKey: state.s3SecretKey ?? '',
  }
  return Section('Connect Manually', [
    Text('Connect to AWS, Azure, Google Cloud, MinIO, or another S3-compatible provider.').foregroundColor('secondary'),
    Text('Endpoint').fontWeight('bold'),
    TextField(stateBinding(state, 's3Endpoint', ''), { placeholder: 'https://s3.example.com' }).frame({ maxWidth: -1 }),
    Text('Region (optional)').fontWeight('bold'),
    TextField(stateBinding(state, 's3ManualRegion', ''), { placeholder: 'us-east-1' }).frame({ maxWidth: -1 }),
    Text('Bucket name').fontWeight('bold'),
    TextField(stateBinding(state, 's3BucketName', ''), { placeholder: 'hub-files' }).frame({ maxWidth: -1 }),
    Text('Access Key').fontWeight('bold'),
    TextField(stateBinding(state, 's3AccessKey', ''), { placeholder: 'Access key' }).frame({ maxWidth: -1 }),
    Text('Secret Key').fontWeight('bold'),
    TextField(stateBinding(state, 's3SecretKey', ''), { placeholder: 'Secret key', secure: true }).frame({ maxWidth: -1 }),
    Card('Settings Preview', settingsRows(config)),
    HStack(creationButtons(state, config), { spacing: 1 }),
  ])
}

function creationButtons(state: ClientPageState, config: S3Config): ViewNode[] {
  const ready = s3ConfigReady(config)
  const buttons: ViewNode[] = []
  if (state.storagePendingPermission) {
    buttons.push(Button('Allow Access', () => allowPendingStorage(state), { disabled: !state.storageCanAllowPending }))
  }
  if (state.storageAppInstalled) {
    buttons.push(Button('Test', () => testStorage(state), { disabled: !ready }))
    buttons.push(Button('Update', () => saveS3Storage(state, config, 'updated'), { disabled: !ready }))
  } else {
    buttons.push(Button('Create', () => saveS3Storage(state, config, 'created'), { disabled: !ready }))
  }
  return buttons
}

type S3Config = {
  endpoint: string
  region?: string
  bucket: string
  accessKey: string
  secretKey: string
}

function settingsRows(config: S3Config): ViewNode[] {
  return [
    Text(`S3_ENDPOINT=${config.endpoint || '-'}`),
    Text(`S3_BUCKET=${config.bucket || '-'}`),
    Text(`S3_REGION=${config.region || '(optional)'}`),
    Text(`S3_ACCESS_KEY_ID=${config.accessKey ? maskMiddle(config.accessKey) : '-'}`),
    Text(`S3_SECRET_ACCESS_KEY=${config.secretKey ? '********' : '-'}`),
  ]
}

function fileBrowserSection(state: ClientPageState): ViewNode {
  const files = state.storageFiles ?? []
  return Section('Open Files', [
    HStack([
      StatusBadge(state.storagePath ?? '~/Hub/Files', 'default'),
      Button('Close Files', () => {
        state.storageOpen = false
        state.storageNotice = 'Storage setup reopened'
      }),
    ], { spacing: 1 }),
    ...(files.length > 0
      ? files.map(fileRow)
      : [
          Text('No files returned yet.').foregroundColor('secondary'),
          Text('Use Test after a provider is connected to refresh storage state.').foregroundColor('secondary'),
        ]),
  ])
}

function fileRow(file: ClientStorageFileEntry): ViewNode {
  const prefix = file.kind === 'directory' ? '[DIR]' : '[FILE]'
  const size = file.kind === 'file' && file.size !== undefined ? ` ${formatBytes(file.size)}` : ''
  const modified = file.lastModified ? ` ${file.lastModified}` : ''
  return Text(`${prefix} ${file.name}${size}${modified}`)
}

function permissionHint(state: ClientPageState): ViewNode {
  if (state.storageCanRead) return Text('Current key can read storage.').foregroundColor('secondary')
  if (state.storagePendingPermission && !state.storageCanAllowPending) return Text('Ask hub owner to give access to Local Storage service.').foregroundColor('red')
  if (!state.storageCanCreateLauncherApp && !state.storagePendingPermission) return Text("You don't have permissions to install services.").foregroundColor('red')
  return Text('Create installs Local Storage; Allow grants pending storage paths.').foregroundColor('secondary')
}

function createLocalStorage(state: ClientPageState): void {
  state.storageAppInstalled = true
  state.storageAppName = 'Local Storage'
  state.storageNotice = 'Local Storage create action prepared'
}

function allowPendingStorage(state: ClientPageState): void {
  const pending = state.storagePendingPermission
  if (!pending || !state.storageCanAllowPending) {
    state.storageTestStatus = 'failed'
    state.storageNotice = 'Storage permission cannot be allowed by this key'
    return
  }
  state.storagePendingPermission = undefined
  state.storageCanRead = true
  state.storageNotice = `${pending.name ?? pending.key} allowed for ${pending.paths.join(', ')}`
}

function testStorage(state: ClientPageState): void {
  if (!state.storageCanRead && !state.storageAppInstalled) {
    state.storageTestStatus = 'failed'
    state.storageNotice = 'Storage test failed: provider is not installed or allowed'
    return
  }
  state.storageTestStatus = 'ok'
  state.storageCanRead = true
  state.storageNotice = 'Storage read test passed. Open Files is available.'
}

function openFiles(state: ClientPageState): void {
  state.storageOpen = true
  state.storageNotice = 'Files opened'
}

function saveS3Storage(state: ClientPageState, config: S3Config, verb: 'created' | 'updated'): void {
  if (!s3ConfigReady(config)) {
    state.storageTestStatus = 'failed'
    state.storageNotice = 'Storage settings are incomplete'
    return
  }
  state.storageAppInstalled = true
  state.storageAppName = 'S3 Storage'
  state.storageNotice = `S3 Storage ${verb} for ${config.bucket}`
}

function s3ConfigReady(config: S3Config): boolean {
  return Boolean(config.endpoint.trim() && config.bucket.trim() && config.accessKey.trim() && config.secretKey.trim())
}

function selectedRegion(state: ClientPageState): WasabiRegion | undefined {
  return wasabiRegions.find(item => item.region === state.s3Region)
}

function region(label: string, regionName: string): WasabiRegion {
  return {
    label,
    region: regionName,
    endpoint: `https://s3.${regionName}.wasabisys.com`,
  }
}

function maskMiddle(value: string): string {
  if (value.length <= 6) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}...${value.slice(-3)}`
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${Math.round(value / (1024 * 1024))} MB`
}
