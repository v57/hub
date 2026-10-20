/**
 * Page spec: Groups.
 *
 * Source reference:
 * - `Docs/Devices/device-layer.md` sections 3 and 14 (phase 5), `Docs/Devices/protocol.md` section 9.
 *
 * How user gets here:
 * - Home -> Security -> "Groups".
 * - `hub client groups`.
 *
 * What page displays:
 * - Groups from `hub/group/list`; person groups (a person's devices and keys)
 *   carry a "Person" badge. The built-in `owners` group is listed like the rest.
 * - Members of each group from `hub/group/users`: `device:<id>` shown with the
 *   device name, `key:<SPKI>` (or a plain SPKI from older stores) shown as a key.
 * - Selected group card: its members with "Remove" each, a device picker with
 *   "Add Device", a key field with "Add Key", and "Delete Group".
 * - Device Memberships: every device with all groups it belongs to; a device
 *   can be in any number of groups.
 * - Create Group: name, "Person" toggle, "Create".
 *
 * Data/state needed:
 * - `hub/groups` (owners first, with person flag and `key:`/`device:` members);
 *   hubs without it fall back to `hub/group/list` plus `hub/group/users`.
 *
 * Actions (owners):
 * - Create: `hub/group/create` with the name, or `{ name, person: true }`.
 * - Add/remove member: `hub/group/update/users { group, add | remove }`.
 * - Delete: `hub/group/remove`.
 * - What a group may call is set with grants (`security/grants`); the older
 *   per-group path lists stay on Permission Groups.
 */
import { formatGroupMember, parseGroupMember, type HubDevice } from '../../../hub'
import { Button, HStack, Picker, StatusBadge, Table, Text, TextField, Toggle, type ViewNode } from '../../terminal'
import { errorMessage, runAction, watchInto } from '../live'
import { Card, PageShell, RouteLink, Section, stateBinding } from '../shared'
import type { TaskContext } from '../../terminal'
import type { ClientLive, ClientPage, ClientPageState, ClientPermissionGroup } from '../types'
import { deviceLabel, memberLabel } from './labels'

type GroupRow = ClientPermissionGroup & { id: string; kindText: string; membersText: string }

export const groupsPage: ClientPage = {
  route: 'security/groups',
  title: 'Groups',
  render(context) {
    const state = context.state
    const rows = groupRows(state)
    const selected = rows.find(row => row.id === state.selectedGroupId) ?? rows[0]

    return PageShell(this, context, [
      Section('Groups', [
        HStack([
          StatusBadge(`${rows.length} groups`, rows.length > 0 ? 'success' : 'muted'),
          ...(state.live ? [] : [StatusBadge('Not connected', 'muted')]),
        ], { spacing: 1 }),
        Text('Groups hold devices and keys. A device can be in several groups; a person group stands for one person.', { wrap: true }).foregroundColor('secondary'),
        ...(state.securityNotice ? [Text(state.securityNotice).foregroundColor(state.securityNotice.startsWith('Failed') ? 'red' : 'green')] : []),
      ]),
      Section('All Groups', rows.length > 0 ? [
        Table(rows, 'id', [
          { header: 'Group', width: { flexible: 1, min: 12 }, cell: 'name' },
          { header: 'Kind', width: 8, cell: 'kindText' },
          { header: 'Members', width: { flexible: 3, min: 20 }, cell: 'membersText' },
        ], {
          selection: stateBinding(state, 'selectedGroupId', selected?.id ?? ''),
          onActivate: row => {
            state.selectedGroupId = row.id
          },
        }).frame({ maxWidth: -1 }),
        ...(selected ? [selectedGroupCard(state, selected)] : []),
      ] : [Text('No groups.').foregroundColor('secondary')]),
      Section('Device Memberships', deviceMemberships(state)),
      Section('Create Group', [
        HStack([
          TextField(stateBinding(state, 'groupNameDraft', ''), { placeholder: 'Name' }).frame({ maxWidth: -1 }),
          Toggle('Person', stateBinding(state, 'groupPersonDraft', false)),
          Button('Create', () => createGroup(state), { disabled: !state.live || !(state.groupNameDraft ?? '').trim() }),
        ], { spacing: 1 }),
        RouteLink('Grants', 'security/grants', 'Choose what a group may call.'),
      ]),
    ]).task(state.live ? 'groups-live' : 'groups-offline', async task => {
      const live = state.live
      if (!live) return
      await Promise.all([
        watchGroupsInto(state, task, live),
        watchInto(state, task, live.devices.watchDevices(), devices => {
          state.devices = devices
        }),
      ])
    })
  },
}

/** Streams groups and members into state from `hub/groups`, or from the older two streams on hubs without it. */
export async function watchGroupsInto(state: ClientPageState, task: TaskContext, live: ClientLive): Promise<void> {
  let failure: unknown
  await watchInto(state, task, live.security.watchGroups(), groups => {
    state.permissionGroups = groups.map(group => ({ id: group.id, name: group.name, permissions: group.paths, person: group.person }))
    state.groupMembers = Object.fromEntries(groups.map(group => [group.id, group.members]))
  }, error => {
    failure = error
  })
  if (task.signal.aborted || failure === undefined) return
  await Promise.all([
    watchInto(state, task, live.security.watchGroupList(), groups => {
      state.permissionGroups = groups
    }, error => {
      state.securityNotice = `Failed to load groups: ${errorMessage(error)}`
    }),
    watchInto(state, task, live.security.watchGroupUsers(), members => {
      state.groupMembers = members
    }),
  ])
}

