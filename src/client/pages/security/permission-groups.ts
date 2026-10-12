/**
 * Page spec: Permission Groups.
 *
 * Source reference:
 * - `Reference/Security/Permission groups.swift`
 *
 * How user gets here:
 * - Home -> selected hub section -> "Permissions" card.
 * - Home shows card when current key has both `hub/group/list` and
 *   `hub/group/names`.
 *
 * What page displays:
 * - Permission group management UI.
 * - Scrollable content with bottom create/edit control.
 * - If not adding and no groups exist, show placeholder:
 *   - Icon: shield.
 *   - Title: "Permission Groups".
 *   - Description: "Secure your Hub".
 *   - Lines: "Add Owners" with key icon, "Create Groups" with plus icon.
 * - If adding, show all permission sections with toggles.
 * - If viewing groups, show each group as a section with selected permissions.
 *
 * Data shape:
 * - Permission names arrive as map of permission path -> display name.
 * - Display name parsing:
 *   - If display name contains `": "`, text before separator is section name,
 *     text after separator is permission label.
 *   - Otherwise section is "Other" and full display name is permission label.
 *   - Sections are sorted alphabetically.
 *   - Permissions inside section are sorted alphabetically.
 * - Group list arrives as map of group name -> set of permission paths.
 * - Permission path stored in groups is `<section>/<permission>`.
 *
 * Bottom create control:
 * - Visible only if current key has `hub/group/update`.
 * - Default state:
 *   - Button title "Create Group".
 *   - Plus icon.
 * - Adding state:
 *   - Text input "Name" appears.
 *   - If name empty, button title "Cancel", icon xmark.
 *   - If name not empty, button title "Create", icon plus.
 * - On Create:
 *   - Sends `hub/group/update` with `{ group: name, set: selectedPermissions }`.
 *   - Clears name.
 *   - Exits adding mode.
 *
 * Group view:
 * - Each group section header shows group name.
 * - If not editing:
 *   - Show only selected permission sections and selected permissions.
 *   - Section names are semibold.
 *   - Permission names use smaller/caption style.
 *   - Header button says "Edit".
 * - If editing:
 *   - Show every permission section and permission.
 *   - Section header has toggle for selecting/deselecting whole section.
 *   - Each permission has own toggle.
 *   - Header includes "Delete Group" destructive action.
 *   - Header button says "Save".
 *
 * Group actions:
 * - Edit: set editing group name.
 * - Save: sends `hub/group/update` with `{ group: group.name, set:
 *   Array(group.permissions) }`, then exits editing.
 * - Delete Group: sends `hub/group/remove` with group name, then exits editing.
 *
 * Toggle behavior:
 * - Single permission toggle adds/removes one permission path from set.
 * - Section toggle is on only when all section permission paths are selected.
 * - Turning section on inserts all section permission paths.
 * - Turning section off removes all section permission paths.
 *
 * Data/state needed:
 * - `hub/permissions` or equivalent permission-name map.
 * - `hub/group/list` group map.
 * - Permission checks for `hub/group/update`.
 *
 * Web port notes:
 * - Use accordion/list sections for groups.
 * - Editing can be inline; preserve Save/Delete in group header.
 * - Bottom sticky bar should contain create group controls.
 *
 * Terminal port notes:
 * - Use two modes: browse groups and edit/create group.
 * - Commands: create-group, edit-group, toggle-section, toggle-permission,
 *   save-group, delete-group, cancel.
 * - Show selected permissions grouped by section in browse mode.
 */
import { Button, HStack, Text, TextField, Toggle, VStack, type Binding, type ViewNode } from '../../terminal'
import { Card, PageShell, Section, stateBinding } from '../shared'
import type { ClientPage, ClientPageState, ClientPermissionGroup } from '../types'

type PermissionSection = {
  name: string
  permissions: { path: string; label: string }[]
}

export const permissionGroupsPage: ClientPage = {
  route: 'security/permission-groups',
  title: 'Permission Groups',
  render(context) {
    const state = context.state
    const groups = state.permissionGroups ?? []
    const sections = permissionSections(state)

    return PageShell(this, context, [
      Section('Permission Groups', [
        Text('Secure your Hub with reusable permission sets.').foregroundColor('secondary'),
        ...(state.securityNotice ? [Text(state.securityNotice).foregroundColor('green')] : []),
      ]),
      groups.length === 0 && !state.addingGroup
        ? Section('Groups', [
            Text('No permission groups.').foregroundColor('secondary'),
            Text('Add Owners or Create Groups to start.').foregroundColor('secondary'),
            Button('Create Group', () => startCreateGroup(state), { disabled: !state.securityCanManageGroups }),
          ])
        : Section('Groups', [
            ...groups.map(group => groupCard(state, group, sections)),
            createGroupControl(state, sections),
          ]),
    ])
  },
}

