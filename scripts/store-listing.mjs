// The Chrome Web Store submission, field by field, in the Developer Dashboard's order. Single source of truth for
// release/chrome-web-store-<version>/SUBMIT.html (copy buttons) and SUBMIT.md, written by scripts/store-assets.mjs.
//
// Field kinds: text (paste `value`, `limit` = the dashboard's character limit), choice (pick `value`), file (upload
// `files`, relative to the submission folder), checks (tick exactly the options marked true), info (nothing to enter).

// Public pages on levac.net: the product page and privacy policy URLs registered with the store listing.
const SITE = 'https://levac.net/actions-monitor/';

export const PRODUCT = 'GitHub Actions Monitor';

const DESCRIPTION = `Know the moment your build breaks, without keeping a GitHub tab open. GitHub Actions Monitor turns its toolbar icon into a live status light for all the repositories you care about.

AT A GLANCE
• Green: everything passed. Yellow: something is running. Red: something failed (flashing red/green when some passed and some failed). Gray: nothing to show yet.
• A number on the icon counts failing repositories (or running ones when nothing fails).
• Click the icon for a compact card per repository: its state, and where a failure happened ("Test › npm test"), one click from the log.
• Counts of failing, running and passing repositories above the list; click one to see only those.

EVERY WORKFLOW COUNTS
• The latest run of each workflow decides the status, so a failing CI is never hidden by a deploy that finished after it.
• Cancelled and skipped runs are shown but never raise a false alarm.
• Each workflow's last ten runs at a glance, with the commit, pull request and author behind the latest one.
• Switch off noisy workflows: they stay listed but never turn a repository red.
• Runs waiting for a deployment review or an approval are marked, with a link to review them.

FAST WHEN IT MATTERS, QUIET WHEN IT DOESN'T
• Checks every 30 seconds to 5 minutes (your choice), and every 5 seconds while anything is running.
• Rate-limit safe: when nothing changed, GitHub answers "not modified", which does not count against your API limit. The settings page shows live usage.
• Desktop notifications when a workflow starts, succeeds or fails (optional).

MADE FOR REAL PROJECTS
• Watch all branches or a specific branch, and the same repository on several branches.
• Pin one workflow on one branch to its own card, for the run you are waiting on.
• Every result shows the commit it is for, so a green run of an older commit is not mistaken for yours.
• A failure links straight to the failed job's log.
• Pause and resume repositories you are not working on.
• Drag repositories into your own order, or sort by name, recent activity or status.
• Pick an owner, then choose from all of its repositories (private ones included). Owners you use are remembered.
• On a repository's GitHub page, the popup offers to add it.
• Light and dark themes. Settings sync across your Chrome devices.

PRIVATE, AND READ-ONLY BY DEFAULT
• One click opens GitHub's token form already set to read-only Actions access, and a built-in check confirms what the token can see.
• Want to re-run failed jobs or cancel a run from the popup? Switch it on in Settings (it then needs a token with Actions write access). Off by default.
• It talks only to GitHub's API. No server, no analytics, nothing sent to the developer.
• Your token stays on your device unless you choose to sync it.

More, including setup help: ${SITE}`;

const TEST_INSTRUCTIONS = `Uses the reviewer's own GitHub account (free works); no test account.
1. Right-click the icon > Options. Click Next, then "Create a read-only token on GitHub". Generate it, paste it, Save Token.
2. Open github.com/actions/checkout, click the icon, then "Add it", "Add Repo", "Refresh Now".
3. The icon and card turn green, yellow or red; the chevron lists each workflow.
Full steps: https://github.com/JD2005L/GithubActionsMonitor#setup-about-two-minutes`;

