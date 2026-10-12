/**
 * Page spec: User Connections.
 *
 * Source reference:
 * - `Reference/Security/User connections.swift`
 *
 * How user gets here:
 * - Home -> selected hub section -> "Connections" card.
 * - Home shows card when current key has `hub/connections`.
 *
 * What page displays:
 * - List of services and other devices currently connected to selected hub.
 * - First section is explanatory placeholder:
 *   - Icon: wifi.
 *   - Title: "Connections".
 *   - Text: see all services and other devices connected to this Hub, assign
 *     them to permission groups.
 * - One row per user/device/service in users stream.
 *
 * Connection row display:
 * - Leading icon rendered by `IconView` from user icon data.
 * - Primary name line:
 *   - User/device/service name if non-empty.
 * - Secondary line:
 *   - Group name in red if user has group.
 *   - Separator dot.
 *   - Key suffix:
 *     - Last 8 characters plus "(You)" when key equals current hub key.
 *     - Last 8 characters otherwise.
 *   - "Unauthorized" if no key.
 *   - Separator + "<n> services" when services count > 0.
 *   - Separator + "<n> apps" when apps count > 0.
 * - Row is single-line clipped in reference.
 *
 * Row context menu:
 * - Available only when row has key and current key can manage groups.
 * - If group list is not empty, show "Set Group" menu with shield icon.
 *   - Contains one action per group.
 *   - Selecting group toggles assignment.
 * - If user already has group, show "Remove Group" with xmark.
 *
 * Assignment behavior:
 * - If selected group is already current group:
 *   - Send remove group for key/group.
 *   - Clear local row group.
 * - Otherwise:
 *   - Send add group for key/group.
 *   - Set local row group to selected group.
 *
 * Data/state needed:
 * - Users/connections stream.
 * - Group list stream.
 * - Current hub public key.
 * - Capability `hub.canManageGroups`.
 * - API wrappers for add/remove key group.
 *
 * Web port notes:
 * - Use row overflow menu for group assignment.
 * - Show full key on hover/copy affordance if space allows; primary display is
 *   last 8 characters like reference.
 *
 * Terminal port notes:
 * - Table columns: name, group, key suffix, services, apps, authorized.
 * - Commands: set-group <connection> <group>, remove-group <connection>.
 */
import { Button, CopyButton, HStack, StatusBadge, Table, Text } from '../../terminal'
import { Card, PageShell, Section } from '../shared'
import type { ClientHubUser, ClientPage, ClientPageState } from '../types'

type UserRow = ClientHubUser & {
  id: string
  displayName: string
  groupText: string
  keyText: string
  servicesText: string
  appsText: string
}

export const userConnectionsPage: ClientPage = {
  route: 'security/user-connections',
  title: 'User Connections',
  render(context) {
    const state = context.state
    const rows = userRows(state)

    return PageShell(this, context, [
      Section('Connections', [
        HStack([
          StatusBadge(`${rows.length} connected`, rows.length > 0 ? 'success' : 'muted'),
          StatusBadge(state.securityCanManageGroups ? 'Can assign groups' : 'Read only', state.securityCanManageGroups ? 'success' : 'muted'),
        ], { spacing: 1 }),
        Text('See services and devices connected to this Hub, then assign permission groups.').foregroundColor('secondary'),
        ...(state.securityNotice ? [Text(state.securityNotice).foregroundColor('green')] : []),
      ]),
      Section('Rows', rows.length > 0 ? [
        Table(rows, 'id', [
          { header: 'Name', width: { flexible: 1, min: 12 }, cell: 'displayName' },
          { header: 'Group', width: 12, cell: 'groupText' },
          { header: 'Key', width: 14, cell: 'keyText' },
          { header: 'Services', width: 8, cell: 'servicesText' },
          { header: 'Apps', width: 6, cell: 'appsText' },
        ]).frame({ maxWidth: -1 }),
        ...rows.map(row => userCard(state, row)),
      ] : [
        Text('No connected users or services.').foregroundColor('secondary'),
      ]),
    ])
  },
}

function userCard(state: ClientPageState, user: UserRow) {
  return Card(user.displayName, [
    Text(`${user.groupText} / ${user.keyText} / ${user.servicesText} / ${user.appsText}`).foregroundColor('secondary'),
    HStack([
      CopyButton('Copy Key', () => user.key ?? '', { disabled: !user.key, copiedLabel: 'Copied' }),
      groupMenuButton(state, user),
      ...(user.group ? [Button('Remove Group', () => removeGroup(state, user), { disabled: !state.securityCanManageGroups })] : []),
    ], { spacing: 1 }),
  ], [
    StatusBadge(user.key ? 'Authorized' : 'Unauthorized', user.key ? 'success' : 'danger'),
    ...(user.key === state.publicKey ? [StatusBadge('You', 'default')] : []),
  ])
}

function groupMenuButton(state: ClientPageState, user: UserRow) {
  const groups = state.permissionGroups ?? []
  return Button('Set Group', () => {
    state.securityNotice = `Open ${user.displayName} group menu with Space`
  }, { disabled: !user.key || !state.securityCanManageGroups || groups.length === 0 }).contextMenu(groups.map(group => ({
    label: user.group === group.name ? `Remove ${group.name}` : `Set ${group.name}`,
    action: () => {
      if (user.group === group.name) removeGroup(state, user)
      else setGroup(state, user, group.name)
    },
  })))
}

function userRows(state: ClientPageState): UserRow[] {
  const publicKey = state.publicKey
  return (state.users ?? []).map((user, index) => {
    const keyText = user.key ? `${keySuffix(user.key)}${user.key === publicKey ? ' (You)' : ''}` : 'Unauthorized'
    return {
      ...user,
      id: user.id ?? user.key ?? `user-${index}`,
      displayName: user.name || keyText,
      groupText: user.group ?? '-',
      keyText,
      servicesText: user.services ? String(user.services) : '-',
      appsText: user.apps ? String(user.apps) : '-',
    }
  })
}

function setGroup(state: ClientPageState, user: UserRow, group: string): void {
  state.users = (state.users ?? []).map(row => sameUser(row, user) ? { ...row, group } : row)
  state.securityNotice = `${user.displayName} assigned to ${group}`
}

function removeGroup(state: ClientPageState, user: UserRow): void {
  state.users = (state.users ?? []).map(row => sameUser(row, user) ? { ...row, group: undefined } : row)
  state.securityNotice = `${user.displayName} removed from group`
}

function sameUser(left: ClientHubUser, right: UserRow): boolean {
  return (left.id ?? left.key ?? left.name) === right.id || Boolean(left.key && left.key === right.key)
}

function keySuffix(key: string): string {
  return key.length > 8 ? key.slice(-8) : key
}
