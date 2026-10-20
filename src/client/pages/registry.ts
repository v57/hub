import { connectPage } from './connect'
import { devicesPage } from './devices'
import { deviceDetailPage } from './devices/detail'
import { installHubPage } from './help/install-hub'
import { installS3Page } from './help/install-s3'
import { homePage } from './home'
import { createAppPage } from './launcher/create-app'
import { editAppPage } from './launcher/edit-app'
import { launcherStorePage } from './launcher/store'
import { launcherPage } from './launcher'
import { servicesPage } from './services'
import { lockdownPage } from './security/lockdown'
import { pendingListPage } from './security/pending-list'
import { permissionGroupsPage } from './security/permission-groups'
import { userConnectionsPage } from './security/user-connections'
import type { ClientPage, ClientPageContext, ClientRouteId } from './types'

export const clientPages: ClientPage[] = [
  homePage,
  connectPage,
  servicesPage,
  installHubPage,
  installS3Page,
  launcherPage,
  createAppPage,
  editAppPage,
  launcherStorePage,
  pendingListPage,
  permissionGroupsPage,
  userConnectionsPage,
  lockdownPage,
  devicesPage,
  deviceDetailPage,
]

const pagesByRoute = new Map<ClientRouteId, ClientPage>(clientPages.map(page => [page.route, page]))

export function getClientPage(route: ClientRouteId): ClientPage {
  return pagesByRoute.get(route) ?? homePage
}

export function renderClientRoute(route: ClientRouteId, context: Omit<ClientPageContext, 'route'>) {
  const page = getClientPage(route)
  return page.render({ ...context, route: page.route })
}
