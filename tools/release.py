#!/usr/bin/env python3
"""release.py: fleet release-versioning tool (JD2005L release-versioning standard).

A PR never edits the shared version line or the shared changelog. It adds its own
change fragment file under the fragments dir (default changes/). The version is
assigned after merge, at deploy time: last release tag plus the highest bump among
fragments added since that tag. The deploy pushes the tag.

Python 3.8+, standard library only. Vendor this file as tools/release.py.

Usage:
  release.py next   [--ref HEAD] [--json] [--github-output]
  release.py tag    [--ref HEAD] [--push] [--remote origin]
  release.py notes  [--ref HEAD] [--format json|markdown] [--out FILE]
  release.py whats-new [--ref HEAD] [--out FILE]
  release.py guard  --base SHA --head SHA [--vendored tools/release.py]

Common options: --repo DIR (default: cwd), --config FILE (default: .release.json).

Config (.release.json):
  {"base": "4.2.0", "tagPrefix": "v", "fragments": "changes",
   "protect": [{"path": "src/App/App.csproj", "pattern": "<Version>"},
               {"path": "src/App/seed/whats-new.json"}],
   "noRelease": ["docs/**", "*.md"]}

Fragment (changes/<name>.md): front matter with bump: major|minor|patch|none, then
the user-facing text. Extra keys (title, audience, ...) pass through to the notes.
A fragment may instead be changes/<name>.json: an object with "bump" and any other
item data (passed through as-is; "retire": [...] lists codes to retire).
Optional "whatsNew": {"out", "listKey", "versionKey", "dateKey", "retireKey"} in the
config drives the whats-new command (flat item list for an in-app What's new page).

Exit codes: 0 ok, 1 guard failure or tag race lost, 2 git or config error.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

TOOL_VERSION = "1.0.1"

BUMPS = ("major", "minor", "patch", "none")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*\.(md|json)$")
BUILTIN_NO_RELEASE = [
    ".github/**", "**/CLAUDE.md", "**/AGENTS.md",
    ".gitattributes", ".gitignore", ".editorconfig",
]


class ToolError(Exception):
    """A git or configuration problem (exit code 2)."""


# ---------------------------------------------------------------- git helpers

def run_git(repo, args, check=True):
    try:
        proc = subprocess.run(
            ["git", "-C", repo] + list(args),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, encoding="utf-8", errors="replace",
        )
    except OSError as exc:
        raise ToolError("cannot run git: %s" % exc)
    if check and proc.returncode != 0:
        raise ToolError("git %s failed (exit %d): %s" % (
            " ".join(args), proc.returncode, proc.stderr.strip()))
    return proc


def git(repo, *args):
    return run_git(repo, args).stdout


def git_lines(repo, *args):
    return [ln for ln in git(repo, *args).split("\n") if ln.strip()]


def git_show(repo, rev, path):
    """File content at rev, or None when it does not exist there."""
    proc = run_git(repo, ["show", "%s:%s" % (rev, path)], check=False)
    return proc.stdout if proc.returncode == 0 else None


def rev_commit(repo, ref):
    return git(repo, "rev-parse", "--verify", ref + "^{commit}").strip()


# ----------------------------------------------------------------- config

def read_text(path):
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def write_text(path, text, mode="w"):
    with open(path, mode, encoding="utf-8", newline="") as fh:
        fh.write(text)


def config_rel_path(repo, config):
    full = os.path.abspath(os.path.join(repo, config))
    return os.path.relpath(full, os.path.abspath(repo)).replace(os.sep, "/")


def parse_config(text):
    try:
        raw = json.loads(text)
    except ValueError as exc:
        raise ToolError("config is not valid JSON: %s" % exc)
    if not isinstance(raw, dict):
        raise ToolError("config must be a JSON object")
    cfg = {
        "base": raw.get("base"),
        "tagPrefix": raw.get("tagPrefix", "v"),
        "fragments": str(raw.get("fragments", "changes")).strip("/"),
        "protect": raw.get("protect", []),
        "noRelease": raw.get("noRelease", []),
        "whatsNew": raw.get("whatsNew"),
    }
    if cfg["whatsNew"] is not None and not isinstance(cfg["whatsNew"], dict):
        raise ToolError("config: \"whatsNew\" must be an object")
    if not isinstance(cfg["base"], str) or not re.match(r"^\d+\.\d+\.\d+$", cfg["base"]):
        raise ToolError("config: \"base\" must be a version like 4.2.0")
    if not isinstance(cfg["tagPrefix"], str):
        raise ToolError("config: \"tagPrefix\" must be a string")
    if not cfg["fragments"]:
        raise ToolError("config: \"fragments\" must be a directory name")
    if not isinstance(cfg["protect"], list) or not isinstance(cfg["noRelease"], list):
        raise ToolError("config: \"protect\" and \"noRelease\" must be arrays")
    for entry in cfg["protect"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ToolError("config: each protect entry needs a \"path\"")
        if "pattern" in entry:
            try:
                re.compile(entry["pattern"])
            except re.error as exc:
                raise ToolError("config: bad protect pattern for %s: %s" % (entry["path"], exc))
    return cfg


def load_config(repo, config):
    path = os.path.join(repo, config)
    if not os.path.isfile(path):
        raise ToolError("config file not found: %s" % path)
    return parse_config(read_text(path))


# ------------------------------------------------------------------ globs

def glob_to_regex(glob):
    anchored = glob.startswith("/") or "/" in glob
    glob = glob.lstrip("/")
    out = []
    i = 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    prefix = "" if anchored else "(?:.*/)?"
    return re.compile("^" + prefix + "".join(out) + "$")


def no_release_matchers(cfg, config_rel):
    globs = list(BUILTIN_NO_RELEASE)
    globs.append("/" + config_rel)
    globs.append("/%s/README.md" % cfg["fragments"])
    globs.extend(cfg["noRelease"])
    return [glob_to_regex(g) for g in globs]


# ------------------------------------------------------------- fragments

def unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def parse_fragment(text):
    """Return (meta, body, error). meta keeps key order; error is None when valid."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines and lines[0].startswith("﻿"):
        lines[0] = lines[0][1:]
    if not lines or lines[0].strip() != "---":
        return {}, "", "front matter missing (the file must start with a --- line)"
    end = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end is None:
        return {}, "", "front matter is not closed with a --- line"
    meta = {}
    for ln in lines[1:end]:
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        if ":" not in ln:
            return {}, "", "front matter line is not key: value: %r" % ln
        key, value = ln.split(":", 1)
        meta[key.strip()] = unquote(value)
    body = "\n".join(lines[end + 1:]).strip()
    bump = meta.get("bump")
    if bump is None:
        return meta, body, "front matter needs bump: major, minor, patch or none"
    if bump not in BUMPS:
        return meta, body, "bump must be major, minor, patch or none (got %r)" % bump
    if bump != "none" and not body:
        return meta, body, "the fragment body (user-facing text) is empty"
    return meta, body, None


