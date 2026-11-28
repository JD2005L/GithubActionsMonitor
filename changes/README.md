# Change fragments

This repo follows the fleet release versioning standard (JD2005L/ProjectWorkbench `standards/release-versioning/`). Fragments here are Markdown (`.md`); the extension has no in-app What's new.

One file per PR under `changes/`, named after the branch (`changes/fix-door-lock-prep.md`), lowercase `[a-z0-9][a-z0-9._-]*`, ending `.md` or `.json`. A fragment is never edited or deleted by a later PR (the guard fails that): to correct shipped text, add a new fragment.

Markdown, for changelogs and simple What's new:

```markdown
---
bump: minor
title: Lock prep on door standard 161
---
Quotes now price lock prep on doors built to standard 161.
```

JSON, for apps whose What's new items carry structured fields (ALSOps). Every key except `bump` (and `retire`) is copied into the compiled item as is:

```json
{
  "bump": "minor",
  "code": "door-standard-161-lock-prep",
  "area": "QuotesAndInvoices",
  "title": "Lock prep on door standard 161",
  "now": "Quotes price lock prep on standard 161 doors.",
  "why": "Estimators were adding it by hand."
}
```

`bump` is strict semver, chosen for what the change does to users and integrators: `major` breaks something (an API, a file format, a workflow people rely on), `minor` adds a feature, `patch` fixes. `none` means nobody outside the team will notice (a test-only refactor, an internal tool): it needs no text and produces no What's new entry. A PR with several changes may add several fragments; the release takes the highest bump among everything unreleased, never the first number someone picked. Going to 1.0.0 (ALSOps go-live) is a `major` fragment in the go-live PR.

`"retire": ["code", ...]` in a JSON fragment retires older What's new items (ALSOps' `retired` list).

