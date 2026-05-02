import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'bun:test'

import { resolveLauncherDirectory, resolvePidFilePath } from './launcher'
import { handleBackupCommand, resolveBackupDirectory, resolveBackupsDirectory } from './backup'

test('creates a backup and lists it', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{"name":"hub-launcher"}')
    await Bun.write(path.join(launcherDirectory, 'index.ts'), "console.log('launcher')")
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')

    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: any[]) => {
      logs.push(args.join(' '))
    }

    try {
      await handleBackupCommand({
        args: [],
        homeDirectory,
        now: () => new Date('2026-04-04T00:00:00.000Z'),
      })
    } finally {
      console.log = originalLog
    }

    const backupId = '2026-04-04T00-00-00.000Z'
    const backupDirectory = resolveBackupDirectory(homeDirectory, backupId)

    expect(await Bun.file(path.join(backupDirectory, 'index.ts')).text()).toBe("console.log('launcher')")
    expect(await Bun.file(path.join(backupDirectory, '.hub-launcher.pid')).exists()).toBe(false)
    expect(logs.some(line => line.includes(backupDirectory))).toBe(true)

    const listLogs: string[] = []
    const originalListLog = console.log
    console.log = (...args: any[]) => {
      listLogs.push(args.join(' '))
    }

    try {
      await handleBackupCommand({
        args: ['list'],
        homeDirectory,
      })
    } finally {
      console.log = originalListLog
    }

    expect(listLogs).toEqual([backupId])
    expect(await Bun.file(path.join(resolveBackupsDirectory(homeDirectory), backupId, 'index.ts')).exists()).toBe(true)
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('restores the latest backup when no id is provided', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)
  const backupsDirectory = resolveBackupsDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{"name":"hub-launcher"}')
    await Bun.write(path.join(launcherDirectory, 'index.ts'), "console.log('current')")
    await mkdir(resolveBackupDirectory(homeDirectory, '2026-04-03T00-00-00.000Z'), { recursive: true })
    await Bun.write(
      path.join(resolveBackupDirectory(homeDirectory, '2026-04-03T00-00-00.000Z'), 'index.ts'),
      "console.log('older')",
    )
    await mkdir(resolveBackupDirectory(homeDirectory, '2026-04-04T00-00-00.000Z'), { recursive: true })
    await Bun.write(
      path.join(resolveBackupDirectory(homeDirectory, '2026-04-04T00-00-00.000Z'), 'index.ts'),
      "console.log('newer')",
    )

    await handleBackupCommand({
      args: ['restore'],
      homeDirectory,
      isProcessAlive: () => false,
    })

    expect(await Bun.file(path.join(launcherDirectory, 'index.ts')).text()).toBe("console.log('newer')")
    expect(await Bun.file(resolvePidFilePath(launcherDirectory)).exists()).toBe(false)
    expect(await Bun.file(path.join(backupsDirectory, '2026-04-04T00-00-00.000Z', 'index.ts')).exists()).toBe(true)
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('refuses to restore while the launcher is running', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')
    await mkdir(resolveBackupDirectory(homeDirectory, '2026-04-04T00-00-00.000Z'), { recursive: true })

    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: any[]) => {
      errors.push(args.join(' '))
    }

    try {
      await handleBackupCommand({
        args: ['restore'],
        homeDirectory,
        isProcessAlive: () => true,
      })
    } finally {
      console.error = originalError
    }

    expect(errors.some(line => line.includes('Stop it first before restoring'))).toBe(true)
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('removes a backup by id and removes all backups', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))

  try {
    await mkdir(resolveBackupDirectory(homeDirectory, '2026-04-03T00-00-00.000Z'), { recursive: true })
    await mkdir(resolveBackupDirectory(homeDirectory, '2026-04-04T00-00-00.000Z'), { recursive: true })
    await Bun.write(
      path.join(resolveBackupDirectory(homeDirectory, '2026-04-03T00-00-00.000Z'), 'index.ts'),
      "console.log('older')",
    )
    await Bun.write(
      path.join(resolveBackupDirectory(homeDirectory, '2026-04-04T00-00-00.000Z'), 'index.ts'),
      "console.log('newer')",
    )

    await handleBackupCommand({
      args: ['remove', '2026-04-03T00-00-00.000Z'],
      homeDirectory,
    })

    expect(
      await Bun.file(path.join(resolveBackupDirectory(homeDirectory, '2026-04-03T00-00-00.000Z'), 'index.ts')).exists(),
    ).toBe(false)
    expect(
      await Bun.file(path.join(resolveBackupDirectory(homeDirectory, '2026-04-04T00-00-00.000Z'), 'index.ts')).exists(),
    ).toBe(true)

    await handleBackupCommand({
      args: ['remove', 'all'],
      homeDirectory,
    })

    expect(
      await Bun.file(
        path.join(resolveBackupsDirectory(homeDirectory), '2026-04-04T00-00-00.000Z', 'index.ts'),
      ).exists(),
    ).toBe(false)
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})
