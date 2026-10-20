import { formatGrantObject, parseGroupMember, type HubGrantObject, type HubGrantSubject } from '../../../hub'
import type { ClientPageState } from '../types'

export function keySuffix(key: string): string {
  return key.length > 8 ? `…${key.slice(-8)}` : key
}

export function deviceLabel(state: ClientPageState, id: string): string {
  return state.devices?.find(device => device.id === id)?.name ?? id.slice(0, 8)
}

export function groupLabel(state: ClientPageState, id: string): string {
  const group = state.permissionGroups?.find(item => (item.id ?? item.name) === id || item.name === id)
  return group?.name ?? id
}

export function subjectLabel(state: ClientPageState, subject: HubGrantSubject): string {
  if ('everyone' in subject) return 'Everyone'
  if ('group' in subject) return `Group ${groupLabel(state, subject.group)}`
  if ('device' in subject) return `Device ${deviceLabel(state, subject.device)}`
  return `Key ${keySuffix(subject.key)}`
}

export function objectLabel(object: HubGrantObject): string {
  if ('prefix' in object) return `${object.prefix}*`
  return formatGrantObject(object).replace(/^path:/, '')
}

export function memberLabel(state: ClientPageState, member: string): string {
  const parsed = parseGroupMember(member)
  return parsed.kind === 'device' ? `Device ${deviceLabel(state, parsed.id)}` : `Key ${keySuffix(parsed.key)}`
}
