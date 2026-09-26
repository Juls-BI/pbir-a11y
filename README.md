# PBIR A11y CLI

[![License](https://img.shields.io/badge/license-PolyForm--Shield--1.0.0-blue)](./LICENSE) [![Power BI](https://img.shields.io/badge/Power_BI-F2C811?logo=powerbi&logoColor=000)](https://powerbi.microsoft.com) [![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org) [![Claude Code Compatible](https://img.shields.io/badge/Claude_Code-compatible-D97757?logo=claude&logoColor=fff)](https://code.claude.com)

`pbir-a11y` (accessibility checks for Power BI **PBIP/PBIR** projects) for use by a person
during development, or by an AI coding agent (Claude Code, Copilot, etc.)
editing report JSON directly. Same idea as
[pbir.tools](https://github.com/maxanatsko/pbir.tools), but for accessibility
checks instead of general report editing.

This is a CLI translation of the [PBIX A11y](https://pbiaudits.com) browser
tool: same rule engine, same checks, pointed at a project folder on disk
instead of a browser file-drop.

## Quick Start

```bash
npm install
npm run build
npm link
pbir-a11y check ./MyReport
```

That's it: point it at a PBIP project folder and it prints a score plus any
accessibility issues it finds. See Usage below for the full command
reference.

## Use as a Claude Code skill

The repo is also a valid Claude Code plugin (`.claude-plugin/plugin.json` +
`skills/pbir-a11y/SKILL.md`), so an agent editing a PBIP project can pick up
these checks automatically instead of needing to be told to run them.

**Install as a plugin** (mirrors how `pbir.tools` distributes its own
marketplace plugin):

```bash
claude plugin marketplace add <your-github-username>/pbir-a11y
claude plugin install pbir-a11y@pbir-a11y
```

**Or install the skill directly**, without the plugin system: copy the
skill folder into your project or user scope:

```bash
# Project scope (shared with your team via version control)
cp -r skills/pbir-a11y .claude/skills/pbir-a11y

# User scope (available in every project)
cp -r skills/pbir-a11y ~/.claude/skills/pbir-a11y
```

Either way, the CLI itself (`pbir-a11y`) still needs to be installed and on
`PATH` (see Install, above): the skill just tells the agent when and how to
call it.

### Accessible by default, not just audited at the end

`pbir-a11y` is read-only, so on its own it can only tell you about problems
after they exist — it can't build a report or write alt text. To get reports
that are accessible *as you build them*, pair it with a report-authoring
tool or skill (e.g. [`pbir.tools`](https://github.com/maxanatsko/pbir.tools),
or a Power BI agentic-development plugin) and chain the two: the authoring
tool makes a change, `pbir-a11y` checks it immediately, mechanical issues
(contrast, missing titles, tab order, target size) get fixed and re-checked,
and anything needing judgment (alt text content, design intent) gets
surfaced to you instead of guessed at.

The skill (`skills/pbir-a11y/SKILL.md`) already nudges an agent toward this
loop when an authoring tool is also active in the session. If you want it
spelled out explicitly and consistently for your project regardless of
which agent or authoring tool you're using, copy the relevant block from
[`examples/CLAUDE.md`](./examples/CLAUDE.md) into your PBIP project root —
it includes both a generic version (for `pbir.tools` or similar) and a
version specific to Microsoft's `powerbi-report-design` +
`powerbi-report-authoring` skills from Skills for Fabric, which spells out
a Design → Authoring → Check pipeline.

> **Note on the marketplace install path:** this repo includes
> `.claude-plugin/plugin.json` and `skills/pbir-a11y/SKILL.md`, which is
> Anthropic's documented, required structure for a plugin. It does **not**
> include a `marketplace.json`: the exact schema for self-hosting a
> single-plugin repo as its own marketplace source wasn't something I could
> verify with full confidence when this was put together, so it was left
> out rather than guessed at. If `claude plugin marketplace add
> <username>/pbir-a11y` doesn't pick the repo up as-is, check the current
> schema at `code.claude.com/docs/en/plugin-marketplaces` before assuming
> the plugin itself is broken: the project-scope/user-scope copy method
> above doesn't depend on this and is confirmed to work.

## Why PBIP, not PBIX

A `.pbix` is a compiled binary: nobody hand-edits it, so it doesn't fit a
dev-time, agent-in-the-loop workflow. A PBIP project (`MyReport.pbip` +
`MyReport.Report/` + `MyReport.SemanticModel/`) is a plain, git-diffable
folder tree, and PBIR is the report-definition format inside the `.Report`
folder (`definition/pages/<page>/visuals/<id>/visual.json`). That's what
this CLI reads directly: no zipping, no upload step.

PBIX audit support may come back later as a secondary "check a shipped file"
path, but it's not the primary target.

## Install

```bash
npm install
npm run build
npm link   # optional: exposes `pbir-a11y` globally
```

## Usage

```bash
# Point at the PBIP project folder (auto-finds the *.Report subfolder)
pbir-a11y check ./MyReport

# Or point at the .Report folder directly
pbir-a11y check ./MyReport/MyReport.Report

# Only run one category of check
pbir-a11y check ./MyReport --category altText

# Only show one page
pbir-a11y check ./MyReport --page Overview

# Machine-readable output, for an agent to parse
pbir-a11y check ./MyReport --json

# Exit 0 unless something above "warn" is found (default: fail)
pbir-a11y check ./MyReport --fail-on warn

# Also check pages marked hidden-in-view-mode (drillthrough/tooltip pages),
# which are skipped by default since end users don't land on them directly
pbir-a11y check ./MyReport --include-hidden

# Write a formatted Word document of the findings, e.g. to hand to a client
# or stakeholder alongside (or instead of) the terminal output. This uses the
# bundled templates/audit-template.docx (cover page, Document Information
# section, house style) rather than a generic generated layout.
pbir-a11y check ./MyReport --docx ./audit-findings.docx

# Put a client/customer name on the docx cover page. If omitted, the
# template's own "Customer Name" placeholder is left in place so it can
# still be filled in by hand in Word.
pbir-a11y check ./MyReport --docx ./audit-findings.docx --client "Acme Corp"

# What does a given check actually look for?
pbir-a11y explain tabOrder
pbir-a11y explain          # lists all categories
```

**A note on console output:** `check` prints every issue it finds, with no
truncation or pagination on the tool's side  -  but a narrow or short terminal
window can still scroll earlier findings out of view before you get a chance
to read them. If you're not sure you're seeing the full list, either widen/
maximise the terminal first, or redirect to a file so nothing is lost:

```bash
pbir-a11y check ./MyReport --json > results.json
```

Exit code is `0` when nothing at or above `--fail-on` severity is found, `1`
when something is, and `2` on a genuine error (bad path, unreadable project).
That makes `check` usable as a CI gate or a pre-commit hook, not just a
manual report.

## What's ported vs. new

Everything under `src/lib/` is the existing PBIX A11y rule engine, copied
across unchanged except where noted below:

| File | Status |
|---|---|
| `contrastUtils.ts`, `apca.ts`, `colourblindUtils.ts`, `contrastSuggest.ts`, `fontScaling.ts`, `clutterIndex.ts`, `customVisuals.ts` | **Unchanged.** Pure logic, no browser dependency. |
| `rulesEngine.ts`, `pbixParser.ts` | **Extended for visual-group support.** `pbixParser.ts` now parses and forwards a group's `groupDisplayName`; `rulesEngine.ts` uses it to describe groups in messages, gives groups the same `altText` presence/placeholder checks as any other visual (Desktop does offer groups a static alt-text field), and flags a group left with no name or Power BI's default name. No existing rule's logic or output changed for non-group visuals. |
| `pbirParser.ts` | **Lightly refactored.** The original `parsePbir(file: File)` only ever loaded a zip via a browser file-drop. It's now split into `parsePbir(file: File)` (unchanged, still there for anything browser-based) and a new `parsePbirFromZip(zip, name, size)` that takes an already-built JSZip instance. `parsePbir` calls `parsePbirFromZip` internally: no rule logic changed, only where the zip gets built. |

Everything under `src/io/` and `src/commands/`, plus `src/cli.ts`, is new, as
are `.claude-plugin/plugin.json` and `skills/pbir-a11y/SKILL.md` (the agent
packaging):

- **`src/io/loadFromFolder.ts`**: walks a PBIP project folder on disk and
  builds an in-memory JSZip mirroring it, then hands that straight to
  `parsePbirFromZip`. This is what lets the CLI read a real folder instead
  of requiring a zip upload.
- **`src/commands/check.ts`**: runs `analyze()` against the loaded report,
  prints a human summary or `--json`, sets the process exit code.
- **`src/commands/explain.ts`**: static per-category documentation
  (what it checks, which WCAG criterion), independent of any report, so an
  agent can look up a rule without needing a project on hand.
- **`src/lib/templateDocxReport.ts`** + **`templates/audit-template.docx`**:
  `--docx` fills the bundled Word template in place (edits `word/document.xml`
  directly via `jszip`) rather than generating a document from scratch, so
  the output keeps the template's real cover page, header/footer, and house
  style.

The five original `.tsx` React components (`GuestAudit`, `Results`, etc.)
were not ported: they're browser UI for pbiaudits.com and have no
equivalent in a CLI; the CLI's `check` command replaces their role.

## Development

Working on `pbir-a11y` itself (not just using it)? Day-to-day commands:

```bash
npm run build      # Compile TypeScript to dist/
npm run dev -- <args>  # Run the CLI straight from source via ts-node, e.g.:
                        #   npm run dev -- check test-files/thin-report
npm test           # Run the test suite (node --test)
npm run lint       # ESLint (new/non-ported code only; src/lib/* is exempt)
npm run coverage   # Test run with a line-coverage gate, scoped to src/lib/**
```

`src/lib/*` is the ported rule engine (see the table above for what's
changed vs. untouched within it) — `lint` and the file-size guideline
don't apply to it, and `npm run coverage`'s line-coverage gate is scoped
specifically to it, not excluded from it.

## Roadmap ideas

- `pbir-a11y fix`: auto-correct the deterministic issues (bump undersized
  targets, reorder duplicate tab indices) the way `pbir.tools set -f` does
  for general formatting.
- `pbir-a11y watch`: re-run checks on file save during active development.
- PBIX support in `src/io/` for auditing shipped files, reusing
  `pbixParser.ts` (already ported, untouched).

## License

[PolyForm Shield License 1.0.0](https://github.com/Juls-BI/pbir-a11y/blob/main/LICENSE)

**You can:**
- Use this for personal projects, learning, and experimentation
- Use it in your day job or freelance work, run it in your own or your
  employer's dev/CI workflows, paid work included
- Modify it, fork it, and contribute changes back

**You can't:**
- Build or offer a competing product or service based on this tool: e.g.
  a paid or free accessibility-checking website/SaaS similar to
  [PBIX A11y](https://www.pbiaudits.com)

Want to build something like PBIX A11y using this code? Get in touch about a commercial license.
