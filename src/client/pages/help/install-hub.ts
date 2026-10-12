/**
 * Page spec: Installation Guide / Install Hub.
 *
 * Source reference:
 * - `Reference/Help/Install Hub.swift`
 *
 * How user gets here:
 * - Home header -> "Make your own" / "Learn how to host your own Hub".
 * - Navigation title is "Installation Guide"; title display is inline.
 *
 * Main layout:
 * - Centered guide content.
 * - Bottom tab bar / segmented control selects OS/install target.
 * - Tabs:
 *   - "macOS / Linux".
 *   - "Docker".
 *   - "iOS / tvOS".
 *   - "Windows".
 *
 * macOS / Linux tab:
 * - Title: "Install Bun".
 * - Code block:
 *   `curl -fsSL https://bun.sh/install | bash`
 * - Title: "Run".
 * - Code block:
 *   `bunx v57/hub`
 *
 * Docker tab:
 * - Title: "Run".
 * - Code block:
 *   `docker pull v57dev/hub`
 *   `docker run -d -p 1997:1997 --name Hub v57dev/hub`
 * - Secondary text explains Docker runs Hub server in a virtual machine and is
 *   available for macOS, Linux, and Windows.
 *
 * iOS / tvOS tab:
 * - Read-only note:
 *   - Currently Hub server can only start on macOS, Linux, Windows, and Docker.
 *   - In future any Hub App may be used to connect services.
 *
 * Windows tab:
 * - Title: "Install Bun".
 * - Code block title: "Powershell".
 * - Code:
 *   `powershell -c "irm bun.sh/install.ps1 | iex"`
 * - Title: "Run".
 * - Code block title: "Powershell".
 * - Code:
 *   `bunx v57/hub`
 *
 * Code block behavior:
 * - Click/tap code block copies command text to clipboard.
 * - Header shows terminal icon and title by default.
 * - After copy, header changes to checkmark and "Copied to clipboard" for about
 *   1 second.
 * - Code text should be selectable.
 *
 * Actions and menus:
 * - OS tab selection.
 * - Copy each code block.
 * - No context menus and no network/API calls in reference.
 *
 * Web port notes:
 * - Use copy buttons and visible copy success state.
 * - Preserve exact commands.
 * - External Bun/Wasabi links from Markdown should be normal anchors.
 *
 * Terminal port notes:
 * - Use tabs or numbered choices.
 * - Copy command can print selected command and optionally copy to system
 *   clipboard if terminal host supports it.
 */
import { CopyButton, HStack, TabBar, Text, VStack, type ViewNode } from '../../terminal'
import { Card, PageShell, Section, stateBinding } from '../shared'
import type { ClientPage, InstallHubTab } from '../types'

const installHubTabs: InstallHubTab[] = ['macOS / Linux', 'Docker', 'iOS / tvOS', 'Windows']

export const installHubPage: ClientPage = {
  route: 'help/install-hub',
  title: 'Install Hub',
  render(context) {
    const tab = context.state.installHubTab ?? 'macOS / Linux'
    return PageShell(this, context, [
      Section('Target', [
        TabBar(installHubTabs, stateBinding(context.state, 'installHubTab', 'macOS / Linux')),
        Text('Choose an install target. Press tab or activate the tab row to cycle.').foregroundColor('secondary'),
      ]),
      Section('Guide', installHubGuide(tab)),
    ])
  },
}

function installHubGuide(tab: InstallHubTab): ViewNode[] {
  if (tab === 'Docker') {
    return [
      CommandBlock('Run', ['docker pull v57dev/hub', 'docker run -d -p 1997:1997 --name Hub v57dev/hub']),
      Text('Docker runs Hub server in a virtual machine and works on macOS, Linux, and Windows.').foregroundColor('secondary'),
      AfterInstall(),
    ]
  }

  if (tab === 'iOS / tvOS') {
    return [
      Card('iOS / tvOS', [
        Text('Hub server currently starts on macOS, Linux, Windows, or Docker.').foregroundColor('secondary'),
        Text('Future Hub apps may connect services from iOS and tvOS devices.').foregroundColor('secondary'),
      ]),
      AfterInstall(),
    ]
  }

  if (tab === 'Windows') {
    return [
      CommandBlock('Install Bun / PowerShell', ['powershell -c "irm bun.sh/install.ps1 | iex"']),
      CommandBlock('Run / PowerShell', ['bunx v57/hub']),
      AfterInstall(),
    ]
  }

  return [
    CommandBlock('Install Bun', ['curl -fsSL https://bun.sh/install | bash']),
    CommandBlock('Run', ['bunx v57/hub']),
    AfterInstall(),
  ]
}

function CommandBlock(title: string, commands: string[]): ViewNode {
  const text = commands.join('\n')
  return Card(title, [
    HStack([
      CopyButton('Copy', text, { copiedLabel: 'Copied to clipboard' }),
      Text('terminal command').foregroundColor('secondary'),
    ], { spacing: 2 }),
    VStack(commands.map(command => Text(command, { wrap: true }).foregroundColor('cyan')), { spacing: 0 }),
  ])
}

function AfterInstall(): ViewNode {
  return Card('After Install', [
    Text('Start Hub, then return to Connect and save the local address.').foregroundColor('secondary'),
    Text('Use Storage Setup when the selected Hub does not have a file provider.').foregroundColor('secondary'),
  ])
}
