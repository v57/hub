/**
 * Page spec: Lockdown.
 *
 * Source reference:
 * - `Reference/Security/Lockdown.swift`
 *
 * How user gets here:
 * - Home -> selected hub section -> "Lockdown" card.
 * - Home shows card when selected hub reports `canLockdown`.
 *
 * What page displays:
 * - Security page for maximum trust-list mode.
 * - List with top status section and one row per connected user/device/service.
 * - Numeric/content transitions animate count/status changes in reference.
 *
 * Top status section:
 * - Placeholder/card:
 *   - Icon: key.shield.fill.
 *   - Title: "Lockdown Mode".
 *   - Description: "Maximum Security".
 * - Body text:
 *   - Blocks any untrusted device or service from accessing hub.
 *   - User can still add keys in lockdown mode.
 *   - Every untrusted service will no longer connect.
 * - Toggle:
 *   - Label "Lockdown" hidden in reference visual.
 *   - Bound to whitelist enabled state.
 *   - On change, sends `hub.lockdown(SetLockdown(enabled: isEnabled))`.
 *   - Previous toggle task is cancelled when new toggle starts.
 *
 * User row display:
 * - Leading icon from user icon data.
 * - Trust status:
 *   - If user key exists in whitelist users, show blue checkmark icon.
 * - Primary row:
 *   - User name if non-empty.
 *   - Key suffix, with "(You)" if user key equals current hub key.
 *   - "Unauthorized" if no key.
 * - Secondary row:
 *   - "<n> services" when services count > 0.
 *   - "<n> apps" when apps count > 0.
 * - Trailing button when row has key:
 *   - "Trust" for untrusted user, blue filled style.
 *   - "Trusted" for trusted user, secondary style.
 *
 * User row actions:
 * - Trust button:
 *   - If trusted, sends lockdown update with `remove: [key]`.
 *   - If untrusted, sends lockdown update with `add: [key]`.
 * - Context menu:
 *   - If row has key, show "Group" menu.
 *   - One action per permission group.
 *   - Selecting group sends add key to group.
 *
 * Data/state needed:
 * - Users/connections stream.
 * - Group list stream.
 * - Whitelist/lockdown stream with `enabled` and trusted user keys.
 * - Current hub key.
 * - API for lockdown update and add key to group.
 *
 * Web port notes:
 * - Treat top toggle as high-risk security control. Show current state clearly.
 * - Do not hide trust/untrust result; update row immediately when stream changes.
 *
 * Terminal port notes:
 * - Header should show `Lockdown: on/off`.
 * - Commands: lockdown on, lockdown off, trust <connection>, untrust
 *   <connection>, set-group <connection> <group>.
 */
import { Button, HStack, StatusBadge, Table, Text, Toggle, type Binding } from '../../terminal'
import { Card, PageShell, Section } from '../shared'
import type { ClientHubUser, ClientPage, ClientPageState } from '../types'

type LockdownUserRow = ClientHubUser & {
  id: string
  displayName: string
  keyText: string
  trusted: boolean
  servicesText: string
  appsText: string
}

export const lockdownPage: ClientPage = {
  route: 'security/lockdown',
  title: 'Lockdown',
  render(context) {
    const state = context.state
    const rows = lockdownRows(state)
    const trustedCount = rows.filter(row => row.trusted).length

    return PageShell(this, context, [
      Section('Lockdown Mode', [
        HStack([
          StatusBadge(`Lockdown: ${state.lockdownEnabled ? 'on' : 'off'}`, state.lockdownEnabled ? 'danger' : 'muted'),
          StatusBadge(`${trustedCount} trusted`, trustedCount > 0 ? 'success' : 'muted'),
        ], { spacing: 1 }),
        Text('Blocks untrusted devices and services from accessing hub while still allowing keys to be added.', { wrap: true }).foregroundColor('secondary'),
        Toggle('Lockdown', lockdownBinding(state)),
        ...(state.securityNotice ? [Text(state.securityNotice).foregroundColor('green')] : []),
      ]),
      Section('Trusted Users', rows.length > 0 ? [
        Table(rows, 'id', [
          { header: 'Name', width: { flexible: 1, min: 12 }, cell: 'displayName' },
          { header: 'Key', width: 14, cell: 'keyText' },
          { header: 'Trusted', width: 8, cell: row => row.trusted ? 'yes' : 'no' },
          { header: 'Services', width: 8, cell: 'servicesText' },
          { header: 'Apps', width: 6, cell: 'appsText' },
        ]).frame({ maxWidth: -1 }),
        ...rows.map(row => lockdownUserCard(state, row)),
      ] : [
        Text('No connected users or services.').foregroundColor('secondary'),
      ]),
    ])
  },
}

