import { expect, test } from 'bun:test'
import {
  formatGrantObject,
  formatGrantSubject,
  normalizeGrants,
  normalizeGroupList,
  normalizeSecurityMode,
  parseGrantObject,
  parseGrantSubject,
  parseGroupMember,
  SecurityControl,
} from './security-control'
import { MockHubClient } from './test-support'

test('SecurityControl reads and sets the security mode and grants', async () => {
  const client = new MockHubClient()
  client.streamResults.set('hub/security/mode', [{ mode: 'default-deny', requireV1: true }])
  client.streamResults.set('hub/grants', [[
    { id: 'g1', subject: { group: 'family' }, object: { prefix: 's3/' }, by: 'OWNER', at: '2026-10-20T10:00:00Z' },
    { id: 'bad', subject: { nobody: true }, object: { path: 'x' } },
  ]])
  client.sendResults.set('hub/grant/add', { id: 'g2', subject: { everyone: true }, object: { path: 'hub/info' } })
  client.sendResults.set('hub/info', { key: 'HUBKEY', protocol: 1, pro: true, mode: 'default-deny' })
  const security = new SecurityControl(client)

  expect(await security.securityMode()).toEqual({ mode: 'default-deny', requireV1: true })
  expect(await security.grants()).toEqual([
    { id: 'g1', subject: { group: 'family' }, object: { prefix: 's3/' }, by: 'OWNER', at: '2026-10-20T10:00:00Z' },
  ])
  await security.setSecurityMode({ mode: 'default-allow' })
  await security.setSecurityMode({ requireV1: false })
  expect((await security.addGrant({ everyone: true }, { path: 'hub/info' }))?.id).toBe('g2')
  await security.removeGrant('g1')
  expect(await security.info()).toEqual({ key: 'HUBKEY', protocol: 1, pro: true, mode: 'default-deny' })

  expect(client.sends.slice(0, 4)).toEqual([
    { path: 'hub/security/mode/set', body: { mode: 'default-allow' } },
    { path: 'hub/security/mode/set', body: { requireV1: false } },
    { path: 'hub/grant/add', body: { subject: { everyone: true }, object: { path: 'hub/info' } } },
    { path: 'hub/grant/remove', body: { id: 'g1' } },
  ])
})

test('groups take person groups and key or device members', async () => {
  const client = new MockHubClient()
  const security = new SecurityControl(client)
  await security.createGroup('Family')
  await security.createGroup('Dmitry', { person: true })
  await security.addGroupMembers('family', [{ kind: 'device', id: 'd1' }, { kind: 'key', key: 'K' }])
  await security.removeGroupMembers('family', [{ kind: 'device', id: 'd1' }])
  expect(client.sends).toEqual([
    { path: 'hub/group/create', body: 'Family' },
    { path: 'hub/group/create', body: { name: 'Dmitry', person: true } },
    { path: 'hub/group/update/users', body: { group: 'family', add: ['device:d1', 'key:K'] } },
    { path: 'hub/group/update/users', body: { group: 'family', remove: ['device:d1'] } },
  ])
  expect(normalizeGroupList([{ id: 'p', name: 'Dmitry', person: true }, { name: 'Family' }])).toMatchObject([
    { id: 'p', name: 'Dmitry', person: true },
    { id: 'Family', name: 'Family' },
  ])
  expect(normalizeGroupList([{ name: 'Family' }])[0]?.person).toBeUndefined()
})

test('grant and member strings round-trip', () => {
  for (const text of ['everyone', 'key:MCow=', 'device:8cef', 'group:owners']) expect(formatGrantSubject(parseGrantSubject(text))).toBe(text)
  for (const text of ['path:s3/read', 'prefix:s3/', 'share:abc']) expect(formatGrantObject(parseGrantObject(text))).toBe(text)
  expect(() => parseGrantSubject('device:')).toThrow()
  expect(() => parseGrantObject('s3/read')).toThrow()
  expect(parseGroupMember('device:d1')).toEqual({ kind: 'device', id: 'd1' })
  expect(parseGroupMember('key:K')).toEqual({ kind: 'key', key: 'K' })
  expect(parseGroupMember('MCowBQ==')).toEqual({ kind: 'key', key: 'MCowBQ==' })
  expect(normalizeSecurityMode(undefined)).toEqual({ mode: 'default-allow', requireV1: false })
  expect(normalizeGrants({ grants: [] })).toEqual([])
})
