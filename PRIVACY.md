# Privacy policy: GitHub Actions Monitor

*Last updated: 2026-10-13*

GitHub Actions Monitor is a Chrome extension that shows the status of GitHub Actions workflow runs for
repositories you choose: a colored toolbar icon, a popup with each workflow's latest run, and optional desktop
notifications. This policy explains what it handles and where that data goes.

**In short:** the extension has no server and sends nothing to its developer or any third party. It talks only to
GitHub's API, using your own token, and keeps its data in your browser.

## What the extension handles

| Data | Where it comes from | Why |
|---|---|---|
| Your GitHub personal access token | You paste it into the settings page | To read workflow runs from GitHub's API. |
| Your GitHub login name | GitHub's API, when you test or save a token | To confirm which account the token belongs to. |
| The repositories (and branches) you monitor | You | To know what to check. |
| Owner names you added repositories from, and the last owner used | You | To offer them in the popup's Owner field. |
| Workflow run details: workflow names, status, conclusion, branch, commit title and hash, pull request number, the event and the GitHub login that triggered the run, run links, start and finish times, recent runs per workflow, the steps of running and failed runs (names and states, for the step lights), the name of a failed run's failed job and step, and a few lines from that step's log that say why it failed (GitHub masks secrets in logs) | GitHub's API | To show status in the icon, popup and notifications. |
| The address of the current tab, when you open the popup (or, while docked in the side panel, of the tab you switch to) | Chrome (the `activeTab` permission) | To offer the repository you are looking at. Kept only while the popup or side panel is open, never stored or sent. |
| HTTP ETags and the last results | GitHub's API responses | To re-check with conditional requests, which do not use your API rate limit. |
| Rate-limit counters | GitHub's API response headers | To show your remaining API requests on the settings page. |
| Settings: polling interval, toolbar badge, notifications on/off, run controls on/off, what the toolbar icon opens, token sync on/off, paused repositories, workflows you switched off, list order, expanded cards | You | To remember your choices. |

The extension does not read the content of web pages (only, as above, the current tab's address when you open the
popup), does not use cookies, and does not collect browsing history, analytics or usage statistics.

## Where data is stored

- **Chrome Sync** (`chrome.storage.sync`, only when you use Chrome Sync): the repository list (with the workflows
  you switched off), remembered owner names, list order, which cards are expanded, polling interval, badge, notification, run-control and
  token-sync preferences, so they follow you to your other Chrome devices. Your token
  is synced **only** if you turn on "Sync token across devices" (off by default). Chrome Sync is operated by Google
  under Google's privacy policy.
- **This device** (`chrome.storage.local`): your token and whether it can re-run and cancel (unless you sync them), the last results shown in the popup,
  the pop-out window's size and position, the ETag cache, the failed job and step of failed runs with those few log lines and their steps, and the rate-limit counters. This storage is not encrypted by Chrome; websites and other
  extensions cannot read it.

## Where data is sent

Only to GitHub's API (`api.github.com`) over HTTPS, with your token in the `Authorization` header, to read
workflow runs, the jobs of running and failed runs, a failed job's log (read once, to quote the lines that
say why), branches, the repositories your token can see and an owner's repository list
when you pick that owner in the popup. Only if you turn on run controls and click re-run or cancel does it ask
GitHub to re-run or cancel that run. With run controls on, the settings page also checks that a fine-grained token
can do this by asking GitHub to cancel a run that has already finished: GitHub declines, and its answer says whether
the token has the permission. Nothing is cancelled. The extension has no backend server; no data is
sent to its developer or to any other party. Data is never sold or used for advertising, credit or any purpose
unrelated to the extension's single purpose. GitHub's privacy statement applies to data GitHub processes.

## Your control

- **Remove token** (settings page) removes the token from this device and from Chrome Sync.
- **Revoke** the token on GitHub at <https://github.com/settings/personal-access-tokens> (fine-grained) or
  <https://github.com/settings/tokens> (classic) to invalidate it everywhere.
- Remove or pause repositories in the popup at any time.
- **Uninstalling** the extension makes Chrome delete its local data.

For safety, use a fine-grained token with **Actions: Read-only** access, limited to the repositories you monitor,
with an expiry. Run controls (off by default) need **Actions: Read and write** instead. The settings page creates one in a click and checks what a token can see.

## Changes

Changes to this policy are published at <https://levac.net/actions-monitor/privacy.html>, with the date above
updated.

## Contact

Questions: James@Levac.net, or open an issue at <https://github.com/JD2005L/GithubActionsMonitor/issues> for anything
that is not private.