def parse_fragment_file(name, text):
    """Like parse_fragment, for .md or .json fragments."""
    if not name.endswith(".json"):
        return parse_fragment(text)
    try:
        meta = json.loads(text)
    except ValueError as exc:
        return {}, "", "not valid JSON: %s" % exc
    if not isinstance(meta, dict):
        return {}, "", "a JSON fragment must be an object"
    bump = meta.get("bump")
    if bump is None:
        return meta, "", "the object needs bump: major, minor, patch or none"
    if bump not in BUMPS:
        return meta, "", "bump must be major, minor, patch or none (got %r)" % (bump,)
    return meta, "", None


def fragment_item(f):
    """Notes item for a parsed fragment."""
    item = {"id": f["id"], "bump": f["bump"]}
    if f["kind"] == "json":
        for key, value in f["meta"].items():
            if key != "bump":
                item[key] = value
    else:
        item["text"] = f["text"]
        for key, value in f["meta"].items():
            if key != "bump":
                item.setdefault(key, value)
    return item


def is_fragment_path(cfg, path):
    d = cfg["fragments"] + "/"
    if not path.startswith(d):
        return False
    rest = path[len(d):]
    return "/" not in rest and rest != "README.md" and bool(NAME_RE.match(rest))


# ----------------------------------------------------------------- semver

