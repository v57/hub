import { expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServiceCertificate, decodeServiceCertificate, DeviceIdentity, resolveDeviceKeyPath } from './device-key'
import vectors from './testdata/device-vectors.json'
import { getHubPublicKey, hubAuthHeaders, hubAuthSignedData, hubDeviceId, hubSafetyCode, signHubAuthAt } from './key-material'

// Copied from Docs/Devices/vectors.json; every SDK must produce the same strings.
const { auth, keys } = vectors

test('v0 auth signs the expiry only', async () => {
  expect(hubAuthSignedData(auth.expiry)).toBe(auth.v0.signedData)
  expect(await signHubAuthAt(keys.service.keyFile, auth.expiry)).toBe(auth.v0.header)
})

test('v1 auth binds the token to the hub key', async () => {
  expect(hubAuthSignedData(auth.expiry, keys.hub.publicKey)).toBe(auth.v1.signedData)
  expect(await signHubAuthAt(keys.service.keyFile, auth.expiry, keys.hub.publicKey)).toBe(auth.v1.header)
})

test('auth headers send v 1 only with a hub key', async () => {
  expect((await hubAuthHeaders(keys.service.keyFile)).v).toBe('0')
  const headers = await hubAuthHeaders(keys.service.keyFile, 10, keys.hub.publicKey)
  expect(headers.v).toBe('1')
  expect(headers.auth.startsWith(`key.${keys.service.publicKey}.`)).toBe(true)
})

test('key material exposes the vector public keys', () => {
  expect(getHubPublicKey(keys.hub.keyFile)).toBe(keys.hub.publicKey)
  expect(getHubPublicKey(keys.device.keyFile)).toBe(keys.device.publicKey)
})

test('device id and safety code match the vectors', async () => {
  expect(await hubDeviceId(keys.device.publicKey)).toBe(keys.device.deviceId)
  expect(await hubSafetyCode(keys.device.publicKey)).toBe(keys.device.safetyCode)
})

test('service certificates match the vectors', async () => {
  const { certificate, childCertificate } = vectors
  const header = await createServiceCertificate(keys.device.keyFile, keys.service.publicKey, {
    instance: 's3-local/Backup Disk',
    deviceName: 'Mac Studio',
    platform: 'macos',
    now: 1792500000,
  })
  expect(header).toBe(certificate.header)
  expect(JSON.stringify(decodeServiceCertificate(header))).toBe(certificate.json)

  const child = await createServiceCertificate(keys.device.keyFile, keys.service.publicKey, {
    instance: 'builder',
    deviceName: 'builder',
    platform: 'linux',
    parent: 'Mac Studio',
    now: 1792500000,
  })
  expect(child).toBe(childCertificate.header)
})

test('device identity creates the key file once and reuses certificates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-device-'))
  try {
    const path = join(directory, 'nested', 'device.key')
    const device = new DeviceIdentity({ path, deviceName: 'Test', instance: 'hub-cli' })
    const publicKey = await device.publicKey()
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await new DeviceIdentity({ path }).publicKey()).toBe(publicKey)

    const first = await device.certificate(keys.service.publicKey, 1792500000)
    expect(await device.certificate(keys.service.publicKey, 1792500000 + 60)).toBe(first)
    expect(await device.certificate(keys.service.publicKey, 1792500000 + 6.5 * 24 * 3600)).not.toBe(first)
    const decoded = decodeServiceCertificate(first)!
    expect(decoded.device).toBe(publicKey)
    expect(decoded.instance).toBe('hub-cli')
    expect(decoded.exp - decoded.iat).toBe(604800)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('device key path honours HUB_DEVICE_KEY', () => {
  expect(resolveDeviceKeyPath({ HUB_DEVICE_KEY: '/tmp/x.key' })).toBe('/tmp/x.key')
  expect(resolveDeviceKeyPath({}).endsWith(join('.hub', 'device.key'))).toBe(true)
})
