## ADDED Requirements

### Requirement: Client Command Starts Terminal UI

The CLI SHALL provide a `client` command that starts the Hub terminal client.

#### Scenario: Run local client command

- **WHEN** the user runs `bun . client`
- **THEN** the CLI starts the terminal client
- **AND** the first page is the Home page implemented in `src/client/pages/home.ts`
- **AND** launcher bootstrap/startup is not executed before the client UI route.

#### Scenario: Smoke render

- **WHEN** the user runs `bun . client --smoke`
- **THEN** the command renders a deterministic terminal frame
- **AND** exits without requiring interactive input
- **AND** includes Home page content.

#### Scenario: Run page command

- **WHEN** the user runs `bun . client connect`
- **THEN** the CLI starts the terminal client on the Connect page
- **AND** each registered client page can be selected by its route segments, for example `bun . client launcher create-app` or `bun . client security lockdown`
- **AND** `--smoke` renders the selected page instead of always rendering Home.

### Requirement: Page Implementations Preserve Specs

Every `src/client/pages/**/*.ts` page SHALL keep its existing comment-based page specification while adding a working terminal UI implementation.

#### Scenario: Page source after implementation

- **WHEN** a page file is implemented
- **THEN** its leading comment still contains `Page spec:`
- **AND** the implementation exports a page/view contract usable by the client route stack.

### Requirement: Pages Use Terminal Library

Client pages SHALL use `src/client/terminal` as the UI primitive library.

#### Scenario: Page needs missing UI behavior

- **WHEN** a page needs a reusable UI behavior not present in `src/client/terminal`
- **THEN** the missing behavior is added to the terminal library
- **AND** the page uses that reusable primitive instead of a page-local rendering workaround.

### Requirement: Hub Controls Own API Actions

Hub API calls needed by pages SHALL be exposed through typed controls in `src/hub`.

#### Scenario: Page sends Hub action

- **WHEN** a page performs a Hub, launcher, storage, security, or app-service action
- **THEN** the page calls a typed control function
- **AND** raw Hub path strings and payload shaping remain inside `src/hub`.

#### Scenario: Missing action discovered

- **WHEN** a page comment requires an action not yet supported by `src/hub`
- **THEN** the action is added to `src/hub`
- **AND** tests cover the outgoing path and payload.

### Requirement: All Scaffolded Pages Are Reachable

The terminal client SHALL implement and route to every scaffolded page under `src/client/pages`.

#### Scenario: Navigate from Home

- **WHEN** the terminal client is running from Home
- **THEN** the user can navigate to Connect, Services, Launcher, install guides, launcher subpages, and security subpages according to each page comment.

#### Scenario: Page action feedback

- **WHEN** an action is loading, succeeds, or fails
- **THEN** the page shows visible terminal feedback without removing focus from the current workflow unless navigation/dismissal is part of the documented page behavior.
