/** Test helpers shared by control and page tests. */
import type { HubRuntimeClient } from '../runtime'

type HubCall = { path: string; body?: unknown }

export class MockHubClient implements HubRuntimeClient {
  connected = true
  sends: HubCall[] = []
  streams: HubCall[] = []
  sendResults = new Map<string, unknown>()
  streamResults = new Map<string, unknown[]>()

  async send<T = unknown>(path: string, body?: unknown): Promise<T> {
    this.sends.push({ path, body })
    const result = this.sendResults.get(path)
    if (result instanceof Error) throw result
    return result as T
  }

  async *values<T = unknown>(path: string, body?: unknown): AsyncIterable<T> {
    this.streams.push({ path, body })
    for (const value of this.streamResults.get(path) ?? []) yield value as T
  }

  stop(): void {}
}

export const macStudio = {
  id: '8cef065b7af83669150b7d32704d3d3e',
  key: 'MCowBQYDK2VwAyEA7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=',
  name: 'Mac Studio',
  platform: 'macos',
  os: '27.0',
  arch: 'arm64',
  approved: true,
  revoked: false,
  online: true,
  network: 'online',
  lastSeen: '2026-10-20T10:00:00.000Z',
  capabilities: {
    cpu: { cores: 24, model: 'M3 Ultra' },
    memory: 68719476736,
    gpu: 'M3 Ultra',
    disks: [{ name: 'Backup Disk', free: 1.2e12 }],
    power: 'ac',
    tools: { xcode: '27.0', docker: true, adb: false, simulators: ['iPhone 18 Pro'] },
  },
  services: [
    { key: 'S3KEY', instance: 's3-local/Backup Disk', name: 'Backup Disk', online: true, paths: ['s3/read', 's3/write'] },
    { key: 'LAUNCHERKEY', instance: 'hub-launcher', online: false, paths: ['launcher/status'] },
  ],
}
