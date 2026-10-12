# Design

## Entry

`bun . client` is a first-class CLI route. It should dispatch before launcher bootstrap/start logic and render the client terminal UI. The first rendered page is `src/client/pages/home.ts`.

The client entry should expose a callable function for tests, for example `runHubClientCommand(options)`, and support a noninteractive smoke mode that renders one frame and exits.

## Page Contract

Each page file in `src/client/pages` keeps its existing top comment. Implementation code is appended below the comment.

Pages should export terminal views through a shared contract, such as:

- route id
- title
- required controls/data
- render function
- optional actions/commands

Page code should compose `src/client/terminal` primitives. Repeated terminal patterns should become shared client components, not duplicated per page.

## Hub Controls

Hub interaction belongs in `src/hub`. If current experimental controls exist elsewhere, move or re-export them through this boundary before page work depends on them.

Pages should depend on typed controls for:

- hub status, key, profile, API/service provider streams, merge/proxy, balancer changes
- launcher info/status, launcher lifecycle, app start/stop/restart/uninstall/create/settings/cluster, terminal I/O
- security pending permissions, allowed permissions, group CRUD, group users, permission names, whitelist/lockdown
- storage list/read/write/delete/upload/download/update flows
- app-service interface normalization and action execution

No page should send raw string paths like `hub/balancer/set` directly unless the path is hidden behind a control method in the same change.

## Terminal Library

The terminal library is the UI substrate. If a page needs a missing control/action, add it to `src/client/terminal` first.

Expected reusable capabilities:

- navigation stack/link/back
- list/table/grid/scroll sections
- buttons, toggles, pickers, tabs
- text fields, secure fields, multiline input
- progress/loading/async stream rendering
- sheets/dialogs/alerts/command palette
- context menus and key bindings
- embedded terminal output and input
- copy/clipboard action with terminal fallback status

## Page Groups

Implement pages in dependency order:

- Foundation: shared route model, page shell, offline/loading/error state, reusable rows/cards/sections.
- Home/connect/help: static and low-risk navigation surfaces.
- Services/storage: service rows, balancer actions, install guides, file-browser open path.
- Launcher: app list/status, create/edit/store flows, terminal process actions.
- Security: pending requests, user groups, connections, lockdown/trust actions.

## Verification

Every page needs at least one render test or snapshot-style smoke test. Every action-building branch should have payload tests at the control layer. Interactive navigation and menus should have terminal runtime tests where behavior depends on focus/key events.
