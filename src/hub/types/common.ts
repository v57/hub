import type { Icon } from 'hub-service/service'

export interface HubContext {
  service?: string
}

export interface HubProfile {
  name?: string
  icon?: Icon | string
}

export type HubAddress = string | number

export type HubConnectionStatus = 'idle' | 'connecting' | 'connected' | 'stopped'
