/** Types of the device APIs in `Docs/Devices/protocol.md` section 6. */

export interface HubDeviceCapabilities {
  cpu?: { cores?: number; model?: string }
  memory?: number
  gpu?: string
  disks?: { name: string; total?: number; free?: number }[]
  power?: 'ac' | 'battery'
  tools?: { xcode?: string; swift?: string; simulators?: string[]; adb?: boolean; docker?: boolean; [key: string]: unknown }
  ssh?: { port: number; user?: string; hostKey: string; hostKeySignature: string }
  [key: string]: unknown
}

export interface HubDeviceService {
  key: string
  instance: string
  name?: string
  online: boolean
  paths: string[]
}

export interface HubDevice {
  id: string
  key: string
  name: string
  platform?: string
  os?: string
  arch?: string
  parent?: string
  approved: boolean
  revoked: boolean
  online: boolean
  network?: 'online' | 'offline'
  /** Hub Network overlay address and the device-name authority that resolves to it. */
  overlay?: { address: string; authority: string }
  lastSeen?: string
  capabilities?: HubDeviceCapabilities
  services: HubDeviceService[]
}

export interface HubPendingDevice {
  id: string
  key: string
  name?: string
  platform?: string
  parent?: string
  safetyCode: string
  firstSeen?: string
}

/** Free-form live data from the device's reporter; these keys are known. */
export interface HubDeviceData {
  cpu?: number
  memoryUsed?: number
  battery?: number
  charging?: boolean
  network?: string
  thermal?: string
  [key: string]: unknown
}

export interface HubDeviceRevoke {
  id: string
  /** Service keys known to be safe elsewhere; they stay valid. */
  keepServices?: string[]
}
