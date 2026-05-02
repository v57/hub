import path from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { expect, test } from 'bun:test'

import {
  isLauncherAlreadyRunning,
  resolveLaunchJsonPath,
  parsePidFile,
  resolveLauncherDirectory,
  resolvePidFilePath,
  main,
} from './launcher'
import { resolveBackupDirectory } from './backup'
import { handleAutostartCommand } from './autostart'

function createLogger(messages: string[]): Pick<Console, 'log' | 'error'> {
  return {
    error: (message: string) => messages.push(message),
    log: (message: string) => messages.push(message),
  }
}

function createGitUpdateSpawn(behindCount: number) {
  const commands: string[][] = []

  const spawn = (cmd: string[]): { exited: Promise<number>; stdout?: ReadableStream<Uint8Array> | number | null } => {
    commands.push(cmd)

    if (cmd[0] === 'git' && cmd[1] === 'fetch') {
      return { exited: Promise.resolve(0) }
    }

    if (cmd[0] === 'git' && cmd[1] === 'rev-list') {
      return {
        exited: Promise.resolve(0),
        stdout: new Response(`${behindCount}\n`).body,
      }
    }

    return { exited: Promise.resolve(0) }
  }

  return { commands, spawn }
}

function createWindowsTaskScheduler() {
  let taskExists = false
  const commands: string[][] = []

  const spawn = (cmd: string[]): { exited: Promise<number> } => {
    commands.push(cmd)

    if (cmd[0] === 'schtasks' && cmd[1] === '/Query') {
      return { exited: Promise.resolve(taskExists ? 0 : 1) }
    }

    if (cmd[0] === 'schtasks' && cmd[1] === '/Create') {
      taskExists = true
      return { exited: Promise.resolve(0) }
    }

    if (cmd[0] === 'schtasks' && cmd[1] === '/Delete') {
      taskExists = false
      return { exited: Promise.resolve(0) }
    }

    return { exited: Promise.resolve(0) }
  }

  return {
    commands,
    get taskExists() {
      return taskExists
    },
    spawn,
  }
}

function decodeExportedLaunchJson(encoded: string): string {
  const payload = Uint8Array.fromBase64(encoded.trim())
  const bytes = payload[0] === 0x1f && payload[1] === 0x8b ? Bun.gunzipSync(payload) : payload
  return new TextDecoder().decode(bytes)
}

function getCurrentPathValue(): string {
  return process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin'
}

function getGlobalBinDirValue(): string {
  return process.platform === 'win32' ? 'C:\\Users\\dimas\\.bun\\bin' : '/Users/dimas/.bun/bin'
}

test('resolves the launcher directory with windows separators', () => {
  expect(resolveLauncherDirectory('C:\\Users\\dimas', path.win32)).toBe('C:\\Users\\dimas\\Hub\\Launcher')
})

test('resolves the pid file inside the launcher directory', () => {
  expect(resolvePidFilePath('/Users/dimas/Hub/Launcher', path.posix)).toBe(
    '/Users/dimas/Hub/Launcher/.hub-launcher.pid',
  )
})

test('parses a pid file', () => {
  expect(parsePidFile('  12345\n')).toBe(12345)
  expect(parsePidFile('not-a-pid')).toBeNull()
})

test('treats a live pid as running', () => {
  expect(isLauncherAlreadyRunning('42', pid => pid === 42)).toBe(true)
  expect(isLauncherAlreadyRunning('42', () => false)).toBe(false)
})

test('prints help for launcher entrypoints', async () => {
  const messages: string[] = []

  await main({
    args: ['--help'],
    logger: createLogger(messages),
  })

  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain('Usage: hub [command] [options]')
  expect(messages[0]).toContain('  restart     Restart the launcher')
})

test('reports running, login autolaunch, and available updates', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)
  const systemRootDirectory = await mkdtemp(path.join(tmpdir(), 'hub-system-'))
  const messages: string[] = []
  const { commands, spawn } = createGitUpdateSpawn(2)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')

    await handleAutostartCommand({
      currentPath: getCurrentPathValue(),
      globalBinDir: getGlobalBinDirValue(),
      homeDirectory,
      logger: createLogger([]),
      mode: 'enable',
      platform: process.platform,
      scope: 'user',
      systemRootDirectory,
    })

    await main({
      homeDirectory,
      args: ['status'],
      isProcessAlive: () => true,
      logger: createLogger(messages),
      platform: process.platform,
      spawn,
      systemRootDirectory,
    })

    expect(messages).toEqual(['Launcher: Running', 'Autolaunch: On Login', 'Updates: Available'])
    expect(commands).toEqual([
      ['git', 'fetch', '--quiet'],
      ['git', 'rev-list', '--count', 'HEAD..@{u}'],
    ])
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
    await rm(systemRootDirectory, { recursive: true, force: true })
  }
})

