/**
 * Page spec: Security Mode.
 *
 * Source reference:
 * - `Docs/Devices/device-layer.md` section 12, `Docs/Devices/protocol.md` sections 2 and 7.
 *
 * How user gets here:
 * - Home -> Security -> "Mode".
 * - `hub client mode`.
 *
 * What page displays:
 * - Current mode from `hub/security/mode` with an explanation of both modes:
 *   - default-allow: paths without restrictions are callable by anyone, plus
 *     grants. What hubs did before; existing hubs stay here until switched.
 *   - default-deny: a call is allowed only for owners, a matching grant, or a
 *     path its service marked public. New hubs start here.
 * - Built-in hub APIs keep their own access in both modes.
 * - "Require hub-bound tokens": refuses `v: 0` tokens, so a token captured
 *   from one hub can't be replayed on another. Older SDKs stop connecting.
 *
 * Actions (owners):
 * - Switch button sends `hub/security/mode/set { mode }` with the other mode.
 * - Toggle sends `hub/security/mode/set { requireV1 }`.
 *
 * Terminal port notes:
 * - Shows a banner while the hub is still in default-allow.
 */
import type { HubSecurityModeName } from '../../../hub'
import { Button, HStack, StatusBadge, Text, Toggle, type Binding } from '../../terminal'
import { errorMessage, runAction, watchInto } from '../live'
import { PageShell, RouteLink, Section } from '../shared'
import type { ClientPage, ClientPageState } from '../types'

export const securityModePage: ClientPage = {
  route: 'security/mode',
  title: 'Security Mode',
  render(context) {
    const state = context.state
    const current = state.securityMode
    const mode = current?.mode
    const other: HubSecurityModeName = mode === 'default-deny' ? 'default-allow' : 'default-deny'

    return PageShell(this, context, [
      Section('Mode', [
        HStack([
          StatusBadge(mode ?? 'unknown', mode === 'default-deny' ? 'success' : mode ? 'warning' : 'muted'),
          ...(current?.requireV1 ? [StatusBadge('hub-bound tokens only', 'success')] : []),
          ...(state.live ? [] : [StatusBadge('Not connected', 'muted')]),
        ], { spacing: 1 }),
        ...(mode === 'default-allow'
          ? [Text('This hub still lets anyone call paths that have no restrictions. Switch to default-deny once grants cover your devices.', { wrap: true }).foregroundColor('yellow')]
          : []),
        ...(state.securityNotice ? [Text(state.securityNotice).foregroundColor(state.securityNotice.startsWith('Failed') ? 'red' : 'green')] : []),
      ]),
      Section('default-deny', [
        Text('A call is allowed only when the caller is an owner, a grant matches it, or the service marked the path public. New hubs start here.', { wrap: true }).foregroundColor('secondary'),
      ]),
      Section('default-allow', [
        Text('Paths without restrictions are callable by anyone, plus whatever grants allow. Hubs created before devices stay here until an owner switches.', { wrap: true }).foregroundColor('secondary'),
      ]),
      Section('Switch', [
        Button(`Switch to ${other}`, () => setMode(state, other), { disabled: !state.live || !mode }),
        Text('Built-in hub APIs keep their own access in both modes. Owners can always call everything.', { wrap: true }).foregroundColor('secondary'),
        RouteLink('Grants', 'security/grants', 'Allow keys, devices, groups or everyone to call paths.'),
      ]),
      Section('Tokens', [
        Toggle('Require hub-bound tokens', requireV1Binding(state), { disabled: !state.live || !current }),
        Text('Refuses v0 tokens, which are not bound to this hub and could be replayed elsewhere. Clients on older SDKs can no longer connect.', { wrap: true }).foregroundColor('secondary'),
      ]),
    ]).task(state.live ? 'security-mode-live' : 'security-mode-offline', async task => {
      const live = state.live
      if (!live) return
      await watchInto(state, task, live.security.watchSecurityMode(), value => {
        state.securityMode = value
      }, error => {
        state.securityNotice = `Failed to load the security mode: ${errorMessage(error)}`
      })
    })
  },
}

function setMode(state: ClientPageState, mode: HubSecurityModeName): void {
  const live = state.live
  if (!live) return
  runAction(state, message => (state.securityNotice = message), () => live.security.setSecurityMode({ mode }), `Switched to ${mode}`, () => {
    state.securityMode = { mode, requireV1: state.securityMode?.requireV1 ?? false }
  })
}

function requireV1Binding(state: ClientPageState): Binding<boolean> {
  return {
    get: () => state.securityMode?.requireV1 ?? false,
    set(requireV1) {
      const live = state.live
      if (!live || !state.securityMode) return
      runAction(state, message => (state.securityNotice = message), () => live.security.setSecurityMode({ requireV1 }),
        requireV1 ? 'Only hub-bound tokens are accepted' : 'v0 tokens are accepted again', () => {
          state.securityMode = { mode: state.securityMode?.mode ?? 'default-allow', requireV1 }
        })
    },
  }
}