function groupRows(state: ClientPageState): GroupRow[] {
  return (state.permissionGroups ?? []).map(group => {
    const id = group.id ?? group.name
    const members = membersOf(state, group)
    return {
      ...group,
      id,
      kindText: group.person ? 'Person' : id === 'owners' ? 'Owners' : 'Group',
      membersText: members.length > 0 ? members.map(member => memberLabel(state, member)).join(', ') : '-',
    }
  })
}

function membersOf(state: ClientPageState, group: ClientPermissionGroup): string[] {
  const members = state.groupMembers ?? {}
  return members[group.id ?? group.name] ?? members[group.name] ?? []
}

function selectedGroupCard(state: ClientPageState, group: GroupRow): ViewNode {
  const members = membersOf(state, group)
  const memberDevices = new Set(members.map(parseGroupMember).flatMap(member => (member.kind === 'device' ? [member.id] : [])))
  const candidates = (state.devices ?? []).filter(device => !device.revoked && !memberDevices.has(device.id))
  const deviceChoice = candidates.find(device => device.id === state.groupDeviceDraft) ?? candidates[0]
  const disabled = !state.live
  const key = (state.groupKeyDraft ?? '').trim()
  return Card(group.name, [
    ...(members.length > 0
      ? members.map(member => HStack([
          Text(memberLabel(state, member)),
          Button('Remove', () => updateMembers(state, group, 'remove', member), { disabled, role: 'destructive' }),
        ], { spacing: 1 }))
      : [Text('No members.').foregroundColor('secondary')]),
    HStack([
      Picker('Device', candidates.map(device => device.name), deviceNameBinding(state, candidates, deviceChoice)),
      Button('Add Device', () => deviceChoice && updateMembers(state, group, 'add', formatGroupMember({ kind: 'device', id: deviceChoice.id })), {
        disabled: disabled || !deviceChoice,
      }),
    ], { spacing: 1 }),
    HStack([
      TextField(stateBinding(state, 'groupKeyDraft', ''), { placeholder: 'Public key (SPKI base64)' }).frame({ maxWidth: -1 }),
      Button('Add Key', () => updateMembers(state, group, 'add', formatGroupMember({ kind: 'key', key })), { disabled: disabled || !key }),
    ], { spacing: 1 }),
    Button('Delete Group', () => deleteGroup(state, group), { disabled: disabled || group.id === 'owners', role: 'destructive' }),
  ], group.person ? [StatusBadge('Person', 'default')] : [])
}

function deviceNameBinding(state: ClientPageState, devices: HubDevice[], current: HubDevice | undefined) {
  return {
    get: () => current?.name ?? '',
    set(name: string) {
      state.groupDeviceDraft = devices.find(device => device.name === name)?.id
    },
  }
}

function deviceMemberships(state: ClientPageState): ViewNode[] {
  const devices = state.devices ?? []
  if (devices.length === 0) return [Text('No devices.').foregroundColor('secondary')]
  return devices.map(device => {
    const groups = (state.permissionGroups ?? [])
      .filter(group => membersOf(state, group).some(member => {
        const parsed = parseGroupMember(member)
        return parsed.kind === 'device' && parsed.id === device.id
      }))
      .map(group => group.name)
    return Text(`${deviceLabel(state, device.id)}: ${groups.length > 0 ? groups.join(', ') : 'no groups'}`).foregroundColor(groups.length > 0 ? 'primary' : 'secondary')
  })
}

function createGroup(state: ClientPageState): void {
  const live = state.live
  const name = (state.groupNameDraft ?? '').trim()
  if (!live || !name) return
  const person = Boolean(state.groupPersonDraft)
  runAction(state, message => (state.securityNotice = message), () => live.security.createGroup(name, { person }),
    `${person ? 'Person group' : 'Group'} ${name} created`, () => {
      state.groupNameDraft = ''
      state.groupPersonDraft = false
    })
}

function updateMembers(state: ClientPageState, group: GroupRow, change: 'add' | 'remove', member: string): void {
  const live = state.live
  if (!live) return
  const label = memberLabel(state, member)
  const send = () => (change === 'add' ? live.security.addGroupUsers(group.id, [member]) : live.security.removeGroupUsers(group.id, [member]))
  runAction(state, message => (state.securityNotice = message), send,
    change === 'add' ? `${label} added to ${group.name}` : `${label} removed from ${group.name}`, () => {
      const members = new Set(membersOf(state, group))
      if (change === 'add') members.add(member)
      else members.delete(member)
      state.groupMembers = { ...state.groupMembers, [group.id]: [...members] }
      if (change === 'add') state.groupKeyDraft = member.startsWith('key:') ? '' : state.groupKeyDraft
    })
}

function deleteGroup(state: ClientPageState, group: GroupRow): void {
  const live = state.live
  if (!live) return
  runAction(state, message => (state.securityNotice = message), () => live.security.removeGroup(group.id), `${group.name} deleted`, () => {
    state.permissionGroups = (state.permissionGroups ?? []).filter(item => (item.id ?? item.name) !== group.id)
    state.selectedGroupId = undefined
  })
}