export function storeListing(version) {
  return [
    {
      tab: 'Package',
      intro: `Package → Upload new package. Version ${version} is accepted as long as it is higher than the version currently live (or pending review) in the store.`,
      fields: [{ label: 'Upload package', kind: 'file', files: ['1-upload-this.zip'], note: `Version ${version}. Contains only the extension's runtime files (no docs, tests or tooling).` }],
    },
    {
      tab: 'Store listing',
      fields: [
        { label: 'Title', kind: 'info', value: PRODUCT, note: 'Taken from the package (manifest name).' },
        { label: 'Summary', kind: 'info', value: 'Live GitHub Actions status in your toolbar: why a run failed, step-by-step progress, deploys awaiting review, and alerts.', note: 'Taken from the package (manifest description).' },
        { label: 'Description', required: true, kind: 'text', limit: 16000, value: DESCRIPTION },
        { label: 'Category', required: true, kind: 'choice', value: 'Developer Tools' },
        { label: 'Language', required: true, kind: 'choice', value: 'English' },
        { label: 'Store icon', required: true, kind: 'file', files: ['images/store-icon-128.png'], note: '128×128 PNG: the extension icon (status ring on the dark tile), same family as GitHub Repo Navigator.' },
        { label: 'Global promo video', kind: 'info', value: '(leave empty)' },
        {
          label: 'Screenshots',
          required: true,
          kind: 'file',
          files: ['images/screenshots/1-every-pipeline.png', 'images/screenshots/2-why-it-failed.png', 'images/screenshots/3-deployments-live.png', 'images/screenshots/4-alerts-and-actions.png', 'images/screenshots/5-keep-it-in-view.png'],
          note: 'Replace the existing screenshots with all five, in this order. Each is 1280×800, 24-bit PNG, made from a made-up sample account. The desktop alert in screenshot 4 is drawn (Chrome notifications cannot be captured) with the extension’s exact notification text.',
        },
        { label: 'Small promo tile', kind: 'file', files: ['images/promo-tile-440x280.png'], note: '440×280.' },
        { label: 'Marquee promo tile', kind: 'info', value: '(leave empty)' },
        { label: 'Official URL', kind: 'info', value: '(leave as None)' },
        { label: 'Homepage URL', kind: 'text', value: SITE },
        { label: 'Support URL', kind: 'text', value: `${SITE}#support` },
        { label: 'Mature content', kind: 'choice', value: 'No (leave unticked)' },
      ],
    },
    {
      tab: 'Privacy',
      fields: [
        {
          label: 'Single purpose description',
          required: true,
          kind: 'text',
          limit: 1000,
          value:
            "Shows the status of GitHub Actions workflow runs for repositories the user chooses: a toolbar icon colored by the combined status (with a count of failing repositories), a popup listing each workflow's latest run, and optional notifications when a run starts, succeeds or fails. If the user turns it on, the popup can also re-run failed jobs or cancel a run.",
        },
        {
          label: 'storage justification',
          required: true,
          kind: 'text',
          limit: 1000,
          value:
            "Stores the user's settings (the repositories to monitor and any workflows the user switched off, the list order, which repository cards are expanded, the polling interval, the badge, notification and run-control preferences) in chrome.storage.sync so they follow the user to their other Chrome devices. On the device (chrome.storage.local) it stores the user's GitHub token, the last results shown in the popup, the failed job and step of failed runs with a few lines from its log, and HTTP ETags that let it re-check repositories with conditional requests. The token is only synced if the user explicitly turns that on.",
        },
        {
          label: 'alarms justification',
          required: true,
          kind: 'text',
          limit: 1000,
          value:
            "Re-checks the monitored repositories' workflow runs on the user's chosen interval (30 seconds to 5 minutes) in the background, so the toolbar icon stays current without the popup being open. Chrome alarms are the Manifest V3 way to run periodic work in a service worker.",
        },
        {
          label: 'notifications justification',
          required: true,
          kind: 'text',
          limit: 1000,
          value:
            'Shows a desktop notification when a monitored workflow starts, succeeds or fails, so the user learns about a broken build without looking at the browser. Notifications can be turned off on the settings page; clicking one opens the workflow run on GitHub.',
        },
        {
          label: 'activeTab justification',
          required: true,
          kind: 'text',
          limit: 1000,
          value:
            "When the user opens the popup on a GitHub repository page, the popup reads that tab's address once to offer adding the repository (\"This tab: owner/repo, Add it\") and to fill in the add form, including the branch. The address is not stored or sent anywhere, and no page content is read or changed. activeTab grants this only for the tab the user is on, only when they click the extension's icon.",
        },
        {
          label: 'sidePanel justification',
          required: true,
          kind: 'text',
          limit: 1000,
          value:
            "Lets the user dock the extension's own status page (the same page as the popup) in Chrome's side panel, so it stays open while they browse, from a button in the popup or, if they choose it in the settings, by clicking the toolbar icon. The side panel shows only the extension's page; it reads no web page content and adds no access.",
        },
        {
          label: 'Host permission justification',
          required: true,
          kind: 'text',
          limit: 1000,
          value:
            "https://api.github.com/*: reads workflow runs (of a repository, or of one workflow the user pins), the jobs of running and failed runs (to light a light per finished step and name the failed one), a failed job's log once (the extension keeps only the few lines that say why it failed), branches, a repository's workflows, the repositories the user can access and those of an owner the user picks, through GitHub's REST API with the user's own token. It is used to show workflow status and to list an owner's repositories when adding one. It only reads, unless the user turns on run controls in the settings and then clicks re-run or cancel on a run (POST .../rerun-failed-jobs or .../cancel). With run controls on, the settings page checks a fine-grained token's permission by asking to cancel an already finished run, which GitHub declines (409 with the permission, 403 without); nothing is cancelled. No other hosts are contacted.",
        },
        { label: 'Are you using remote code?', required: true, kind: 'choice', value: 'No, I am not using Remote code', note: 'All code ships in the package. No eval, remote scripts or WebAssembly.' },
        {
          label: 'What user data do you plan to collect from users now or in the future?',
          kind: 'checks',
          options: [
            ['Personally identifiable information', true, 'The GitHub login name, shown by the token check ("Signed in as @name").'],
            ['Health information', false],
            ['Financial and payment information', false],
            ['Authentication information', true, 'The GitHub personal access token the user pastes in, kept on the device (or Chrome Sync if the user opts in) and sent only to GitHub.'],
            ['Personal communications', false],
            ['Location', false],
            ['Web history', false, 'Only the current tab’s address, read once when the user opens the popup to offer that repository; never stored or sent.'],
            ['User activity', false],
            ['Website content', false, 'Workflow and repository data come from GitHub’s API, not from reading web pages.'],
          ],
        },
        {
          label: 'I certify that the following disclosures are true',
          kind: 'checks',
          options: [
            ['I do not sell or transfer user data to third parties, outside of the approved use cases', true],
            ['I do not use or transfer user data for purposes that are unrelated to my item’s single purpose', true],
            ['I do not use or transfer user data to determine creditworthiness or for lending purposes', true],
          ],
        },
        { label: 'Privacy policy URL', required: true, kind: 'text', value: `${SITE}privacy.html`, note: 'Published on levac.net; the same policy is in PRIVACY.md in this folder and on the project website.' },
      ],
    },
    {
      tab: 'Distribution',
      fields: [
        { label: 'Payments', kind: 'choice', value: 'Free of charge' },
        { label: 'Visibility', kind: 'choice', value: 'Public (keep the current setting)' },
        { label: 'Distribution', kind: 'choice', value: 'All regions (keep the current setting)' },
      ],
    },
    {
      tab: 'Test instructions',
      fields: [
        { label: 'Test instructions', kind: 'text', limit: 500, value: TEST_INSTRUCTIONS },
        { label: 'Username / Password', kind: 'info', value: '(leave empty: reviewers use their own GitHub account)' },
      ],
    },
    {
      tab: 'Submit',
      fields: [{ label: 'Submit for review', kind: 'info', value: 'Status → Submit for review. The current version stays live until the update is approved.' }],
    },
  ];
}
