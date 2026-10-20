import type { TaskContext } from '../terminal'
import type { ClientPageState } from './types'

/**
 * Feeds a hub stream into page state until the page's task is cancelled. The iterator is returned on abort so the
 * subscription closes with the page.
 */
export async function watchInto<T>(
  state: ClientPageState,
  context: TaskContext,
  values: AsyncIterable<T>,
  apply: (value: T) => void,
  onError?: (error: unknown) => void,
): Promise<void> {
  state.refresh = () => context.setNeedsUpdate()
  const iterator = values[Symbol.asyncIterator]()
  const stop = () => void iterator.return?.()
  context.signal.addEventListener('abort', stop, { once: true })
  try {
    while (!context.signal.aborted) {
      const next = await iterator.next()
      if (next.done || context.signal.aborted) break
      apply(next.value)
      context.setNeedsUpdate()
    }
  } catch (error) {
    if (context.signal.aborted) return
    onError?.(error)
    context.setNeedsUpdate()
  } finally {
    context.signal.removeEventListener('abort', stop)
  }
}

/** Runs a hub action from a button and reports the outcome in a notice. */
export function runAction(
  state: ClientPageState,
  notice: (message: string) => void,
  action: () => Promise<unknown>,
  success: string,
  after?: () => void,
): void {
  action().then(
    () => {
      notice(success)
      after?.()
      state.refresh?.()
    },
    error => {
      notice(`Failed: ${errorMessage(error)}`)
      state.refresh?.()
    },
  )
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}
