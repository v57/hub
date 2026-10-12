/**
 * Page spec: Security Requests / Pending List.
 *
 * Source reference:
 * - `Reference/Security/Pending list.swift`
 *
 * How user gets here:
 * - Home -> selected hub section -> "Requests" card.
 * - Home shows this card only when security badge count is > 0 and current key
 *   has `hub/host/pending`.
 *
 * What page displays:
 * - List of services/devices asking permission to join or create Hub APIs.
 * - First section is explanatory placeholder:
 *   - Icon: shield.
 *   - Title: "Requests".
 *   - Text explains services cannot join without permission, allowing a service
 *     only grants requested APIs, new APIs require another request, and reference
 *     currently has no decline or revoke flow.
 * - One row per `hostPending.list` item.
 *
 * Pending row display:
 * - Primary text: pending item name.
 * - Secondary/code text: pending item id/key.
 * - Row is limited to two lines in reference.
 * - If current hub host can manage, show "Allow" button on row trailing side.
 *
 * Actions:
 * - "Allow" sends host allow with:
 *   - key: pending item id.
 *   - paths: pending item pending paths.
 * - No decline action in reference.
 * - No revoke action in reference.
 *
 * Data/state needed:
 * - `hub/host/pending` stream/list.
 * - Host management capability (`hub.host.canManage`).
 *
 * Web port notes:
 * - Show requested API paths if available; Swift row only shows name/id, but
 *   port should expose paths because this page is security-critical.
 * - Keep absence of decline/revoke explicit in implementation notes or disabled
 *   controls if product still lacks endpoints.
 *
 * Terminal port notes:
 * - Table columns: name, key suffix/full key, requested paths.
 * - Command: allow <request>.
 * - Do not invent decline/revoke commands unless backend adds support.
 */
import { Button, HStack, StatusBadge, Table, Text } from '../../terminal'
import { Card, PageShell, Section } from '../shared'
import type { ClientPage, ClientPageState, ClientPendingPermission } from '../types'

type PendingRow = ClientPendingPermission & {
  id: string
  displayName: string
  pathText: string
}

export const pendingListPage: ClientPage = {
  route: 'security/pending-list',
  title: 'Security Requests',
  render(context) {
    const state = context.state
    const hostRows = pendingRows(state.hostPending ?? [])
    const callRows = pendingRows(state.callPending ?? [])
    const total = hostRows.length + callRows.length

    return PageShell(this, context, [
      Section('Requests', [
        HStack([
          StatusBadge(`${total} pending`, total > 0 ? 'warning' : 'success'),
          StatusBadge(state.securityCanManageHost ? 'Can allow' : 'Read only', state.securityCanManageHost ? 'success' : 'muted'),
        ], { spacing: 1 }),
        Text('Services cannot join or create Hub APIs until requested paths are allowed.', { wrap: true }).foregroundColor('secondary'),
        ...(state.securityNotice ? [Text(state.securityNotice).foregroundColor('green')] : []),
      ]),
      pendingSection('Host Pending', hostRows, state, 'host'),
      pendingSection('Call Pending', callRows, state, 'call'),
    ])
  },
}

function pendingSection(title: string, rows: PendingRow[], state: ClientPageState, kind: 'host' | 'call') {
  return Section(title, rows.length > 0 ? [
    Table(rows, 'id', [
      { header: 'Name', width: { flexible: 1, min: 12 }, cell: 'displayName' },
      { header: 'Key', width: { flexible: 1, min: 16 }, cell: 'key' },
      { header: 'Requested paths', width: { flexible: 2, min: 20 }, cell: 'pathText' },
    ]).frame({ maxWidth: -1 }),
    ...rows.map(row => pendingCard(state, row, kind)),
  ] : [
    Text('No requests.').foregroundColor('secondary'),
  ])
}

function pendingCard(state: ClientPageState, row: PendingRow, kind: 'host' | 'call') {
  return Card(row.displayName, [
    Text(row.key).foregroundColor('secondary'),
    Text(row.pathText).foregroundColor('secondary'),
    HStack([
      Button('Allow', () => allowPending(state, row, kind), { disabled: !state.securityCanManageHost }),
      Button('Decline', () => {}, { disabled: true, role: 'destructive' }),
    ], { spacing: 1 }),
  ], [StatusBadge(kind === 'host' ? 'Host' : 'Call', kind === 'host' ? 'default' : 'warning')])
}

function pendingRows(items: ClientPendingPermission[]): PendingRow[] {
  return items.map(item => ({
    ...item,
    id: item.key,
    displayName: item.name || keySuffix(item.key),
    pathText: item.paths.length > 0 ? item.paths.join(', ') : '-',
  }))
}

function allowPending(state: ClientPageState, row: PendingRow, kind: 'host' | 'call'): void {
  if (!state.securityCanManageHost) {
    state.securityNotice = 'Current key cannot allow security requests'
    return
  }
  if (kind === 'host') state.hostPending = (state.hostPending ?? []).filter(item => item.key !== row.key)
  else state.callPending = (state.callPending ?? []).filter(item => item.key !== row.key)
  state.securityNotice = `${row.displayName} allowed for ${row.pathText}`
}

function keySuffix(key: string): string {
  return key.length > 8 ? key.slice(-8) : key
}
