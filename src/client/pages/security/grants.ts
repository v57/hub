/**
 * Page spec: Grants.
 *
 * Source reference:
 * - `Docs/Devices/device-layer.md` section 12, `Docs/Devices/protocol.md` sections 6-7.
 *
 * How user gets here:
 * - Home -> Security -> "Grants"; Security Mode -> "Grants".
 * - `hub client grants`.
 *
 * What page displays:
 * - Table of `hub/grants`: subject (everyone, a group, a device or a key, with
 *   device and group names resolved), object (a path, a prefix shown as
 *   `prefix*`, or a share), who granted it and when.
 * - Selected grant card with "Remove".
 * - Add Grant form:
 *   - Subject picker: Everyone / Group / Device / Key, plus a value field that
 *     takes a group or device name or id, or a key.
 *   - Object picker: Path / Prefix / Share, plus a value field.
 *   - Known device and group names are listed under the form.
 *
 * Actions (owners):
 * - "Add" sends `hub/grant/add { subject, object }`.
 * - "Remove" sends `hub/grant/remove { id }`.
 *
 * Data/state needed:
 * - `hub/grants` stream; `hub/devices` and `hub/groups` to show names.
 */
import type { HubGrant, HubGrantObject, HubGrantSubject } from '../../../hub'
import { Button, HStack, Picker, StatusBadge, Table, Text, TextField } from '../../terminal'
import { errorMessage, runAction, watchInto } from '../live'
import { Card, PageShell, Section, stateBinding } from '../shared'
import type { ClientGrantObjectKind, ClientGrantSubjectKind, ClientPage, ClientPageState } from '../types'
import { watchGroupsInto } from './groups'
import { objectLabel, subjectLabel } from './labels'

const subjectKinds: ClientGrantSubjectKind[] = ['Everyone', 'Group', 'Device', 'Key']
const objectKinds: ClientGrantObjectKind[] = ['Path', 'Prefix', 'Share']

type GrantRow = HubGrant & { subjectText: string; objectText: string; byText: string; atText: string }

export const grantsPage: ClientPage = {
  route: 'security/grants',
  title: 'Grants',
  render(context) {
    const state = context.state
    const rows = grantRows(state)
    const selected = rows.find(row => row.id === state.selectedGrantId) ?? rows[0]
    const draft = draftGrant(state)

    return PageShell(this, context, [
      Section('Grants', [
        HStack([
          StatusBadge(`${rows.length} grants`, rows.length > 0 ? 'success' : 'muted'),
          ...(state.securityMode ? [StatusBadge(state.securityMode.mode, state.securityMode.mode === 'default-deny' ? 'success' : 'warning')] : []),
          ...(state.live ? [] : [StatusBadge('Not connected', 'muted')]),
        ], { spacing: 1 }),
        Text('A grant lets a key, a device, a group or everyone call a path, every path under a prefix, or reach a network share.', { wrap: true }).foregroundColor('secondary'),
        ...(state.securityNotice ? [Text(state.securityNotice).foregroundColor(state.securityNotice.startsWith('Failed') ? 'red' : 'green')] : []),
      ]),
      Section('All Grants', rows.length > 0 ? [
        Table(rows, 'id', [
          { header: 'Subject', width: { flexible: 1, min: 14 }, cell: 'subjectText' },
          { header: 'Object', width: { flexible: 1, min: 14 }, cell: 'objectText' },
          { header: 'By', width: 10, cell: 'byText' },
          { header: 'At', width: 20, cell: 'atText' },
        ], {
          selection: stateBinding(state, 'selectedGrantId', selected?.id ?? ''),
          onActivate: row => {
            state.selectedGrantId = row.id
          },
        }).frame({ maxWidth: -1 }),
        ...(selected ? [Card(`${selected.subjectText} → ${selected.objectText}`, [
          Button('Remove', () => removeGrant(state, selected), { disabled: !state.live, role: 'destructive' }),
        ])] : []),
      ] : [Text('No grants.').foregroundColor('secondary')]),
      Section('Add Grant', [
        HStack([
          Picker('Subject', subjectKinds, stateBinding(state, 'grantSubjectKind', 'Group')),
          ...(state.grantSubjectKind === 'Everyone' ? [] : [
            TextField(stateBinding(state, 'grantSubjectValue', ''), { placeholder: subjectPlaceholder(state.grantSubjectKind) }).frame({ maxWidth: -1 }),
          ]),
        ], { spacing: 1 }),
        HStack([
          Picker('Object', objectKinds, stateBinding(state, 'grantObjectKind', 'Path')),
          TextField(stateBinding(state, 'grantObjectValue', ''), { placeholder: objectPlaceholder(state.grantObjectKind) }).frame({ maxWidth: -1 }),
        ], { spacing: 1 }),
        Button('Add', () => addGrant(state), { disabled: !state.live || !draft }),
        ...knownNames(state),
      ]),
    ]).task(state.live ? 'grants-live' : 'grants-offline', async task => {
      const live = state.live
      if (!live) return
      await Promise.all([
        watchInto(state, task, live.security.watchGrants(), grants => {
          state.grants = grants
        }, error => {
          state.securityNotice = `Failed to load grants: ${errorMessage(error)}`
        }),
        watchInto(state, task, live.devices.watchDevices(), devices => {
          state.devices = devices
        }),
        watchGroupsInto(state, task, live),
      ])
    })
  },
}

