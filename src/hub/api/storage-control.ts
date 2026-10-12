import { basename, join } from 'node:path'
import type { HubRuntimeClient } from '../runtime'
import type { HubContext } from '../types/common'
import type { ServiceProvider } from '../types/runtime'
import type {
  HubStorageFile,
  HubStorageList,
  StorageDownloadPlanItem,
  StorageFetch,
  StorageOperationOptions,
  StorageQueuedTask,
  StorageTransferOptions,
  StorageUploadData,
  StorageUploadPlanItem,
  TransferProgress,
} from '../types/storage'

export const defaultStorageUploadBudget = 10_000_000

export class StorageControl {
  constructor(
    private client: HubRuntimeClient,
    private options: StorageTransferOptions = {},
  ) {}

  providers(): AsyncIterable<ServiceProvider[]> {
    return this.client.values<ServiceProvider[]>('hub/api/services', 's3/list')
  }

  async list(path = '', context?: HubContext): Promise<HubStorageList> {
    return normalizeStorageList(await this.client.send('s3/list', normalizeStoragePath(path), context), path)
  }

  watchList(path = '', context?: HubContext): AsyncIterable<HubStorageList> {
    return mapValues(this.client.values('s3/list', normalizeStoragePath(path), context), value =>
      normalizeStorageList(value, path),
    )
  }

  async readDirectory(path: string, context?: HubContext): Promise<HubStorageFile[]> {
    return normalizeStorageFiles(await this.client.send('s3/read/directory', normalizeStoragePath(path), context))
  }

  readUrl(path: string, context?: HubContext): Promise<string> {
    return this.client.send<string>('s3/read', normalizeStorageFilePath(path), context)
  }

  writeUrl(path: string, context?: HubContext): Promise<string> {
    return this.client.send<string>('s3/write', normalizeStorageFilePath(path), context)
  }

  async delete(path: string, context?: HubContext): Promise<void> {
    await this.client.send('s3/delete', normalizeStorageFilePath(path), context)
  }

  async updated(path: string, context?: HubContext): Promise<void> {
    await this.client.send('s3/updated', normalizeStoragePath(path), context)
  }

  async uploadData(
    path: string,
    data: StorageUploadData,
    options: StorageOperationOptions = {},
  ): Promise<TransferProgress> {
    const targetPath = normalizeStorageFilePath(path)
    const total = byteLength(data)
    this.emitProgress({ path: targetPath, sent: 0, total, ratio: total ? 0 : undefined, state: 'running' }, options)
    const url = await this.writeUrl(targetPath, options.context)
    await assertOk(await this.fetch(options.fetch)(url, { method: 'PUT', body: data }))
    await this.notifyUploaded(targetPath, options.context)
    const progress = {
      path: targetPath,
      sent: total ?? 0,
      total,
      ratio: total === undefined ? undefined : 1,
      state: 'done' as const,
    }
    this.emitProgress(progress, options)
    return progress
  }

  async uploadFile(
    localPath: string,
    targetPath = basename(localPath),
    options: StorageOperationOptions = {},
  ): Promise<TransferProgress> {
    const bun = getBun()
    const file = bun.file(localPath)
    return this.uploadData(targetPath, file, {
      ...options,
      onProgress: progress => {
        options.onProgress?.({
          ...progress,
          total: file.size,
          ratio: file.size ? progress.sent / file.size : progress.ratio,
        })
      },
    })
  }

  async download(path: string, options: StorageOperationOptions = {}): Promise<Uint8Array> {
    const remotePath = normalizeStorageFilePath(path)
    this.emitProgress({ path: remotePath, sent: 0, state: 'running' }, options)
    const url = await this.readUrl(remotePath, options.context)
    const response = await this.fetch(options.fetch)(url)
    await assertOk(response)
    const bytes = new Uint8Array(await response.arrayBuffer())
    this.emitProgress(
      { path: remotePath, sent: bytes.byteLength, total: bytes.byteLength, ratio: 1, state: 'done' },
      options,
    )
    return bytes
  }

  async downloadToFile(
    remotePath: string,
    localPath: string,
    options: StorageOperationOptions = {},
  ): Promise<TransferProgress> {
    const bytes = await this.download(remotePath, options)
    await getBun().write(localPath, bytes)
    return {
      path: normalizeStorageFilePath(remotePath),
      sent: bytes.byteLength,
      total: bytes.byteLength,
      ratio: 1,
      state: 'done',
    }
  }

  async notifyUploaded(targetPath: string, context?: HubContext): Promise<void> {
    const parent = parentStoragePath(targetPath)
    await this.updated(parent, context)
    if (parent) {
      const parentParent = parentStoragePath(parent)
      if (parentParent !== parent) await this.updated(parentParent, context)
    }
  }