test('reports not running, boot autolaunch, and no updates', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)
  const systemRootDirectory = await mkdtemp(path.join(tmpdir(), 'hub-system-'))
  const messages: string[] = []
  const { commands, spawn } = createGitUpdateSpawn(0)
  const scheduler = createWindowsTaskScheduler()

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    await handleAutostartCommand({
      currentPath: getCurrentPathValue(),
      globalBinDir: getGlobalBinDirValue(),
      homeDirectory,
      logger: createLogger([]),
      mode: 'enable',
      platform: process.platform,
      scope: 'system',
      spawn: process.platform === 'win32' ? scheduler.spawn : undefined,
      systemRootDirectory,
    })

    await main({
      homeDirectory,
      args: ['status'],
      isProcessAlive: () => false,
      logger: createLogger(messages),
      platform: process.platform,
      spawn,
      systemRootDirectory,
    })

    expect(messages).toEqual(['Launcher: Not running', 'Autolaunch: On Boot', 'Updates: No updates'])
    expect(commands).toEqual([
      ['git', 'fetch', '--quiet'],
      ['git', 'rev-list', '--count', 'HEAD..@{u}'],
    ])
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
    await rm(systemRootDirectory, { recursive: true, force: true })
  }
})

test('exports a minified launch configuration and gzips it when smaller', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })

    const launchJsonPath = resolveLaunchJsonPath(launcherDirectory)
    const launchConfiguration = {
      features: {
        banner: 'a'.repeat(4096),
        retries: 3,
      },
      name: 'hub-launcher',
    }
    await Bun.write(launchJsonPath, `${JSON.stringify(launchConfiguration, null, 2)}\n`)

    const messages: string[] = []

    await main({
      homeDirectory,
      args: ['launcher', 'export'],
      logger: createLogger(messages),
    })

    expect(messages).toHaveLength(1)

    const encoded = messages[0]!
    const payload = Uint8Array.fromBase64(encoded)

    expect(payload[0]).toBe(0x1f)
    expect(payload[1]).toBe(0x8b)
    expect(decodeExportedLaunchJson(encoded)).toBe(JSON.stringify(launchConfiguration))
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('imports a launch configuration after backing up the current launcher', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    const originalLaunchConfiguration = {
      source: 'old',
      settings: {
        enabled: true,
      },
    }
    await Bun.write(
      resolveLaunchJsonPath(launcherDirectory),
      `${JSON.stringify(originalLaunchConfiguration, null, 2)}\n`,
    )

    const importedLaunchConfiguration = {
      source: 'new',
      settings: {
        enabled: false,
      },
    }
    const encoded = Buffer.from(JSON.stringify(importedLaunchConfiguration)).toString('base64')
    const backupId = '2026-04-04T00-00-00.000Z'
    const backupDirectory = resolveBackupDirectory(homeDirectory, backupId)
    const messages: string[] = []

    await main({
      homeDirectory,
      args: ['launcher', 'import', encoded],
      isProcessAlive: () => false,
      logger: createLogger(messages),
      now: () => new Date('2026-04-04T00:00:00.000Z'),
    })

    expect(await Bun.file(resolveLaunchJsonPath(launcherDirectory)).text()).toBe(
      `${JSON.stringify(importedLaunchConfiguration)}\n`,
    )
    expect(await Bun.file(path.join(backupDirectory, 'launch.json')).text()).toBe(
      `${JSON.stringify(originalLaunchConfiguration, null, 2)}\n`,
    )
    expect(messages).toContain(`Hub Launcher backed up to ${backupDirectory}`)
    expect(messages).toContain(
      `Hub Launcher launch configuration imported to ${resolveLaunchJsonPath(launcherDirectory)}`,
    )
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('imports a launch configuration from url after backing up the current launcher', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')
    await Bun.write(resolveLaunchJsonPath(launcherDirectory), `{"source":"old"}\n`)

    const importedLaunchConfiguration = {
      source: 'remote',
      settings: {
        enabled: true,
      },
    }
    const fetchCalls: string[] = []
    const messages: string[] = []
    const backupId = '2026-04-05T00-00-00.000Z'
    const backupDirectory = resolveBackupDirectory(homeDirectory, backupId)
    const fetchImpl = async (input: string | URL | Request) => {
      fetchCalls.push(String(input))
      return new Response(JSON.stringify(importedLaunchConfiguration), {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      })
    }

    await main({
      fetch: fetchImpl,
      homeDirectory,
      args: ['launcher', 'import', 'https://example.com/launch.json'],
      isProcessAlive: () => false,
      logger: createLogger(messages),
      now: () => new Date('2026-04-05T00:00:00.000Z'),
    })

    expect(fetchCalls).toEqual(['https://example.com/launch.json'])
    expect(await Bun.file(resolveLaunchJsonPath(launcherDirectory)).text()).toBe(
      `${JSON.stringify(importedLaunchConfiguration)}\n`,
    )
    expect(await Bun.file(path.join(backupDirectory, 'launch.json')).text()).toBe(`{"source":"old"}\n`)
    expect(messages).toContain(`Hub Launcher backed up to ${backupDirectory}`)
    expect(messages).toContain(
      `Hub Launcher launch configuration imported to ${resolveLaunchJsonPath(launcherDirectory)}`,
    )
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('previews an imported launch configuration without replacing it', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')
    await Bun.write(resolveLaunchJsonPath(launcherDirectory), `{"source":"old"}\n`)

    const importedLaunchConfiguration = {
      source: 'preview',
      settings: {
        enabled: true,
      },
    }
    const encoded = Buffer.from(JSON.stringify(importedLaunchConfiguration)).toString('base64')
    const messages: string[] = []

    await main({
      homeDirectory,
      args: ['launcher', 'import', '--preview', encoded],
      isProcessAlive: () => true,
      logger: createLogger(messages),
    })

    expect(messages).toEqual([JSON.stringify(importedLaunchConfiguration, null, 2)])
    expect(await Bun.file(resolveLaunchJsonPath(launcherDirectory)).text()).toBe(`{"source":"old"}\n`)
    expect(await Bun.file(path.join(homeDirectory, 'Hub', 'Backups')).exists()).toBe(false)
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('refuses to import a launch configuration while the launcher is running', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)
  const previousExitCode = process.exitCode

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')
    await Bun.write(resolveLaunchJsonPath(launcherDirectory), `{"source":"old"}\n`)

    const messages: string[] = []
    const encoded = Buffer.from(JSON.stringify({ source: 'new' })).toString('base64')

    await main({
      homeDirectory,
      args: ['launcher', 'import', encoded],
      isProcessAlive: () => true,
      logger: createLogger(messages),
    })

    expect(messages).toContain(`Hub Launcher is running at ${launcherDirectory}. Stop it first before importing.`)
    expect(await Bun.file(resolveLaunchJsonPath(launcherDirectory)).text()).toBe(`{"source":"old"}\n`)
  } finally {
    process.exitCode = previousExitCode
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('installs and launches when the launcher is not running', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(resolvePidFilePath(launcherDirectory), '')
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    const commands: string[][] = []
    const spawnOptions: Array<Record<string, unknown> | undefined> = []
    const unrefCalls: string[] = []

    await main({
      homeDirectory,
      isProcessAlive: () => false,
      spawn: (cmd, options) => {
        commands.push(cmd)
        spawnOptions.push(options as Record<string, unknown> | undefined)

        return {
          pid: cmd[1] === 'index.ts' ? 321 : undefined,
          exited: Promise.resolve(0),
          unref: () => {
            unrefCalls.push(cmd.join(' '))
          },
        }
      },
    })

    expect(commands).toEqual([
      [process.execPath, 'install'],
      [process.execPath, 'index.ts'],
    ])
    expect(spawnOptions[0]).toMatchObject({
      stdout: 'ignore',
      stderr: 'ignore',
    })
    expect(spawnOptions[1]).toMatchObject({
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
      detached: true,
      windowsHide: true,
    })
    expect(unrefCalls).toEqual([`${process.execPath} index.ts`])
    expect(await Bun.file(resolvePidFilePath(launcherDirectory)).text()).toBe('321\n')
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('skips launch when the launcher is already running', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    const commands: string[][] = []

    await main({
      homeDirectory,
      isProcessAlive: () => true,
      spawn: (cmd, options) => {
        commands.push(cmd)

        return {
          pid: 1,
          exited: Promise.resolve(0),
        }
      },
    })

    expect(commands).toEqual([])
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('stops a running launcher without starting a new one', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')

    const commands: string[][] = []
    const killedPids: number[] = []

    await main({
      homeDirectory,
      args: ['stop'],
      isProcessAlive: () => true,
      killProcess: pid => {
        killedPids.push(pid)
      },
      spawn: cmd => {
        commands.push(cmd)
        return {
          pid: 1,
          exited: Promise.resolve(0),
        }
      },
    })

    expect(killedPids).toEqual([42])
    expect(commands).toEqual([])
    expect(await Bun.file(resolvePidFilePath(launcherDirectory)).exists()).toBe(false)
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('uninstalls the launcher when it is not running', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    const commands: string[][] = []

    await main({
      homeDirectory,
      args: ['uninstall'],
      isProcessAlive: () => false,
      spawn: cmd => {
        commands.push(cmd)
        return {
          pid: 1,
          exited: Promise.resolve(0),
        }
      },
    })

    expect(commands).toEqual([])
    expect(await Bun.file(launcherDirectory).exists()).toBe(false)
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('refuses to uninstall a running launcher', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    const commands: string[][] = []

    await main({
      homeDirectory,
      args: ['uninstall'],
      isProcessAlive: () => true,
      spawn: cmd => {
        commands.push(cmd)
        return {
          pid: 1,
          exited: Promise.resolve(0),
        }
      },
    })

    expect(commands).toEqual([])
    expect(await Bun.file(resolvePidFilePath(launcherDirectory)).exists()).toBe(true)
    expect(await Bun.file(path.join(launcherDirectory, 'package.json')).exists()).toBe(true)
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('updates and relaunches a running launcher', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    const commands: string[][] = []
    const spawnOptions: Array<Record<string, unknown> | undefined> = []
    const unrefCalls: string[] = []
    const killedPids: number[] = []

    await main({
      homeDirectory,
      args: ['update'],
      isProcessAlive: () => true,
      killProcess: pid => {
        killedPids.push(pid)
      },
      spawn: (cmd, options) => {
        commands.push(cmd)
        spawnOptions.push(options as Record<string, unknown> | undefined)

        return {
          pid: cmd[1] === 'index.ts' ? 321 : undefined,
          exited: Promise.resolve(0),
          unref: () => {
            unrefCalls.push(cmd.join(' '))
          },
        }
      },
    })

    expect(killedPids).toEqual([42])
    expect(commands).toEqual([
      ['git', 'pull'],
      [process.execPath, 'install'],
      [process.execPath, 'index.ts'],
    ])
    expect(spawnOptions[0]).toMatchObject({
      stdout: 'ignore',
      stderr: 'ignore',
    })
    expect(spawnOptions[1]).toMatchObject({
      stdout: 'ignore',
      stderr: 'ignore',
    })
    expect(spawnOptions[2]).toMatchObject({
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
      detached: true,
      windowsHide: true,
    })
    expect(unrefCalls).toEqual([`${process.execPath} index.ts`])
    expect(await Bun.file(resolvePidFilePath(launcherDirectory)).text()).toBe('321\n')
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('restarts a running launcher', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'hub-home-'))
  const launcherDirectory = resolveLauncherDirectory(homeDirectory)

  try {
    await mkdir(launcherDirectory, { recursive: true })
    await Bun.write(resolvePidFilePath(launcherDirectory), '42\n')
    await Bun.write(path.join(launcherDirectory, 'package.json'), '{}')

    const commands: string[][] = []
    const killedPids: number[] = []

    await main({
      homeDirectory,
      args: ['restart'],
      isProcessAlive: () => true,
      killProcess: pid => {
        killedPids.push(pid)
      },
      spawn: (cmd, options) => {
        commands.push(cmd)

        return {
          pid: cmd[1] === 'index.ts' ? 321 : undefined,
          exited: Promise.resolve(0),
        }
      },
    })

    expect(killedPids).toEqual([42])
    expect(commands).toEqual([
      [process.execPath, 'install'],
      [process.execPath, 'index.ts'],
    ])
    expect(await Bun.file(resolvePidFilePath(launcherDirectory)).text()).toBe('321\n')
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})
