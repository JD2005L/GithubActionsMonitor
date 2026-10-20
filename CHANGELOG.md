# Changelog

All notable changes to GitHub Actions Monitor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Current Features (v3.1.0)

**GitHub Actions Monitor** is a Chrome extension that provides real-time monitoring of GitHub Actions workflows across multiple repositories with intelligent status indication and adaptive polling.

### Core Features

- **🎨 Dynamic Colored Icon**: Extension icon changes color based on workflow status
  - 🟡 Yellow (highest priority): Any workflow running/queued
  - 🟢 Green: All workflows successful
  - 🔴🟢 Flashing Red/Green: Mixed success/failure (1-second intervals)
  - 🔴 Red: All workflows failed
  - ⚪ Gray: No data or errors

- **⚡ Adaptive Smart Polling**: Automatically adjusts polling speed
  - Normal mode: User-configurable interval (30s to 5min, default 30s)
  - Conditional requests: unchanged checks are free "304 Not Modified" answers
  - Fast mode: Automatically switches to 5-second polling when any workflow is active
  - Returns to normal mode when all workflows complete

- **👤 Owner and Repository Picker**: Type an owner, pick from all of its repositories
  - Lists every repository of the owner the token can see, private ones included
  - Owners you added repositories from are remembered (synced); the last one is filled in on open
  - Private, archived and already monitored repositories are labelled

- **🌿 Per-Branch Monitoring**: Monitor specific branches
  - Select individual branches or "All branches" per repository
  - Same repo can be monitored on multiple branches
  - Branch selector auto-populates from GitHub API

- **⏸ Enable/Disable Repository Monitoring**: Pause monitoring to conserve API requests
  - Toggle button (⏸/▶) for each repository
  - Disabled repos grayed out and moved to bottom
  - Disabled repos skipped during polling
  - Useful for repos not in active development

- **🧩 Every Workflow Counts**: The latest run of each workflow decides the status, listed per workflow with a
  live run timer

- **🌙 Dark Mode**: Popup and settings follow the browser/OS theme

- **🔐 Read-Only Token Setup**: One-click fine-grained token with Actions: Read-only, plus a token check

- **📝 Commit Title Display**: See what triggered each workflow
  - Action labels show commit message titles instead of generic workflow names
  - Provides immediate context about changes
  - Branch name shown next to repository

- **🔔 Desktop Notifications**: Real-time alerts for status changes
  - Colored icons matching workflow status
  - Clickable to open workflow run in GitHub
  - Smart filtering: only notifies on actual status changes
  - User-controllable via settings

- **☁️ Chrome Sync Support**: Settings sync across devices
  - Repository list, polling interval, and notification preferences sync automatically
  - Optional token sync (disabled by default for security)

### API Efficiency
- Conditional requests: unchanged checks are free (304), even during 5-second fast polling
- Paused repositories are not checked at all
- Rate limit handling: pauses until the limit resets, and the settings page shows remaining requests

---

## [3.1.0] - 2026-10-13

### Added
- **Side panel, pop-out and keep on top**: buttons in the popup's header dock it into Chrome's side panel (it
  stays open while you browse; it follows the active tab for "This tab") or pop it out into a window of its own,
  which remembers its size and position (only one: a second click brings it forward). From the pop-out window or
  the side panel, "Keep on top" opens Chrome's Document Picture-in-Picture window, which stays above every other
  window and can sit in a corner; it shows the same page in a frame, and the pop-out window is minimized behind
  it until it is closed. Settings, Monitoring: the toolbar icon can open the side panel instead of the popup. In
  these views the page fills the width it is given; when narrow, the title shortens and Refresh becomes an icon.
  New permission: sidePanel (no install warning).

### Changed
- Failure notifications read "CI failed" instead of "CI failed: 1 failing"; the repository's state is added only
  when it says more ("2 failing, 1 running").
- The store summary names what the extension does now: "Live GitHub Actions status in your toolbar: why a run
  failed, step-by-step progress, deploys awaiting review, and alerts."

### Fixed
- A card's step lights followed its first in-progress workflow, so a deployment waiting for approval hid a
  running deploy's lights. They now follow the workflow that is actually running.

---

## [3.0.0] - 2026-10-13

A major version: the popup is rebuilt around status (compact cards, filters, the add form folded away), the
settings page asks for features before the token and shows a saved token as a status card, and the extension
gains its first optional write actions (re-run and cancel) along with reading job steps and logs. Existing
settings, repositories and tokens carry over unchanged.

### Added
- **Count on the toolbar icon**: the number of failing repositories (red), or running ones (amber) when nothing
  fails. Hovering the icon names both counts. Settings: failing else running (default), failing only, or no
  number.