  private fetch(fetchOverride?: StorageFetch): StorageFetch {
    return (fetchOverride ?? this.options.fetch ?? (globalThis.fetch as unknown as StorageFetch)) as StorageFetch
  }

  private emitProgress(progress: TransferProgress, options: StorageOperationOptions): void {
    this.options.onProgress?.(progress)
    options.onProgress?.(progress)
  }
}

export class StorageTransferQueue {
  private activeSize = 0
  private queue: Array<{
    task: StorageQueuedTask<unknown>
    resolve(value: unknown): void
    reject(reason?: unknown): void
  }> = []

  constructor(readonly budget = defaultStorageUploadBudget) {}

  enqueue<T>(task: StorageQueuedTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (value: unknown) => void, reject })
      this.pump()
    })
  }

  private pump(): void {
    for (;;) {
      const next = this.queue[0]
      if (!next) return
      const size = Math.max(1, next.task.size)
      if (this.activeSize > 0 && this.activeSize + size > this.budget) return
      this.queue.shift()
      this.activeSize += size
      void next.task
        .run()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.activeSize -= size
          this.pump()
        })
    }
  }
}

export function normalizeStoragePath(raw: string | null | undefined): string {
  if (!raw) return ''
  const normalized = raw
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.trim())
    .filter(part => Boolean(part) && part !== '.')
    .join('/')
  return normalized ? `${normalized}/` : ''
}

export function normalizeStorageFilePath(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.trim())
    .filter(part => Boolean(part) && part !== '.')
    .join('/')
}

export function parentStoragePath(path: string): string {
  const normalized = normalizeStoragePath(path)
  if (!normalized) return ''
  const parts = normalized.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `${parts.join('/')}/` : ''
}

export function joinStoragePath(basePath: string, relativePath: string): string {
  const base = normalizeStoragePath(basePath)
  const relative = normalizeStorageFilePath(relativePath)
  if (!relative) return base
  return `${base}${relative}`
}

export function normalizeStorageList(value: unknown, path?: string): HubStorageList {
  const source = asRecord(value)
  return {
    count: numberValue(source?.count),
    files: normalizeStorageFiles(source?.files),
    directories: stringArray(source?.directories).map(normalizeStoragePath),
    path: path === undefined ? undefined : normalizeStoragePath(path),
    raw: value,
  }
}

export function normalizeStorageFiles(value: unknown): HubStorageFile[] {
  return arrayValues(value)
    .map(normalizeStorageFile)
    .filter((file): file is HubStorageFile => Boolean(file))
}

export function planDirectoryUpload(
  basePath: string,
  items: Array<{ localPath?: string; relativePath: string; size?: number }>,
): StorageUploadPlanItem[] {
  const plan: StorageUploadPlanItem[] = []
  for (const item of items) {
    const relativePath = normalizeStorageFilePath(item.relativePath)
    if (!relativePath) continue
    const planned: StorageUploadPlanItem = {
      relativePath,
      remotePath: joinStoragePath(basePath, relativePath),
      size: item.size ?? 0,
    }
    if (item.localPath !== undefined) planned.localPath = item.localPath
    plan.push(planned)
  }
  return plan
}

export function planDirectoryDownload(
  basePath: string,
  files: HubStorageFile[],
  localDirectory: string,
): StorageDownloadPlanItem[] {
  return files.map(file => ({
    remotePath: joinStoragePath(basePath, file.name),
    localPath: join(localDirectory, normalizeStorageFilePath(file.name)),
    size: file.size,
  }))
}

function normalizeStorageFile(value: unknown): HubStorageFile | undefined {
  if (typeof value === 'string') return { name: value, size: 0, raw: value }
  const source = asRecord(value)
  const name = optionalString(source?.name)
  if (!name) return undefined
  return {
    name,
    size: numberValue(source?.size),
    lastModified: optionalString(source?.lastModified),
    raw: value,
  }
}

async function* mapValues<T, U>(values: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  for await (const value of values) yield map(value)
}

function byteLength(data: StorageUploadData): number | undefined {
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength
  if (data instanceof Uint8Array) return data.byteLength
  if (data instanceof ArrayBuffer) return data.byteLength
  const size = (data as { size?: unknown }).size
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined
}

async function assertOk(response: { ok: boolean; status: number; statusText: string }): Promise<void> {
  if (!response.ok) throw new Error(`Storage transfer failed: ${response.status} ${response.statusText}`)
}

function getBun() {
  const bun = (
    globalThis as typeof globalThis & {
      Bun?: {
        file(path: string): StorageUploadData & { size: number }
        write(path: string, data: Uint8Array): Promise<number>
      }
    }
  ).Bun
  if (!bun) throw new Error('Bun runtime unavailable')
  return bun
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return record ? Object.values(record) : []
}

function stringArray(value: unknown): string[] {
  return arrayValues(value)
    .map(item => String(item))
    .filter(Boolean)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
