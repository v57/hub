/**
 * Page spec: Home.
 *
 * Source reference:
 * - `Reference/Home.swift`
 *
 * How user gets here:
 * - Main/root page of Hub client.
 * - Navigation title is "Home"; title display is inline.
 * - This page is the hub dashboard and launch point for every hub-level page.
 *
 * Main layout:
 * - Scrollable page.
 * - Uses responsive grid cards. Swift uses `HomeGrid` with adaptive spacing from
 *   current viewport width; web should use responsive CSS grid, terminal should
 *   use card/list layout that keeps same grouping.
 * - Sections appear in order:
 *   1. Header controls.
 *   2. One section per saved Hub connection.
 *   3. "My Apps" local service shortcuts.
 *   4. "Support this Project" links.
 *
 * Header controls:
 * - Join Hub card:
 *   - Empty state title: "Join Hub".
 *   - Address input accepts bare host, host/path, port, ws/wss/http/https-like
 *     input. Reference normalizes local hosts to `ws`, remote hosts to `wss`,
 *     and default local `ws` port to 1997.
 *   - When address has text, show second input for name. Placeholder is derived
 *     from URL name when possible.
 *   - When URL and name/default name are valid, show "Connect" action.
 *   - Connect action inserts new Hub settings into saved hub list and clears
 *     address/name.
 * - "Make your own" card:
 *   - Secondary text: "Learn how to host your own Hub".
 *   - Opens install guide page (`help/install-hub.ts`).
 * - Saved hub cards:
 *   - One compact card for each saved hub.
 *   - Shows hub name, wifi/connectivity icon, service count, security request
 *     count if present, or "Connecting..." while disconnected.
 * - "My Key" button:
 *   - Copies local public key to clipboard.
 *   - Label changes to "Copied" with checkmark for about 3 seconds.
 * - "Farm" button:
 *   - Opens Farm page in Swift reference.
 *   - Shows "Farming" badge when farm runtime is running.
 *
 * Saved hub card context menu:
 * - If current key has `hub/merge/add` and no merge source is selected, show
 *   "Merge".
 * - "Merge" makes selected hub the merge source. Other hub cards can then show
 *   Join/Leave controls if merge relationship is allowed.
 * - Show "Remove" to delete hub from saved connections.
 *
 * Hub section display:
 * - Section title is hub settings name.
 * - If service count is zero, show large "Services" summary card with top
 *   services sorted by request count. It previews service name, request count,
 *   balancer icon, running count, and pending count.
 * - Show hub action cards depending on permissions and hub capabilities:
 *   - "Connections" when `hub/connections` is allowed.
 *   - "Requests" when security badge count is > 0 and `hub/host/pending` is
 *     allowed. Badge is request count.
 *   - "Permissions" when `hub/group/list` and `hub/group/names` are allowed.
 *   - "Lockdown" when hub can enter lockdown mode.
 *   - "Launcher" when `launcher/status` is allowed.
 *   - "Files" when hub has storage.
 *   - "Files" opening S3 install guide when hub lacks storage but can install.
 * - Show launcher apps from `launcherInfo.apps`.
 * - Show "Share Services" card.
 * - Show app badges from `statusBadges.apps`; app card opens Hub app page and
 *   shows "Offline" badge when app status says offline.
 *
 * Hub section navigation targets:
 * - Services -> `services.ts`.
 * - Connections -> `security/user-connections.ts`.
 * - Requests -> `security/pending-list.ts`.
 * - Permissions -> `security/permission-groups.ts`.
 * - Lockdown -> `security/lockdown.ts`.
 * - Launcher -> `launcher.ts`.
 * - Files -> file browser page from reference app.
 * - Install S3 -> `help/install-s3.ts`.
 *
 * Launcher app card in Home:
 * - Shows app id/name and terminal icon.
 * - Shows up to last 7 process rows. Each process row displays CPU percent and
 *   memory MB when available, memory only when CPU missing, otherwise "Active".
 * - If many processes run, show total CPU/memory summary.
 * - Shows relative start age as now/minutes/hours.
 * - If no processes, show "Not running" for active app or "Stopped" for inactive app.
 * - Badges:
 *   - "Updating" while updating.
 *   - "Checking for updates" while checking.
 *   - "Update" when update is available.
 * - Apps named "Hub" or "Hub Lite" show "Upgrade to Pro", sending local public
 *   key to `launcher/pro`.
 * - Card grows when instance stepper is visible or Pro upgrade button is shown.
 *
 * Launcher app card context menu:
 * - Active app:
 *   - "Cluster" if app has one instance. Reveals instance stepper.
 *   - "Restart" sends `launcher/app/restart`.
 *   - "Settings" opens `launcher/edit-app.ts`.
 *   - "Stop" sends `launcher/app/stop`.
 * - Inactive app:
 *   - "Start" sends `launcher/app/start`.
 *   - "Settings" opens `launcher/edit-app.ts`.
 *   - "Uninstall" sends `launcher/app/uninstall` and is destructive.
 * - Instance stepper sends `launcher/app/cluster` with app name and target count
 *   when target is > 0, different from current, and <= 1024.
 *
 * Share Services card:
 * - Displays icon toggles for every local `AppServices.Service` that can publish
 *   into the current hub.
 * - Toggle reads service publisher state and calls service `setService(enabled:)`.
 * - Enabled state has green border/fill.
 *
 * My Apps section:
 * - Shows all local app service shortcuts from `AppServices.Service.allCases`.
 * - Each card opens `AppServices.Page(service:)`.
 *
 * Support section:
 * - Link-style cards: Discord, Patreon, Boosty, GitHub, Buy Me a Coffee, Ko-Fi,
 *   USDT, BTC.
 * - Swift reference has empty button actions; web/terminal should either wire
 *   real links if known or keep disabled/placeholder.
 *
 * Data/state streams needed:
 * - Saved hub list (`Hubs.main.list` equivalent).
 * - Per-hub status badges.
 * - Per-hub launcher info and launcher status.
 * - Per-hub permission/capability checks.
 * - Local key store public key.
 * - Local service publisher states.
 *
 * Web port notes:
 * - Preserve dashboard hierarchy and permission-gated cards.
 * - Use context menus or overflow menus for card actions.
 * - Clipboard copy feedback must be visible and temporary.
 * - Keep address normalization behavior identical to reference.
 *
 * Terminal port notes:
 * - Render sections as navigable panels.
 * - Use focused commands for hidden context-menu actions: merge/remove hub,
 *   start/stop/restart/uninstall app, cluster app, edit settings.
 * - Show badges inline as text: `[Requests 3]`, `[Offline]`, `[Update]`.
 */