- **Failed step**: a failed workflow names its failed job and step ("Test › npm test") in the card's state line,
  in its expanded row (linking to that job's log) and in the failure notification. It costs one request per
  failed run (the run's jobs), once: the answer is cached by run and attempt.
- **The error itself**: a failed workflow's expanded row quotes the lines from its log that say why ("Expected:
  200 / Received: 500", "SqlException : Invalid object name ..."), and the card's hover text and the failure
  notification show the first one. The extractor reads only the failed step's part of the log (by the step's
  start and end times), prefers errors the step reported itself (::error) over the generic "exit code 1", and
  otherwise picks exceptions, failed tests, expected/received and compiler errors, without stack traces. One
  more request per failed run, once (GitHub redirects to its log storage, which allows cross-origin reads, so no
  new permission). Logs that expired are skipped.
- **Step lights**: a running workflow shows a small light per step, grouped by job, lit green as each step
  finishes, the running one pulsing amber, with the step it is on ("Test › npm test"), on the card and in its
  expanded row. Failed runs show how far they got, with the failed step in red. A run with many jobs (a matrix)
  gets a light per job. Running runs' jobs are asked at most every 10 seconds, conditionally (unchanged answers
  are free 304s); failed runs reuse the jobs already asked for the failed step.
- **Run history**: each workflow's last ten runs as a small strip of colored bars, from the same response the
  status comes from (no extra requests).
- **Run context**: expanded cards show the headline run's commit title, pull request, who triggered it, the event
  and the commit hash (pull request and commit link to GitHub); hover text on every card and workflow says the
  same.
- **Ignore workflows**: a switch per workflow. Switched off, it stays listed (dimmed) but no longer decides the
  repository's color, the counts, the badge or notifications. Kept per repository and branch, synced.
- **Reviews**: runs waiting for a deployment review or an approval are marked "Review", linking to the run, and
  counted in the summary ("1 running, 1 awaiting review").
- **This tab**: on a repository's GitHub page, the popup offers that repository and fills in the add form,
  including the branch from a /tree/ address. Uses the `activeTab` permission (no install warning): the address
  is read once when the popup opens, never stored or sent.
- **Re-run and cancel** (optional, off by default): re-run failed jobs and cancel running runs from an expanded
  card. Needs a token with Actions: Read and write; with a read-only token GitHub's refusal is explained.
- **Setup steps**: the Setup tab asks for the optional features first (badge, notifications, re-run and cancel),
  then the token, then shows where repositories are added. Because re-run and cancel come before the token, the
  token link asks GitHub for exactly the permission needed (Actions: Read-only, or Read and write), so only one
  token is ever made. Turning re-run and cancel on later with a token already saved shows how to add the
  permission to that same token on GitHub (a fine-grained token keeps its value), or how to check a classic
  token's scope. Each step can be opened directly.
- **Connected token card**: once a token is saved, the Connect GitHub step shows a status card instead of the
  instructions: "Connected as @login", token type and where it is stored, repositories it can see, API requests
  left, and whether re-run and cancel are allowed, with Check again, Replace token and Remove token. It is checked
  when the page opens. With re-run and cancel on, the check tests for Actions: Read and write: a classic token by
  its scopes, a fine-grained token by asking GitHub to cancel an already finished run (409 means allowed, 403 means
  not; nothing is cancelled). Only a token found without it shows how to add it. GitHub accepting or refusing a
  re-run or cancel in the popup also updates it. A token GitHub no longer accepts opens the instructions again.

### Changed
- **Popup layout**: status first. Refresh Now and Settings sit in the header; a summary of failing, running,
  awaiting-review and passing repositories doubles as a filter; the add form folds away behind **+ Add** (open
  when nothing is monitored yet, or from "This tab"). Cards are two lines (name and branch; state), with pause and
  remove shown on hover and the workflows one click away. Expanded cards are remembered and synced, so every
  browser opens the same cards, and an open popup follows changes synced from another browser live: expanded
  cards, the sort, the custom order, pauses, additions and removals. "Last checked" moved to the footer, once
  for all.
- **Themed controls**: buttons, dropdowns, switches and chips follow the light and dark themes instead of the
  browser's defaults, in the popup and on the settings page. Icons are drawn as lines in the theme's colors.
- The "Polling & notifications" settings tab is now **Monitoring** and also holds the badge and run-control
  settings. Paused repositories are listed under "Paused".

---

## [2.8.1] - 2026-10-05