def semver_re(prefix):
    return re.compile(r"^" + re.escape(prefix) + r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def release_tags(repo, cfg, ref):
    """Semver tags at or above base merged into ref, ascending: [(tuple, tagname)].

    Tags below base are left over from an earlier scheme and are ignored, so a repo
    with old tags needs no seed tag at base.
    """
    rx = semver_re(cfg["tagPrefix"])
    floor = vtuple(cfg["base"])
    found = []
    for name in git_lines(repo, "tag", "--merged", ref, "--list", cfg["tagPrefix"] + "*"):
        m = rx.match(name.strip())
        if m:
            ver = tuple(int(g) for g in m.groups())
            if ver >= floor:
                found.append((ver, name.strip()))
    found.sort()
    return found


def bump_version(version, bump):
    x, y, z = version
    if bump == "major":
        return (x + 1, 0, 0)
    if bump == "minor":
        return (x, y + 1, 0)
    return (x, y, z + 1)


def vstr(version):
    return "%d.%d.%d" % version


def vtuple(text):
    return tuple(int(p) for p in text.split("."))


def config_commit(repo, cfg_rel, ref):
    lines = git_lines(repo, "log", "--diff-filter=A", "--format=%H", ref, "--", cfg_rel)
    if not lines:
        raise ToolError("cannot find the commit that added %s on %s; commit the config first" % (cfg_rel, ref))
    return lines[-1].strip()


def fragments_between(repo, cfg, older, newer):
    """Fragments added between two commits, as parsed dicts in add order.

    Invalid fragments are skipped with a warning on stderr.
    """
    d = cfg["fragments"]
    names = set()
    for p in git_lines(repo, "diff", "--name-only", "--no-renames", "--diff-filter=A",
                       older, newer, "--", d + "/"):
        if is_fragment_path(cfg, p.strip()):
            names.add(p.strip())
    if not names:
        return []
    order = {}
    idx = 0
    log = git(repo, "-c", "core.quotepath=false", "log", "--reverse", "--no-renames",
              "--diff-filter=A", "--name-only", "--format=%x01",
              "%s..%s" % (older, newer), "--", d + "/")
    for ln in log.split("\n"):
        if ln.startswith("\x01"):
            idx += 1
        elif ln.strip() and ln.strip() not in order:
            order[ln.strip()] = idx
    result = []
    for p in sorted(names, key=lambda n: (order.get(n, 1 << 30), n)):
        text = git_show(repo, newer, p)
        if text is None:
            continue
        base = p[len(d) + 1:]
        meta, body, err = parse_fragment_file(base, text)
        if err:
            sys.stderr.write("release.py: skipping invalid fragment %s: %s\n" % (p, err))
            continue
        result.append({"id": base.rsplit(".", 1)[0], "file": base, "bump": meta["bump"], "text": body,
                       "meta": meta, "kind": base.rsplit(".", 1)[1]})
    return result


# ------------------------------------------------------------------- plan

def plan(repo, cfg, cfg_rel, ref):
    commit = rev_commit(repo, ref)
    merged = release_tags(repo, cfg, commit)
    at = set(t.strip() for t in git_lines(repo, "tag", "--points-at", commit))
    others = [t for t in merged if t[1] not in at]
    if others:
        prev = others[-1][0]
        anchor = rev_commit(repo, "refs/tags/" + others[-1][1])
    else:
        prev = vtuple(cfg["base"])
        anchor = config_commit(repo, cfg_rel, commit)
    frs = fragments_between(repo, cfg, anchor, commit)
    bumps = [f["bump"] for f in frs if f["bump"] != "none"]
    bump = "patch"
    for level in ("major", "minor", "patch"):
        if level in bumps:
            bump = level
            break
    tagged = [t for t in merged if t[1] in at]
    if tagged:
        version = tagged[-1][0]
    else:
        version = bump_version(prev, bump)
    if version < vtuple(cfg["base"]):
        raise ToolError("computed version %s is below base %s; refusing it" % (vstr(version), cfg["base"]))
    return {
        "commit": commit, "previous": prev, "bump": bump, "version": version,
        "fragments": frs, "tagged": bool(tagged),
    }


# --------------------------------------------------------------- commands

def cmd_next(args, repo, cfg, cfg_rel):
    p = plan(repo, cfg, cfg_rel, args.ref)
    version = vstr(p["version"])
    if args.json:
        out = {
            "version": version, "previous": vstr(p["previous"]), "bump": p["bump"],
            "fragments": [f["file"] for f in p["fragments"]], "commit": p["commit"],
        }
        print(json.dumps(out))
    else:
        print(version)
    if args.github_output:
        target = os.environ.get("GITHUB_OUTPUT")
        if not target:
            raise ToolError("--github-output needs the GITHUB_OUTPUT environment variable")
        write_text(target, "version=%s\n" % version, "a")
    return 0


def cmd_tag(args, repo, cfg, cfg_rel):
    remote = args.remote
    commit = rev_commit(repo, args.ref)
    for attempt in range(1, 6):
        p = plan(repo, cfg, cfg_rel, commit)
        version = vstr(p["version"])
        name = cfg["tagPrefix"] + version
        if p["tagged"]:
            if args.push:
                push = run_git(repo, ["push", remote, "refs/tags/" + name], check=False)
                if push.returncode != 0:
                    raise ToolError("git push of existing tag %s failed: %s" % (name, push.stderr.strip()))
            print(version)
            return 0
        run_git(repo, ["tag", name, commit])
        if not args.push:
            print(version)
            return 0
        push = run_git(repo, ["push", remote, "refs/tags/" + name], check=False)
        if push.returncode == 0:
            print(version)
            return 0
        sys.stderr.write("release.py: push of %s rejected (attempt %d): %s\n" % (
            name, attempt, push.stderr.strip()))
        run_git(repo, ["tag", "-d", name])
        run_git(repo, ["fetch", remote, "--tags", "--force"])
        proc = run_git(repo, ["rev-parse", "--verify", "-q", "refs/tags/%s^{commit}" % name], check=False)
        if proc.returncode == 0 and proc.stdout.strip() == commit:
            print(version)
            return 0
    sys.stderr.write("release.py: could not claim a version tag after 5 attempts\n")
    return 1


def build_releases(repo, cfg, cfg_rel, ref):
    """Every release (plus a pending one), ascending: [(version, date, fragments)]."""
    commit = rev_commit(repo, ref)
    merged = release_tags(repo, cfg, commit)
    releases = []
    prev = None
    for ver, name in merged:
        tc = rev_commit(repo, "refs/tags/" + name)
        if prev is None:
            cc = config_commit(repo, cfg_rel, commit)
            if run_git(repo, ["merge-base", "--is-ancestor", tc, cc], check=False).returncode == 0:
                continue
            prev = cc
        releases.append((vstr(ver), tc, fragments_between(repo, cfg, prev, tc)))
        prev = tc
    p = plan(repo, cfg, cfg_rel, commit)
    if not p["tagged"]:
        releases.append((vstr(p["version"]), commit, p["fragments"]))
    out = []
    for version, tc, frs in releases:
        stamp = int(git(repo, "log", "-1", "--format=%ct", tc).strip())
        date = datetime.datetime.fromtimestamp(stamp, datetime.timezone.utc).strftime("%Y-%m-%d")
        out.append((version, date, frs))
    return out


def build_notes(repo, cfg, cfg_rel, ref):
    out = []
    for version, date, frs in reversed(build_releases(repo, cfg, cfg_rel, ref)):
        items = [fragment_item(f) for f in frs if f["bump"] != "none"]
        if items:
            out.append({"version": version, "date": date, "items": items})
    return out


def build_whats_new(repo, cfg, cfg_rel, ref):
    wn = cfg["whatsNew"] or {}
    list_key = wn.get("listKey", "items")
    version_key = wn.get("versionKey", "version")
    date_key = wn.get("dateKey", "date")
    retire_key = wn.get("retireKey", "retired")
    releases = build_releases(repo, cfg, cfg_rel, ref)
    retired = []
    for _v, _d, frs in releases:
        for f in frs:
            codes = f["meta"].get("retire") if f["kind"] == "json" else None
            if isinstance(codes, list):
                for code in codes:
                    if code not in retired:
                        retired.append(code)
    items = []
    for version, date, frs in reversed(releases):
        for f in frs:
            if f["bump"] == "none":
                continue
            if f["kind"] == "json":
                fields = dict((k, v) for k, v in f["meta"].items() if k not in ("bump", "retire"))
            else:
                fields = {"text": f["text"]}
                for k, v in f["meta"].items():
                    if k != "bump":
                        fields.setdefault(k, v)
            if not fields:
                continue
            fields[version_key] = version
            fields[date_key] = date
            items.append(fields)
    result = {list_key: items}
    if retired:
        result[retire_key] = retired
    return result


def render_markdown(releases):
    blocks = []
    for rel in releases:
        lines = ["## %s (%s)" % (rel["version"], rel["date"]), ""]
        for item in rel["items"]:
            text = str(item.get("text") or item.get("title") or item["id"]).replace("\n", "\n  ")
            title = item.get("title")
            lines.append("- **%s**: %s" % (title, text) if title else "- %s" % text)
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + "\n" if blocks else ""


def cmd_notes(args, repo, cfg, cfg_rel):
    releases = build_notes(repo, cfg, cfg_rel, args.ref)
    if args.format == "json":
        text = json.dumps(releases, indent=2, ensure_ascii=False) + "\n"
    else:
        text = render_markdown(releases)
    if args.out:
        write_text(args.out, text)
    else:
        sys.stdout.flush()
        sys.stdout.buffer.write(text.encode("utf-8"))
        sys.stdout.buffer.flush()
    return 0


def cmd_whats_new(args, repo, cfg, cfg_rel):
    wn = cfg["whatsNew"] or {}
    out_path = args.out or wn.get("out")
    if not out_path:
        raise ToolError("whats-new needs --out or whatsNew.out in the config")
    result = build_whats_new(repo, cfg, cfg_rel, args.ref)
    full = out_path if os.path.isabs(out_path) or args.out else os.path.join(repo, out_path)
    parent = os.path.dirname(full)
    if parent:
        os.makedirs(parent, exist_ok=True)
    write_text(full, json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    return 0


def cmd_guard(args, repo, cfg_arg, _unused):
    cfg_rel = config_rel_path(repo, cfg_arg)
    failures = []  # (file or None, message)
    warnings = []

    head = rev_commit(repo, args.head)
    mb = git(repo, "merge-base", args.base, head).strip()
    head_cfg_text = git_show(repo, head, cfg_rel)
    if head_cfg_text is None:
        failures.append((None, "this repo has no .release.json; see standards/release-versioning/ROLLOUT.md"))
        return report_guard(failures, warnings, "")
    cfg = parse_config(head_cfg_text)
    base_cfg_text = git_show(repo, mb, cfg_rel)
    conversion = base_cfg_text is None
    fdir = cfg["fragments"]

    raw = git(repo, "diff", "--name-status", "--no-renames", "-z", mb, head)
    parts = raw.split("\0")
    changes = {}
    i = 0
    while i + 1 < len(parts):
        changes[parts[i + 1]] = parts[i][:1]
        i += 2

    if not conversion:
        gen = (cfg["whatsNew"] or {}).get("out")
        if gen and gen in changes:
            failures.append((gen, "%s is generated at build time; do not edit it in a PR "
                                  "(it should be gitignored)." % gen))
        for entry in cfg["protect"]:
            path = entry["path"]
            if "pattern" not in entry:
                if path in changes:
                    failures.append((path, "%s is compiled at deploy time; do not edit it in a PR. "
                                           "Add a fragment under %s/ instead." % (path, fdir)))
                continue
            rx = re.compile(entry["pattern"])
            diff = git(repo, "diff", "-U0", mb, head, "--", path)
            for ln in diff.split("\n"):
                if ln[:1] in ("+", "-") and not ln.startswith("+++") and not ln.startswith("---"):
                    if rx.search(ln[1:]):
                        failures.append((path, "%s: version lines are set at deploy time from the "
                                               "release tag; revert this line." % path))
                        break
        old = parse_config(base_cfg_text)
        for key in ("base", "tagPrefix", "fragments"):
            if old[key] != cfg[key]:
                failures.append((cfg_rel, "%s: \"%s\" must not change in a PR (was %r, now %r)" % (
                    cfg_rel, key, old[key], cfg[key])))

    valid_added = 0
    prefix = fdir + "/"
    for path in sorted(changes):
        if not path.startswith(prefix) or path == prefix + "README.md":
            continue
        status = changes[path]
        if status == "A":
            rest = path[len(prefix):]
            if "/" in rest or not NAME_RE.match(rest):
                failures.append((path, "%s: fragment names must be lowercase [a-z0-9][a-z0-9._-]*.(md|json) "
                                       "directly under %s/" % (path, fdir)))
                continue
            text = git_show(repo, head, path)
            _meta, _body, err = parse_fragment_file(rest, text if text is not None else "")
            if err:
                failures.append((path, "%s: %s" % (path, err)))
            else:
                valid_added += 1
        else:
            failures.append((path, "%s: fragments belong to the PR that added them; "
                                   "add a new fragment instead" % path))

    matchers = no_release_matchers(cfg, cfg_rel)
    worthy = [p for p in sorted(changes)
              if not p.startswith(prefix) and not any(m.match(p) for m in matchers)]
    if worthy and valid_added == 0:
        shown = ", ".join(worthy[:10]) + (" (and %d more)" % (len(worthy) - 10) if len(worthy) > 10 else "")
        failures.append((None, "this PR changes release-worthy files (%s) but adds no valid change fragment. "
                               "Add %s/<branch-name>.md with bump: patch|minor|major and the user-facing text, "
                               "or bump: none for a change users never see." % (shown, fdir)))

    if args.vendored:
        text = git_show(repo, head, args.vendored)
        if text is not None:
            m = re.search(r'^TOOL_VERSION\s*=\s*"([^"]+)"', text, re.M)
            have = m.group(1) if m else "unknown"
            if have != TOOL_VERSION:
                warnings.append("%s is release.py %s but the standard is %s; re-vendor it." % (
                    args.vendored, have, TOOL_VERSION))

    note = " (conversion PR)" if conversion else ""
    return report_guard(failures, warnings, "%d changed path(s), %d fragment(s) added%s" % (
        len(changes), valid_added, note))


def report_guard(failures, warnings, summary):
    for w in warnings:
        print("::warning::%s" % w)
    if failures:
        for path, msg in failures:
            print("::error file=%s::%s" % (path, msg) if path else "::error::%s" % msg)
        print("release-guard: FAILED with %d problem(s)" % len(failures))
        for _path, msg in failures:
            print("  - %s" % msg)
        return 1
    print("release-guard: OK (%s)" % summary)
    return 0


# ------------------------------------------------------------------- main

def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--repo", default=".", help="repository directory (default: cwd)")
    common.add_argument("--config", default=".release.json", help="config file (default: .release.json)")
    parser = argparse.ArgumentParser(prog="release.py", description=__doc__.split("\n")[0])
    parser.add_argument("--version", action="version", version="release.py " + TOOL_VERSION)
    sub = parser.add_subparsers(dest="cmd")
    sub.required = True

    p = sub.add_parser("next", parents=[common], help="print the next version")
    p.add_argument("--ref", default="HEAD")
    p.add_argument("--json", action="store_true")
    p.add_argument("--github-output", action="store_true")

    p = sub.add_parser("tag", parents=[common], help="create (and optionally push) the release tag")
    p.add_argument("--ref", default="HEAD")
    p.add_argument("--push", action="store_true")
    p.add_argument("--remote", default="origin")

    p = sub.add_parser("notes", parents=[common], help="compile What's new from fragments")
    p.add_argument("--ref", default="HEAD")
    p.add_argument("--format", choices=("json", "markdown"), default="json")
    p.add_argument("--out")

    p = sub.add_parser("whats-new", parents=[common], help="write the flat What's new JSON")
    p.add_argument("--ref", default="HEAD")
    p.add_argument("--out")

    p = sub.add_parser("guard", parents=[common], help="PR guard")
    p.add_argument("--base", required=True)
    p.add_argument("--head", required=True)
    p.add_argument("--vendored")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    repo = args.repo
    try:
        if args.cmd == "guard":
            return cmd_guard(args, repo, args.config, None)
        cfg_rel = config_rel_path(repo, args.config)
        cfg = load_config(repo, args.config)
        handler = {"next": cmd_next, "tag": cmd_tag, "notes": cmd_notes, "whats-new": cmd_whats_new}[args.cmd]
        return handler(args, repo, cfg, cfg_rel)
    except ToolError as exc:
        sys.stderr.write("release.py: error: %s\n" % exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
