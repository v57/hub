export type HubErrorKind =
  | 'connection'
  | 'auth'
  | 'permission'
  | 'not-found'
  | 'protocol'
  | 'validation'
  | 'unknown'

export interface HubErrorOptions {
  kind?: HubErrorKind
  path?: string
  cause?: unknown
  hint?: string
}

export class HubError extends Error {
  kind: HubErrorKind
  path?: string
  override cause?: unknown
  hint?: string

  constructor(message: string, options: HubErrorOptions = {}) {
    super(message)
    this.name = 'HubError'
    this.kind = options.kind ?? 'unknown'
    this.path = options.path
    this.cause = options.cause
    this.hint = options.hint
  }

  static from(cause: unknown, options: HubErrorOptions = {}): HubError {
    if (cause instanceof HubError) return cause
    const message = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : `${cause}`
    return new HubError(message, {
      ...options,
      kind: options.kind ?? classifyHubError(message),
      cause,
    })
  }
}

export function classifyHubError(message: string): HubErrorKind {
  const value = message.toLowerCase()
  if (value.includes('unauthorized') || value.includes('authorization') || value.includes('401')) return 'auth'
  if (value.includes('permission') || value.includes('forbidden') || value.includes('403')) return 'permission'
  if (value.includes('not found') || value.includes('api not found') || value.includes('404')) return 'not-found'
  if (value.includes('websocket') || value.includes('connect') || value.includes('econnrefused')) return 'connection'
  if (value.includes('invalid') || value.includes('malformed')) return 'protocol'
  return 'unknown'
}
