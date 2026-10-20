import { expect, test } from 'bun:test'
import { DeviceControl, SecurityControl } from '../../hub'
import { macStudio, MockHubClient } from '../../hub/api/test-support'
import { renderHubClientFrame } from '../index'
import { draftGrant } from './security/grants'
import { flush, plain, press, render, stripAnsi } from './test-support'
import { createClientPageState } from './types'

function liveHub(mode = 'default-allow') {
  const client = new MockHubClient()
  client.streamResults.set('hub/security/mode', [{ mode, requireV1: false }])
  client.streamResults.set('hub/devices', [[macStudio]])
  client.streamResults.set('hub/group/list', [[
    { id: 'owners', name: 'owners' },
    { id: 'family', name: 'Family' },
    { id: 'dmitry', name: 'Dmitry', person: true },
  ]])
  client.streamResults.set('hub/group/users', [{ family: [`device:${macStudio.id}`, 'key:MCowFAMILYKEY0000'], dmitry: [`device:${macStudio.id}`] }])
  client.streamResults.set('hub/grants', [[
    { id: 'g1', subject: { group: 'family' }, object: { prefix: 's3/' }, by: 'OWNERKEY12345678', at: '2026-10-20T10:00:00Z' },
  ]])
  return { client, live: { devices: new DeviceControl(client), security: new SecurityControl(client) } }
}

test('security mode page explains both modes and switches mode and token requirement', async () => {
  const { client, live } = liveHub()
  const view = render({ live }, ['security/mode'])
  await flush()
  const frame = plain(view.terminal)
  expect(frame).toContain('Hub Client / Security Mode')
  expect(frame).toContain('[default-allow]')
  expect(frame).toContain('This hub still lets anyone call paths that have no restrictions')
  expect(frame).toContain('only when the caller is an owner, a grant matches it')

  await press(view, 'Switch to default-deny')
  await press(view, 'Require hub-bound tokens')
  expect(client.sends).toEqual([
    { path: 'hub/security/mode/set', body: { mode: 'default-deny' } },
    { path: 'hub/security/mode/set', body: { requireV1: true } },
  ])
  expect(plain(view.terminal)).toContain('Only hub-bound tokens are accepted')
  view.terminal.stop()
})

test('grants page lists grants with names and adds and removes grants', async () => {
  const { client, live } = liveHub('default-deny')
  const view = render({ live, grantSubjectKind: 'Device', grantSubjectValue: 'mac studio', grantObjectKind: 'Prefix', grantObjectValue: 'build/' }, ['security/grants'])
  await flush()
  const frame = plain(view.terminal)
  expect(frame).toContain('Group Family')
  expect(frame).toContain('s3/*')
  expect(frame).toContain('Devices: Mac Studio')

  await press(view, 'Add')
  await press(view, 'Remove')
  expect(client.sends).toEqual([
    { path: 'hub/grant/add', body: { subject: { device: macStudio.id }, object: { prefix: 'build/' } } },
    { path: 'hub/grant/remove', body: { id: 'g1' } },
  ])
  view.terminal.stop()
})

test('grant drafts cover every subject and object kind', () => {
  const state = createClientPageState({ permissionGroups: [{ id: 'family', name: 'Family', permissions: [] }], grantObjectValue: 's3/read' })
  expect(draftGrant({ ...state, grantSubjectKind: 'Everyone' })).toEqual({ subject: { everyone: true }, object: { path: 's3/read' } })
  expect(draftGrant({ ...state, grantSubjectKind: 'Group', grantSubjectValue: 'Family' })?.subject).toEqual({ group: 'family' })
  expect(draftGrant({ ...state, grantSubjectKind: 'Key', grantSubjectValue: 'K', grantObjectKind: 'Share' })).toEqual({ subject: { key: 'K' }, object: { share: 's3/read' } })
  expect(draftGrant({ ...state, grantSubjectKind: 'Key', grantSubjectValue: '' })).toBeUndefined()
  expect(draftGrant({ ...state, grantSubjectKind: 'Everyone', grantObjectValue: ' ' })).toBeUndefined()
})

test('groups page shows device and person groups and edits members', async () => {
  const { client, live } = liveHub()
  const otherDevice = { ...macStudio, id: 'aaaa1111', name: 'iPhone', services: [] }
  client.streamResults.set('hub/devices', [[macStudio, otherDevice]])
  const view = render({ live, selectedGroupId: 'family', groupKeyDraft: 'MCowNEWKEY', groupNameDraft: 'Anna' }, ['security/groups'])
  await flush()
  const frame = plain(view.terminal)
  expect(frame).toContain('Hub Client / Groups')
  expect(frame).toContain('Person')
  expect(frame).toContain('Device Mac Studio, Key …YKEY0000')
  expect(frame).toContain('Mac Studio: Dmitry, Family')
  expect(frame).toContain('iPhone: no groups')
  expect(frame).toContain('Device: iPhone')

  await press(view, 'Add Device')
  await press(view, 'Add Key')
  await press(view, 'Remove')
  await press(view, '[ ] Person')
  await press(view, 'Create')
  expect(client.sends).toEqual([
    { path: 'hub/group/update/users', body: { group: 'family', add: ['device:aaaa1111'] } },
    { path: 'hub/group/update/users', body: { group: 'family', add: ['key:MCowNEWKEY'] } },
    { path: 'hub/group/update/users', body: { group: 'family', remove: [`device:${macStudio.id}`] } },
    { path: 'hub/group/create', body: { name: 'Anna', person: true } },
  ])
  view.terminal.stop()
})

test('security pages render without a hub', () => {
  for (const route of ['security/mode', 'security/grants', 'security/groups'] as const) {
    const frame = stripAnsi(renderHubClientFrame({ route, width: 100, height: 40 }))
    expect(frame).toContain('Not connected')
  }
})
