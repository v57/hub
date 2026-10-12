import type { HubContext } from './common'

export interface HubStorageFile {
  name: string
  size: number
  lastModified?: string
  raw?: unknown
}

export interface HubStorageList {
  count: number
  files: HubStorageFile[]
  directories: string[]
  path?: string
  raw?: unknown
}

export type TransferState = 'pending' | 'running' | 'done' | 'failed'

export interface TransferProgress {
  path: string
  sent: number
  total?: number
  ratio?: number
  state: TransferState
  error?: unknown
}

export interface StorageFetchResponse {
  ok: boolean
  status: number
  statusText: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export type StorageFetch = (url: string, init?: { method?: string; body?: unknown }) => Promise<StorageFetchResponse>

export type StorageUploadData = Uint8Array | ArrayBuffer | string | { size?: number }

export interface StorageTransferOptions {
  fetch?: StorageFetch
  onProgress?: (progress: TransferProgress) => void
}

export interface StorageUploadPlanItem {
  localPath?: string
  relativePath: string
  remotePath: string
  size: number
}

export interface StorageDownloadPlanItem {
  remotePath: string
  localPath: string
  size: number
}

export interface StorageQueuedTask<T> {
  size: number
  run(): Promise<T>
}

export interface StorageOperationOptions extends StorageTransferOptions {
  context?: HubContext
}
