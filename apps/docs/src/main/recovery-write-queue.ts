/** Serialize a recovery write and its stale-copy rollback under one stable source key. */
export function createRecoveryWriteQueue() {
  const tails = new Map<string, Promise<void>>()

  return function enqueue<T>(key: string, write: () => T | Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const result = previous.then(write)
    // Keep a settled tail even if a writer fails, so subsequent writes still run.
    const tail = result.then(
      () => {},
      () => {},
    )
    tails.set(key, tail)
    void tail.then(() => {
      // An earlier writer must not clear the tail of a newer queued writer.
      if (tails.get(key) === tail) tails.delete(key)
    })
    return result
  }
}