import { Button, CopyButton, HStack, StatusBadge, Text, VStack } from '../terminal'
import { Card, ConnectionCard, ConnectionRows, PageShell, RouteLink, Section, selectedConnection } from './shared'
import type { ClientPage } from './types'

export const homePage: ClientPage = {
  route: 'home',
  title: 'Home',
  render(context) {
    const state = context.state
    const active = selectedConnection(state)
    return PageShell(this, context, [
      Section('Header Controls', [
        HStack([
          RouteLink('Connect', 'connect', 'Add or select saved Hub connections.'),
          RouteLink('Install Hub', 'help/install-hub', 'Host your own Hub.'),
        ]),
        VStack([Text(`Public Key`), Text(state.publicKey ?? '', { wrap: true }).foregroundColor('secondary')], {
          spacing: 0,
        }),
        ...(state.connectionNotice ? [Text(state.connectionNotice).foregroundColor('green')] : []),
      ]),
      Section(
        'Saved Hubs',
        state.connections.length > 0
          ? state.connections.map(connection => ConnectionCard(state, connection))
          : ConnectionRows(state.connections),
      ),
      Section(
        'Active Hub',
        active
          ? [
              Card(active.name, [
                Text(active.address).foregroundColor('secondary'),
                HStack(
                  [
                    StatusBadge(active.connected ? 'Connected' : 'Offline', active.connected ? 'success' : 'muted'),
                    StatusBadge(`Services ${active.serviceCount ?? 0}`, 'default'),
                    StatusBadge(
                      `Requests ${active.requestCount ?? 0}`,
                      (active.requestCount ?? 0) > 0 ? 'warning' : 'muted',
                    ),
                  ],
                  { spacing: 1 },
                ),
                Text(
                  active.connected
                    ? 'Open service, launcher, storage, or security pages for this hub.'
                    : 'Connect page can add another address while this hub is offline.',
                  { wrap: true },
                ).foregroundColor('secondary'),
              ]),
            ]
          : [
              Text('No Hub selected.').foregroundColor('secondary'),
              RouteLink('Connect', 'connect', 'Add a local or remote Hub before using Hub-specific pages.'),
            ],
      ),
      Section('Hub Pages', hubPageLinks()),
      Section('Security', securityPageLinks()),
    ]).frame({ maxWidth: -1, maxHeight: -1, alignment: 'topLeading' })
  },
}

function leadingFrame(view: ReturnType<typeof VStack>): ReturnType<typeof VStack> {
  return view.frame({ maxWidth: -1, alignment: 'topLeading' })
}

function hubPageLinks() {
  return [
    HStack(
      [
        RouteLink('Services', 'services'),
        RouteLink('Launcher', 'launcher'),
        RouteLink('Storage Setup', 'help/install-s3'),
      ],
      { spacing: 2 },
    ),
    Text(
      'Services, Launcher, and Storage Setup open Hub-specific API, app, process, and file-provider workflows.',
    ).foregroundColor('secondary'),
  ]
}

function securityPageLinks() {
  return [
    HStack(
      [
        RouteLink('Requests', 'security/pending-list'),
        RouteLink('Permissions', 'security/permission-groups'),
        RouteLink('Connections', 'security/user-connections'),
        RouteLink('Lockdown', 'security/lockdown'),
      ],
      { spacing: 2 },
    ),
    Text(
      'Security pages cover pending requests, permission groups, connected users, and lockdown trust controls.',
    ).foregroundColor('secondary'),
  ]
}