function lockdownUserCard(state: ClientPageState, user: LockdownUserRow) {
  return Card(user.displayName, [
    Text(`${user.keyText} / ${user.servicesText} / ${user.appsText}`).foregroundColor('secondary'),
    HStack([
      Button(user.trusted ? 'Trusted' : 'Trust', () => toggleTrust(state, user), { disabled: !user.key }),
      groupMenuButton(state, user),
    ], { spacing: 1 }),
  ], [
    StatusBadge(user.trusted ? 'Trusted' : 'Untrusted', user.trusted ? 'success' : 'warning'),
    ...(user.key === state.publicKey ? [StatusBadge('You', 'default')] : []),
  ])
}

function groupMenuButton(state: ClientPageState, user: LockdownUserRow) {
  const groups = state.permissionGroups ?? []
  return Button('Group', () => {
    state.securityNotice = `Open ${user.displayName} group menu with Space`
  }, { disabled: !user.key || groups.length === 0 || !state.securityCanManageGroups }).contextMenu(groups.map(group => ({
    label: `Set ${group.name}`,
    action: () => {
      state.users = (state.users ?? []).map(row => sameUser(row, user) ? { ...row, group: group.name } : row)
      state.securityNotice = `${user.displayName} assigned to ${group.name}`
    },
  })))
}

function lockdownRows(state: ClientPageState): LockdownUserRow[] {
  const trusted = new Set(state.trustedKeys ?? [])
  const publicKey = state.publicKey
  return (state.users ?? []).map((user, index) => {
    const keyText = user.key ? `${keySuffix(user.key)}${user.key === publicKey ? ' (You)' : ''}` : 'Unauthorized'
    return {
      ...user,
      id: user.id ?? user.key ?? `user-${index}`,
      displayName: user.name || keyText,
      keyText,
      trusted: Boolean(user.key && trusted.has(user.key)),
      servicesText: user.services ? `${user.services} services` : '-',
      appsText: user.apps ? `${user.apps} apps` : '-',
    }
  })
}

function lockdownBinding(state: ClientPageState): Binding<boolean> {
  return {
    get: () => Boolean(state.lockdownEnabled),
    set(value) {
      state.lockdownEnabled = value
      state.securityNotice = `Lockdown ${value ? 'enabled' : 'disabled'}`
    },
  }
}

function toggleTrust(state: ClientPageState, user: LockdownUserRow): void {
  if (!user.key) {
    state.securityNotice = `${user.displayName} has no authorized key`
    return
  }
  const trusted = new Set(state.trustedKeys ?? [])
  if (trusted.has(user.key)) {
    trusted.delete(user.key)
    state.securityNotice = `${user.displayName} untrusted`
  } else {
    trusted.add(user.key)
    state.securityNotice = `${user.displayName} trusted`
  }
  state.trustedKeys = [...trusted]
}

function sameUser(left: ClientHubUser, right: LockdownUserRow): boolean {
  return (left.id ?? left.key ?? left.name) === right.id || Boolean(left.key && left.key === right.key)
}

function keySuffix(key: string): string {
  return key.length > 8 ? key.slice(-8) : key
}