function createGroupControl(state: ClientPageState, sections: PermissionSection[]): ViewNode {
  if (!state.securityCanManageGroups) return Text('Current key cannot update permission groups.').foregroundColor('secondary')
  if (!state.addingGroup) return Button('Create Group', () => startCreateGroup(state))
  const name = (state.groupNameDraft ?? '').trim()
  return Card('Create Group', [
    TextField(stateBinding(state, 'groupNameDraft', ''), { placeholder: 'Name' }).frame({ maxWidth: -1 }),
    ...sectionToggles(state, sections, state.groupDraftPermissions ?? []),
    HStack([
      Button(name ? 'Create' : 'Cancel', () => {
        if (!name) cancelGroupEdit(state)
        else createGroup(state, name)
      }),
      Button('Cancel', () => cancelGroupEdit(state), { role: 'cancel' }),
    ], { spacing: 1 }),
  ])
}

function groupCard(state: ClientPageState, group: ClientPermissionGroup, sections: PermissionSection[]): ViewNode {
  const editing = state.editingGroupName === group.name
  if (editing) {
    return Card(group.name, [
      ...sectionToggles(state, sections, state.groupDraftPermissions ?? []),
      HStack([
        Button('Save', () => saveGroup(state, group.name)),
        Button('Delete Group', () => deleteGroup(state, group.name), { role: 'destructive' }),
        Button('Cancel', () => cancelGroupEdit(state), { role: 'cancel' }),
      ], { spacing: 1 }),
    ])
  }

  const selected = sections
    .map(section => ({
      ...section,
      permissions: section.permissions.filter(permission => group.permissions.includes(permission.path)),
    }))
    .filter(section => section.permissions.length > 0)

  return Card(group.name, [
    ...(selected.length > 0 ? selected.map(section => VStack([
      Text(section.name).fontWeight('bold'),
      ...section.permissions.map(permission => Text(permission.label).foregroundColor('secondary')),
    ])) : [Text('No permissions selected.').foregroundColor('secondary')]),
    Button('Edit', () => {
      state.editingGroupName = group.name
      state.groupDraftPermissions = [...group.permissions]
    }, { disabled: !state.securityCanManageGroups }),
  ])
}

function sectionToggles(state: ClientPageState, sections: PermissionSection[], selected: string[]): ViewNode[] {
  return sections.map(section => VStack([
    Toggle(section.name, sectionBinding(state, section, selected)),
    ...section.permissions.map(permission =>
      Toggle(`  ${permission.label}`, permissionBinding(state, permission.path, selected)),
    ),
  ]))
}

function startCreateGroup(state: ClientPageState): void {
  state.addingGroup = true
  state.editingGroupName = undefined
  state.groupNameDraft = ''
  state.groupDraftPermissions = []
}

function createGroup(state: ClientPageState, name: string): void {
  state.permissionGroups = [
    ...(state.permissionGroups ?? []).filter(group => group.name !== name),
    { id: name, name, permissions: [...(state.groupDraftPermissions ?? [])] },
  ]
  state.securityNotice = `${name} group create action prepared`
  cancelGroupEdit(state)
}

function saveGroup(state: ClientPageState, name: string): void {
  state.permissionGroups = (state.permissionGroups ?? []).map(group => group.name === name ? { ...group, permissions: [...(state.groupDraftPermissions ?? [])] } : group)
  state.securityNotice = `${name} group save action prepared`
  cancelGroupEdit(state)
}

function deleteGroup(state: ClientPageState, name: string): void {
  state.permissionGroups = (state.permissionGroups ?? []).filter(group => group.name !== name)
  state.users = (state.users ?? []).map(user => user.group === name ? { ...user, group: undefined } : user)
  state.securityNotice = `${name} group delete action prepared`
  cancelGroupEdit(state)
}

function cancelGroupEdit(state: ClientPageState): void {
  state.addingGroup = false
  state.editingGroupName = undefined
  state.groupNameDraft = ''
  state.groupDraftPermissions = []
}

function sectionBinding(state: ClientPageState, section: PermissionSection, selected: string[]): Binding<boolean> {
  return {
    get: () => section.permissions.every(permission => selected.includes(permission.path)),
    set(value) {
      const current = new Set(state.groupDraftPermissions ?? [])
      for (const permission of section.permissions) {
        if (value) current.add(permission.path)
        else current.delete(permission.path)
      }
      state.groupDraftPermissions = [...current].sort()
    },
  }
}

function permissionBinding(state: ClientPageState, path: string, selected: string[]): Binding<boolean> {
  return {
    get: () => selected.includes(path),
    set(value) {
      const current = new Set(state.groupDraftPermissions ?? [])
      if (value) current.add(path)
      else current.delete(path)
      state.groupDraftPermissions = [...current].sort()
    },
  }
}

function permissionSections(state: ClientPageState): PermissionSection[] {
  const names = state.permissionNames ?? {}
  const paths = new Set([
    ...Object.keys(names),
    ...(state.permissionGroups ?? []).flatMap(group => group.permissions),
  ])
  const sections = new Map<string, { path: string; label: string }[]>()
  for (const path of [...paths].sort()) {
    const display = names[path] ?? path
    const [section, label] = splitPermissionName(display)
    const items = sections.get(section) ?? []
    items.push({ path, label })
    sections.set(section, items)
  }
  return [...sections.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, permissions]) => ({ name, permissions: permissions.sort((left, right) => left.label.localeCompare(right.label)) }))
}

function splitPermissionName(value: string): [string, string] {
  const separator = value.indexOf(': ')
  if (separator >= 0) return [value.slice(0, separator), value.slice(separator + 2)]
  return ['Other', value]
}
