// @vitest-environment node
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRecoveryWriteQueue } from '../src/main/recovery-write-queue'

const directories: string[] = []
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('recovery write queue', () => {
  it('finishes a stale writer rollback before the next source snapshot lands', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'faamoffice-recovery-queue-'))
    directories.push(directory)
    const snapshot = join(directory, 'stable-source.docx')
    const sourceKey = join(directory, 'original.doc')
    const enqueue = createRecoveryWriteQueue()
    const oldStarted = gate()
    const heldIo = gate()
    let epoch = 0
    const oldEpoch = epoch
    const events: string[] = []
    const oldWrite = enqueue(sourceKey, async () => {
      events.push('old-start')
      oldStarted.release()
      await heldIo.promise
      await writeFile(snapshot, 'stale DOC snapshot')
      events.push('old-write')
      if (epoch !== oldEpoch) {
        await unlink(snapshot)
        events.push('old-rollback')
      }
    })
    await oldStarted.promise
    epoch++ // A save / discard invalidates the in-flight DOC recovery tick.
    const newEpoch = epoch
    const newWrite = enqueue(sourceKey, async () => {
      expect(epoch).toBe(newEpoch)
      events.push('new-start')
      await writeFile(snapshot, 'new DOCX snapshot')
      events.push('new-write')
    })
    await Promise.resolve()
    expect(events).toEqual(['old-start'])
    heldIo.release()
    await Promise.all([oldWrite, newWrite])
    expect(events).toEqual(['old-start', 'old-write', 'old-rollback', 'new-start', 'new-write'])
    expect(await readFile(snapshot, 'utf8')).toBe('new DOCX snapshot')
  })

  it('allows a different source key to finish while another source is blocked', async () => {
    const enqueue = createRecoveryWriteQueue()
    const started = gate()
    const held = gate()
    let firstFinished = false
    const first = enqueue('first.doc', async () => {
      started.release()
      await held.promise
      firstFinished = true
    })
    await started.promise
    await expect(enqueue('second.docx', () => 'independent')).resolves.toBe('independent')
    expect(firstFinished).toBe(false)
    held.release()
    await first
  })

  it('propagates a failed writer without blocking the next snapshot', async () => {
    const enqueue = createRecoveryWriteQueue()
    const failure = new Error('disk write failed')
    const failed = enqueue('report.doc', () => {
      throw failure
    })
    const next = enqueue('report.doc', async () => 'next snapshot')
    await expect(failed).rejects.toBe(failure)
    await expect(next).resolves.toBe('next snapshot')
    await expect(enqueue('report.doc', () => 42)).resolves.toBe(42)
  })

  it('does not release a newer queued tail when an earlier writer completes', async () => {
    const enqueue = createRecoveryWriteQueue()
    const firstStarted = gate(),
      firstHeld = gate(),
      secondStarted = gate(),
      secondHeld = gate()
    const events: string[] = []
    const first = enqueue('source.doc', async () => {
      firstStarted.release()
      await firstHeld.promise
    })
    await firstStarted.promise
    const second = enqueue('source.doc', async () => {
      events.push('second-start')
      secondStarted.release()
      await secondHeld.promise
      events.push('second-end')
    })
    firstHeld.release()
    await first
    await secondStarted.promise
    const third = enqueue('source.doc', () => {
      events.push('third')
    })
    await Promise.resolve()
    expect(events).toEqual(['second-start'])
    secondHeld.release()
    await Promise.all([second, third])
    expect(events).toEqual(['second-start', 'second-end', 'third'])
  })
})