### Fixed
- **"No branches found or access denied" on private repositories** with the recommended read-only token. GitHub's
  branch list needs "Contents: Read" on a fine-grained token for private repositories, which would also allow
  reading code, so the read-only token (Actions + Metadata) is refused. The popup now falls back to the branches
  that appear in the repository's recent workflow runs, and says so. "All branches" is always offered, so adding a
  repository is never blocked by the branch list (before, the Add button stayed disabled).

---

## [2.8.0] - 2026-10-04

### Added
- **Reorder the repository list**: drag a repository by its handle (⠿) above or below another, or focus the handle
  and use the up and down arrow keys (announced to screen readers). Active and paused repositories are ordered
  separately; paused ones stay at the bottom.
- **Sort**: a Sort menu above the list: Custom order (yours), Name, Recent activity (newest workflow start or
  update first; a running workflow counts as now) or Status (running, failing, passing, unknown). The choice is
  remembered and synced. Reordering while sorted starts your custom order from what is shown, so "sort by name,
  then move a few" works.
- The list header shows how many repositories are monitored.

### Changed
- A poll that finishes during a drag re-renders the list after the drop instead of replacing the item being
  dragged.

---

## [2.7.3] - 2026-10-03

### Changed
- **Refresh Now** shows its progress in the button itself (a spinner and "Refreshing", then "✓ Refreshed" for
  two seconds) instead of a status text beside it, which wrapped onto a new line and pushed the buttons up. The
  button keeps a fixed width, so nothing around it moves. Refresh errors appear in the status line under the form.

---

## [2.7.2] - 2026-10-03

### Changed
- **Refresh Now** sits next to **Add Repo** at the top of the popup instead of below the repository list,
  which pushed it out of view with more than a few repositories.
- The repository count ("60 from octo-dev") is shown next to the **Repository** label, since it describes that
  dropdown's items; the status line below the form is left for loading, branch and error messages.

---

## [2.7.1] - 2026-10-03

