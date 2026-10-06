import { chmodSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultCandidateDirs, inspectCliLink, installCliLink, isOurLauncher } from '../src/install'
import { tempDir } from './helpers'

describe('installCliLink', () => {
  it('links into the first writable directory and is idempotent', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = join(dir, 'app', 'faamoffice')
    mkdirSync(join(dir, 'app'))
    writeFileSync(launcher, '#!/bin/sh\n')
    expect(inspectCliLink({ launcher, platform: 'linux', candidateDirs: [bin] }).status).toBe(
      'missing',
    )
    const first = installCliLink({ launcher, platform: 'linux', candidateDirs: [bin] })
    expect(first).toEqual({ status: 'linked', location: join(bin, 'faamoffice') })
    expect(readlinkSync(join(bin, 'faamoffice'))).toBe(launcher)
    const again = installCliLink({ launcher, platform: 'linux', candidateDirs: [bin] })
    expect(again.status).toBe('present')
    expect(inspectCliLink({ launcher, platform: 'linux', candidateDirs: [bin] })).toEqual({
      status: 'present',
      location: join(bin, 'faamoffice'),
    })
  })

  it('replaces our stale symlink but never a real file or a foreign symlink, and reports unwritable dirs with a manual command', () => {
    const dir = tempDir()
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const launcher = join(dir, 'new-app', 'cli', 'faamoffice')
    mkdirSync(join(dir, 'new-app', 'cli'), { recursive: true })
    writeFileSync(launcher, '')
    symlinkSync(join(dir, 'old-app', 'cli', 'faamoffice'), join(bin, 'faamoffice'))
    expect(inspectCliLink({ launcher, platform: 'linux', candidateDirs: [bin] }).status).toBe(
      'missing',
    )
    expect(installCliLink({ launcher, platform: 'linux', candidateDirs: [bin] }).status).toBe(
      'linked',
    )
    expect(readlinkSync(join(bin, 'faamoffice'))).toBe(launcher)

    const npm = join(dir, 'npm-bin')
    mkdirSync(npm)
    const npmTarget = join(dir, 'lib', 'node_modules', 'faamoffice', 'bin', 'genoffice.js')
    mkdirSync(join(npmTarget, '..'), { recursive: true })
    writeFileSync(npmTarget, '')
    symlinkSync(npmTarget, join(npm, 'faamoffice'))
    expect(installCliLink({ launcher, platform: 'linux', candidateDirs: [npm] }).status).toBe(
      'occupied',
    )
    expect(readlinkSync(join(npm, 'faamoffice'))).toBe(npmTarget)
    expect(inspectCliLink({ launcher, platform: 'linux', candidateDirs: [npm] }).status).toBe(
      'occupied',
    )
    const spare = join(dir, 'spare-bin')
    mkdirSync(spare)
    expect(inspectCliLink({ launcher, platform: 'linux', candidateDirs: [npm, spare] })).toEqual({
      status: 'missing',
      location: join(spare, 'faamoffice'),
      manual: expect.any(String),
    })
    expect(installCliLink({ launcher, platform: 'linux', candidateDirs: [npm, spare] })).toEqual({
      status: 'linked',
      location: join(spare, 'faamoffice'),
    })

    const taken = join(dir, 'taken')
    mkdirSync(taken)
    writeFileSync(join(taken, 'faamoffice'), 'someone else')
    const occupied = installCliLink({ launcher, platform: 'linux', candidateDirs: [taken] })
    expect(occupied.status).toBe('occupied')
    expect(occupied.manual).toContain('sudo')
    expect(occupied.manual).toContain('ln -sf')
    expect(lstatSync(join(taken, 'faamoffice')).isSymbolicLink()).toBe(false)
    expect(inspectCliLink({ launcher, platform: 'linux', candidateDirs: [taken] }).status).toBe(
      'occupied',
    )

    const locked = join(dir, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o555)
    const r = installCliLink({ launcher, platform: 'linux', candidateDirs: [locked] })
    const seen = inspectCliLink({ launcher, platform: 'linux', candidateDirs: [locked] })
    chmodSync(locked, 0o755)
    if (process.getuid?.() !== 0) {
      expect(r.status).toBe('unwritable')
      expect(r.manual).toContain(launcher)
      expect(seen.status).toBe('unwritable')
    }
  })

  it('owns only launchers shipped with the app, not any path ending in /cli/faamoffice (genoffice#895)', () => {
    const dir = tempDir()
    const launcher = join(dir, 'FaamOffice.app', 'Contents', 'Resources', 'cli', 'faamoffice')
    mkdirSync(join(launcher, '..'), { recursive: true })
    writeFileSync(launcher, '#!/bin/sh\n')
    writeFileSync(join(launcher, '..', 'faamoffice.cjs'), '')

    const vendor = join(dir, 'opt', 'vendor', 'cli', 'faamoffice')
    mkdirSync(join(vendor, '..'), { recursive: true })
    writeFileSync(vendor, '#!/bin/sh\necho vendor\n')
    expect(isOurLauncher(vendor, launcher)).toBe(false)
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    symlinkSync(vendor, join(bin, 'faamoffice'))
    expect(installCliLink({ launcher, platform: 'linux', candidateDirs: [bin] })).toEqual({
      status: 'occupied',
      location: join(bin, 'faamoffice'),
      manual: expect.any(String),
    })
    expect(readlinkSync(join(bin, 'faamoffice'))).toBe(vendor)
    expect(inspectCliLink({ launcher, platform: 'linux', candidateDirs: [bin] }).status).toBe(
      'occupied',
    )

    const dead = join(dir, 'dead-bin')
    mkdirSync(dead)
    symlinkSync(join(dir, 'gone', 'cli', 'faamoffice'), join(dead, 'faamoffice'))
    expect(installCliLink({ launcher, platform: 'linux', candidateDirs: [dead] }).status).toBe(
      'linked',
    )
    expect(readlinkSync(join(dead, 'faamoffice'))).toBe(launcher)

    const older = join(dir, 'opt', 'FaamOffice', 'resources', 'cli', 'faamoffice')
    mkdirSync(join(older, '..'), { recursive: true })
    writeFileSync(older, '#!/bin/sh\n')
    writeFileSync(join(older, '..', 'faamoffice.cjs'), '')
    expect(isOurLauncher(older, launcher)).toBe(true)
    const upgraded = join(dir, 'upgraded-bin')
    mkdirSync(upgraded)
    symlinkSync(older, join(upgraded, 'faamoffice'))
    expect(installCliLink({ launcher, platform: 'linux', candidateDirs: [upgraded] }).status).toBe(
      'linked',
    )
    expect(readlinkSync(join(upgraded, 'faamoffice'))).toBe(launcher)

    const alias = join(dir, 'Applications')
    symlinkSync(join(dir, 'FaamOffice.app'), alias, 'dir')
    const viaAlias = join(alias, 'Contents', 'Resources', 'cli', 'faamoffice')
    expect(isOurLauncher(viaAlias, launcher)).toBe(true)
    const relative = join(dir, 'relative-bin')
    mkdirSync(relative)
    symlinkSync(join('..', 'opt', 'vendor', 'cli', 'faamoffice'), join(relative, 'faamoffice'))
    expect(installCliLink({ launcher, platform: 'linux', candidateDirs: [relative] }).status).toBe(
      'occupied',
    )
  })

  it('reports a missing /usr/local/bin as unwritable instead of skipping it', () => {
    const dir = tempDir()
    const launcher = join(dir, 'faamoffice')
    writeFileSync(launcher, '')
    const absent = join(dir, 'no-such-bin')
    const r = installCliLink({ launcher, platform: 'linux', candidateDirs: [absent] })
    expect(r.status).toBe('unwritable')
    expect(r.location).toBe(join(absent, 'faamoffice'))
    expect(r.manual).toContain('mkdir -p /usr/local/bin')
    expect(defaultCandidateDirs('darwin')[0]).toBe('/usr/local/bin')

    // inspect agrees with install: a later writable candidate counts
    const brew = join(dir, 'brew-bin')
    mkdirSync(brew)
    expect(inspectCliLink({ launcher, platform: 'darwin', candidateDirs: [absent, brew] })).toEqual(
      {
        status: 'missing',
        location: join(brew, 'faamoffice'),
        manual: expect.stringContaining('ln -sf'),
      },
    )
    expect(inspectCliLink({ launcher, platform: 'darwin', candidateDirs: [absent] }).status).toBe(
      'unwritable',
    )
  })

  it('edits the user PATH on Windows without expanding existing entries', () => {
    const scripts: string[] = []
    const run = (script: string) => {
      scripts.push(script)
      return { ok: true, stdout: scripts.length === 1 ? 'linked\n' : 'present\n' }
    }
    const launcher =
      "C:\\Users\\O'Brien\\AppData\\Local\\Programs\\FaamOffice\\resources\\faamoffice\\faamoffice.cmd"
    const dir = "C:\\Users\\O'Brien\\AppData\\Local\\Programs\\FaamOffice\\resources\\faamoffice"
    const first = installCliLink({ launcher, platform: 'win32', runPowerShell: run })
    expect(first).toEqual({ status: 'linked', location: dir })
    expect(scripts[0]).toContain("$dir = 'C:\\Users\\O''Brien\\AppData")
    expect(scripts[0]).toContain("'DoNotExpandEnvironmentNames'")
    expect(scripts[0]).toContain('RegistryValueKind]::ExpandString')
    expect(scripts[0]).toContain('SendMessageTimeout')
    expect(scripts[0]).not.toContain('SetEnvironmentVariable')
    expect(installCliLink({ launcher, platform: 'win32', runPowerShell: run }).status).toBe(
      'present',
    )
    const failed = installCliLink({
      launcher,
      platform: 'win32',
      runPowerShell: () => ({ ok: false, stdout: '' }),
    })
    expect(failed.status).toBe('unwritable')
    expect(failed.manual).toContain('SetEnvironmentVariable')
  })

  it('inspects the Windows PATH read-only', () => {
    const scripts: string[] = []
    const launcher = 'C:\\FaamOffice\\resources\\faamoffice\\faamoffice.cmd'
    const present = inspectCliLink({
      launcher,
      platform: 'win32',
      runPowerShell: (s) => (scripts.push(s), { ok: true, stdout: 'present\n' }),
    })
    expect(present.status).toBe('present')
    expect(present.location).toBe('C:\\FaamOffice\\resources\\faamoffice')
    expect(scripts[0]).not.toContain('SetValue')
    const missing = inspectCliLink({
      launcher,
      platform: 'win32',
      runPowerShell: () => ({ ok: true, stdout: 'missing\n' }),
    })
    expect(missing.status).toBe('missing')
    expect(missing.manual).toContain('SetEnvironmentVariable')
  })
})