function grantRows(state: ClientPageState): GrantRow[] {
  return (state.grants ?? []).map(grant => ({
    ...grant,
    subjectText: subjectLabel(state, grant.subject),
    objectText: objectLabel(grant.object),
    byText: grant.by ? `…${grant.by.slice(-8)}` : '-',
    atText: grant.at ?? '-',
  }))
}

/** The subject and object the form describes, or undefined while incomplete. */
export function draftGrant(state: ClientPageState): { subject: HubGrantSubject; object: HubGrantObject } | undefined {
  const value = (state.grantSubjectValue ?? '').trim()
  const target = (state.grantObjectValue ?? '').trim()
  if (!target) return undefined
  let subject: HubGrantSubject
  switch (state.grantSubjectKind ?? 'Group') {
    case 'Everyone':
      subject = { everyone: true }
      break
    case 'Group': {
      if (!value) return undefined
      const group = state.permissionGroups?.find(item => item.name === value || item.id === value)
      subject = { group: group?.id ?? group?.name ?? value }
      break
    }
    case 'Device': {
      if (!value) return undefined
      const lower = value.toLowerCase()
      const device = state.devices?.find(item => item.id === value || item.name.toLowerCase() === lower)
      subject = { device: device?.id ?? value }
      break
    }
    case 'Key':
      if (!value) return undefined
      subject = { key: value }
      break
  }
  const kind = state.grantObjectKind ?? 'Path'
  const object: HubGrantObject = kind === 'Prefix' ? { prefix: target } : kind === 'Share' ? { share: target } : { path: target }
  return { subject, object }
}

function addGrant(state: ClientPageState): void {
  const live = state.live
  const draft = draftGrant(state)
  if (!live || !draft) return
  runAction(state, message => (state.securityNotice = message), () => live.security.addGrant(draft.subject, draft.object),
    `Granted ${objectLabel(draft.object)} to ${subjectLabel(state, draft.subject)}`, () => {
      state.grantSubjectValue = ''
      state.grantObjectValue = ''
    })
}

function removeGrant(state: ClientPageState, grant: GrantRow): void {
  const live = state.live
  if (!live) return
  runAction(state, message => (state.securityNotice = message), () => live.security.removeGrant(grant.id), `Removed ${grant.subjectText} → ${grant.objectText}`, () => {
    state.grants = (state.grants ?? []).filter(item => item.id !== grant.id)
    state.selectedGrantId = undefined
  })
}

function subjectPlaceholder(kind: ClientGrantSubjectKind | undefined): string {
  if (kind === 'Device') return 'Device name or id'
  if (kind === 'Key') return 'Public key (SPKI base64)'
  return 'Group name'
}

function objectPlaceholder(kind: ClientGrantObjectKind | undefined): string {
  if (kind === 'Prefix') return 'Path prefix, like s3/'
  if (kind === 'Share') return 'Share resource id'
  return 'Path, like s3/read'
}

function knownNames(state: ClientPageState) {
  const lines: string[] = []
  if (state.grantSubjectKind === 'Device' && (state.devices ?? []).length > 0) {
    lines.push(`Devices: ${(state.devices ?? []).map(device => device.name).join(', ')}`)
  }
  if (state.grantSubjectKind === 'Group' && (state.permissionGroups ?? []).length > 0) {
    lines.push(`Groups: ${(state.permissionGroups ?? []).map(group => group.name).join(', ')}`)
  }
  return lines.map(line => Text(line, { wrap: true }).foregroundColor('secondary'))
}