### Fixed
- The repository list no longer has its own scroll box inside the popup (a second scrollbar next to the
  popup's): it grows with the popup, which scrolls as a whole once it reaches Chrome's 600px popup limit.

---

## [2.7.0] - 2026-10-03

### Added
- **Owner field**: the popup asks for an owner (your username or an organization) first. Owners you have added
  repositories from are remembered and synced, offered when you click the field (most recent first, with how many
  repositories each has monitored), and can be forgotten once nothing of theirs is monitored. The last owner used is
  filled in when the popup opens, with its repositories ready.
- **Repository dropdown**: choosing an owner lists all of its repositories to pick from, instead of searching by
  name. It merges the owner's own listing with the repositories your token can reach, so a user's private
  repositories and an organization's private repositories both appear. Private, archived and already monitored
  repositories are labelled.
- **Tabbed settings**: Setup, Polling & notifications, API usage and How it works, in the same style as GitHub
  Repo Navigator. Without a token the page opens on Setup (marked with a dot); otherwise on the last tab used.
  Arrow keys switch tabs and `#setup`, `#monitoring`, `#usage`, `#guide` link straight to one.

### Removed
- The "owner/repo" search box and GitHub repository search: the owner picker lists the same repositories (and an
  owner's complete set) without a search request per keystroke.

---

## [2.6.0] - 2026-10-01

### Added
- **Every workflow counts**: a repository's status now comes from the latest run of *each* workflow, not just the
  newest run. Before, a failing CI could be hidden by a deploy that finished after it and the icon showed green.
  The popup lists each workflow (state, timing, click to open the run); the repository line summarizes it
  ("1 running, 1 failing", "All 3 workflows passing").
- **Live run timer**: running workflows count up ("running 3m 12s") while the popup is open; finished ones show
  how long they took.
- **Dark mode**: the popup and settings follow the browser/OS theme, using GitHub's dark palette.
- **Read-only token setup**: "Create a read-only token on GitHub" opens GitHub's fine-grained token form with
  Actions: Read-only already set. A **Test Token** check (also run on save) shows the account, token type, how
  many repositories it can see and the remaining rate limit, and warns when a classic token carries write scopes.
- **Live API usage** on the settings page: last check, requests made, how many were free, remaining rate limit.
- **New icon**: a status ring on a dark tile (same family as GitHub Repo Navigator); the toolbar icon is the tile
  with a solid status-colored circle.

### Changed
- **Rate-limit-safe polling**: requests are conditional (ETags). Unchanged answers come back as "304 Not
  Modified", which GitHub does not count against the 5,000 requests/hour limit. Previously every request was
  cache-busted, so fast mode with ~10 repositories could exceed the limit within an hour.
- Cancelled, skipped and neutral runs are shown but no longer turn a repository red.
- The 15-second polling option is gone: Chrome runs background alarms at most every 30 seconds, so it never
  applied. Saved 15-second settings show as 30.
- Token guidance recommends a fine-grained read-only token instead of the classic `repo` scope (full write access).

### Fixed
- Commit titles, workflow names and repository search results are rendered as text. They come from GitHub, where
  anyone can author them, and were inserted as HTML.
- Pausing a repository updates the toolbar icon immediately instead of at the next poll.
- Toggling a repository whose saved entry had no `enabled` property did nothing (the toggle flipped the stored
  value instead of the effective state).
- Fine-grained tokens (`github_pat_…`) no longer trigger an "unusual format" warning.

### Technical
- `GitHubAPI.summarizeRuns()` (pure, unit-tested), persisted ETag cache, poll statistics
- Development tooling: `scripts/build.mjs` (dist/ and the store zip), unit tests (`node --test`) and browser
  tests (Playwright with a mock GitHub API)

---

## [2.5.0] - 2026-02-07

### Added
- **Enable/Disable Repository Monitoring**: Temporarily pause monitoring for individual repositories
  - Toggle button (⏸ pause / ▶ play) for each repository
  - Disabled repos are visually grayed out with grayscale filter
  - Disabled repos moved to bottom of list with "Disabled Repositories" section header
  - Disabled repos are skipped during polling to reduce API usage
  - State persists across browser sessions
  - Existing repos automatically migrated with enabled: true default

### Improved
- API rate limit management: disable unused repos to conserve requests
- Repository organization: active and disabled repos clearly separated

### Technical
- Extended repo object structure with `enabled` property
- Enhanced `migrateReposFormat()` with Phase 2 migration for enabled property
- Updated polling logic to skip disabled repos
- Added toggle functionality in popup UI with sorting logic

---

## [2.4.3] - 2026-01-30

### Documentation
- **Comprehensive Settings Page Update**: Updated settings page with all current features
  - Added "Getting Started" section with step-by-step instructions
  - Updated icon colors section to reflect new priority system with flashing states
  - Added "Repository Features" section documenting autocomplete, per-branch monitoring, and commit title display
  - Enhanced notifications section with detailed feature list
  - Improved priority order explanation
- **Enhanced Changelog**: Added comprehensive "Current Features" summary at top of changelog for quick reference

## [2.4.2] - 2026-01-30

### Fixed
- **Autocomplete Error Handling**: No results now shows "Nothing found" in UI instead of logging errors to console
  - Removed console.error and console.warn from search failures
  - Displays user-friendly "Nothing found" message with description
  - Styled with reduced opacity and non-clickable state

## [2.4.1] - 2026-01-30

### Improved
- **Private Repository Support in Autocomplete**: Private repositories now appear in autocomplete suggestions with partial name matches
  - Uses `/user/repos` API endpoint to fetch all accessible repos (including private)
  - Combines results from user repos and public search
  - Shows 🔒 icon for private repositories in dropdown
- **Wider Autocomplete Dropdown**: Increased dropdown width to 2x the input field width for better visibility of repository names and descriptions

### Technical
- Modified `searchRepositories()` to fetch user's accessible repos in addition to public search
- Added deduplication logic using Map to prevent duplicate entries
- Updated CSS width from `right: 0` to `width: 200%`
- Added `isPrivate` flag to repository results

## [2.4.0] - 2026-01-30

### Added
- **Repository Name Autocomplete**: Type to search for repositories with real-time suggestions
  - Debounced input (300ms) to avoid excessive API calls
  - Uses GitHub's search API to find matching repositories
  - Shows repository name and description in dropdown
  - Prevents 404 errors from incomplete repo names
  - Auto-fills when a suggestion is selected

### Technical
- Added `searchRepositories()` function to github-api.js
- Implemented debouncing for both autocomplete and branch fetching
- Added autocomplete UI components and styling

## [2.3.2] - 2026-01-30

### Fixed
- **Indicator Light Priority**: Updated status aggregation logic
  - Yellow (in-progress) now has highest priority
  - When no workflows are in-progress and there's a mix of green/red statuses, indicator flashes between red and green at 1-second intervals
  - All green shows solid green
  - All red shows solid red
  - Any yellow shows solid yellow (highest priority)

### Technical
- Refactored `aggregateStatus()` to support 'mixed' state
- Added flashing interval support in `updateBadge()`
- Split icon drawing into separate `drawIcon()` function

## [2.3.1] - 2026-01-30

### Fixed
- **Commit Title Display**: Action labels now show commit message title instead of workflow name
  - Reduces redundancy since branch is already shown next to repo name
  - Provides more context about what changes triggered the workflow
  - Falls back to workflow name if commit title unavailable

### Technical
- Added `commitTitle` field extraction from GitHub API response
- Modified `formatWorkflowInfo()` to prioritize commit title

## [2.3.0] - 2026-01-30

### Added
- **Per-Branch Monitoring**: Monitor specific branches instead of all branches
  - Branch selector dropdown when adding repositories
  - Fetches available branches from GitHub API
  - "All branches" option remains available
  - Unique tracking per repo+branch combination
  - Automatic migration from old format

### Technical
- Implemented `fetchBranches()` API function
- Migrated repo storage format from strings to objects
- Updated polling logic to support branch filtering
- Added branch UI controls and status feedback

## [2.2.1]

### Fixed
- Notification titles no longer include emoji indicators (emojis shown in message body instead)
- Notifications now use colored icons instead of grey icons

## [2.2.0]

### Added
- **Desktop Notifications**: Real-time alerts for workflow status changes
  - 🟡 Workflow Started - Alerts when a workflow begins running
  - ✅ Workflow Succeeded - Celebrates successful workflow completion
  - ❌ Workflow Failed - Notifies immediately when a workflow fails
  - Clickable notifications open workflow run in GitHub
  - Smart filtering to avoid noise (no gray status, no first poll)
  - Higher priority for failures
  - Toggle on/off in Settings
  - Enabled by default
  - Syncs preference across devices

### Technical
- Added `createStatusNotification()` function
- Implemented status change detection with `checkStatusChanges()`
- Added notification click handler to open workflow URLs
- Colored notification icons using `generateIconDataUrl()`

## [2.1.1]

### Fixed
- **Status Stuck on Yellow**: Critical fix for indicator remaining yellow after workflow completion
  - Implemented true 5-second fast polling using `setTimeout` hybrid approach
  - Added aggressive cache-busting with timestamp query parameters
  - Added Cache-Control headers to disable HTTP caching
  - Enhanced workflow status detection for waiting/requested/pending states

### Technical
- Chrome Alarms API 1-minute minimum enforced properly
- Hybrid polling: setTimeout for active workflows, alarm as backup
- Added diagnostic logging for data freshness tracking
- Improved service worker state persistence

## [2.1.0]

### Added
- **Chrome Sync Support**: Synchronize settings across devices
  - User-controlled token sync (optional)
  - Repository list always synced
  - Polling interval synced
  - Notification preferences synced
  - Token stored locally by default for security

### Technical
- Implemented StorageManager for sync/local storage handling
- Automatic token migration between storage locations
- Settings page controls for sync preferences

## [2.0.0]

### Added
- **🎨 Dynamic Extension Icon**: Icon changes color based on workflow status
  - 🟢 Green = All workflows passed
  - 🟡 Yellow = Workflows running/queued
  - 🔴 Red = One or more failures
  - ⚫ Gray = No repos configured
  - Priority-based aggregation (Red > Yellow > Green > Gray)

- **⚡ Adaptive Smart Polling**: Automatic polling speed adjustment
  - **Normal Mode** (default 30 seconds): Efficient API usage when stable
  - **Fast Mode** (5 seconds): Automatically activates when any workflow is running
  - Near real-time updates during workflow execution
  - ~75% reduction in API requests during normal operation
  - Can safely monitor 40+ repos within GitHub's API limits

- **⚙️ Dedicated Settings Page**
  - Right-click extension icon → Options
  - Token management separated from main popup
  - Configurable polling intervals (15s to 5min)
  - Comprehensive "How It Works" documentation
  - API usage estimates
  - Visual color legend

### Improved
- Cleaner popup focused on repository monitoring
- Settings button (⚙️) in popup header
- Better visual feedback with colored status indicators
- Better separation of concerns
- Removed icon generation scripts (now generated dynamically)

### Technical
- Created icon-manager.js for dynamic icon generation
- Implemented adaptive polling with alarm management
- Added comprehensive settings UI
- OffscreenCanvas for icon rendering

---

## Version History Summary

- **2.5.0** - Enable/disable repository monitoring
- **2.4.0** - Repository autocomplete
- **2.3.2** - Indicator priority fix with flashing for mixed states
- **2.3.1** - Display commit titles in action labels
- **2.3.0** - Per-branch monitoring support
- **2.2.1** - Notification improvements
- **2.2.0** - Desktop notifications
- **2.1.1** - Fix yellow status stuck bug
- **2.1.0** - Chrome Sync support
- **2.0.0** - Dynamic icons and adaptive polling (major release)

---

**Repository**: https://github.com/JD2005L/GithubActionsMonitor
