## 1. Command Entry

- [x] Add `hub client` dispatch so `bun . client` starts before launcher bootstrap/startup.
- [x] Implement `src/client/index.ts` as the terminal-client entry.
- [x] Start route stack at `src/client/pages/home.ts`.
- [x] Add `--smoke` mode that renders a deterministic first frame and exits.
- [x] Add page command routes like `bun . client connect` and nested route segment commands for every registered page.
- [x] Update CLI help/tests so `client` is visible and does not regress existing launcher commands.

## 2. Page Contract And Shell

- [x] Define shared page/route types for all `src/client/pages/**` files.
- [x] Add shared terminal shell: title, connection state, loading/error/empty states, route navigation.
- [x] Preserve every existing page comment block exactly enough that page specs remain readable after implementation.
- [x] Add tests that fail if page files lose their leading `Page spec:` comments.

## 3. Hub Controls

- [x] Create or move typed Hub controls into `src/hub`.
- [x] Cover hub controls: status, badges, key, profile update, API/service provider streams, connections, merge/proxy, balancer set/limit.
- [x] Cover launcher controls: info/status streams, launcher update/check, all-updates, stop, app start/stop/restart/uninstall/create/settings/cluster, terminal stream/input/resize.
- [x] Cover security controls: host/call pending, allowed lists, allow/revoke/update, permission groups CRUD, group users, permission names, whitelist/lockdown status/update.
- [x] Cover storage controls: provider stream, list/watch, read/write URL, upload/download, delete, updated notification, path helpers.
- [x] Cover app-service controls: interface normalization, headers/elements/actions, action body/output mapping, action execution.
- [x] Add any missing function/action discovered while implementing pages before wiring page UI.
- [x] Add unit tests for normalized data and exact outgoing payloads.

## 4. Terminal Library Gaps

- [x] Audit `src/client/terminal` against page comments before page implementation.
- [x] Add missing reusable controls instead of page-local hacks.
- [x] Add secure text input for secrets.
- [x] Add multiline text input for shell install/uninstall commands.
- [x] Add copy/clipboard action with visible copied/error state and terminal fallback.
- [x] Add any needed section/list/table/status helpers for dense Hub pages.
- [x] Add terminal tests for new controls, focus behavior, disabled/loading states, and key bindings.

## 5. Home And Static Guides

- [x] Implement `home.ts` as root page with hub list, selected hub state, service cards, launcher/security/help navigation, and offline/connect states.
- [x] Implement `connect.ts` with manual address connect, saved connection list, make-own path, and read-only intro state.
- [x] Implement `help/install-hub.ts` with OS tabs and copyable command blocks.

## 6. Services And Storage

- [x] Implement `services.ts` with service rows, request/status badges, Copy Key, and load-balancer context menu.
- [x] Implement `help/install-s3.ts` local/cloud/manual flows, Wasabi region wizard, create/update/test/allow actions, secret masking, and open-files path.
- [x] Add file-browser/open-files UI if storage read support is present; otherwise add required terminal/page controls first.

## 7. Launcher Pages

- [x] Implement `launcher.ts` with launcher setup state, app list, process/status badges, update actions, app lifecycle actions, cluster count, terminal links, create/store navigation, and app settings action.
- [x] Implement `launcher/create-app.ts` with Shell/Bun modes, derived app name, restart toggle, payload confirmation, and create action.
- [x] Implement `launcher/edit-app.ts` with environment/secret rows, trailing empty rows, change detection, save/cancel, and correct secret payload source.
- [x] Implement `launcher/store.ts` with fetch/cache/retry, filters, custom store URL, install state, installed detection, and create action.

## 8. Security Pages

- [x] Implement `security/pending-list.ts` with host/call pending sections and allow/reject flows.
- [x] Implement `security/permission-groups.ts` with group list, create/rename/remove, permission toggles, expandable sections, and permission-name display.
- [x] Implement `security/user-connections.ts` with connection rows, group assignment/removal, current-key labeling, and copyable keys.
- [x] Implement `security/lockdown.ts` with lockdown on/off, trusted user rows, trust/untrust, and group assignment context menu.

## 9. Integration Tests

- [x] Add render/smoke tests for every page.
- [x] Add navigation tests for home -> each route.
- [x] Add terminal interaction tests for tabs, context menus, forms, overlays, and key bindings used by pages.
- [x] Add command tests for `bun . client --smoke` and direct exported client entry.
- [x] Run `bun test`.
- [x] Run `bunx tsc --noEmit --pretty false`.
- [x] Run `bunx openspec validate add-client-command-ui --strict`.
- [x] Run `bun . client --smoke`.
- [x] Run `git diff --check`.
