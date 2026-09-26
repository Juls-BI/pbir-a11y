---
name: pbir-a11y
description: Use when creating, editing, or reviewing a Power BI PBIP/PBIR report definition (report.json, page.json, visual.json), or when asked about Power BI accessibility, WCAG, alt text, contrast, tab order, or target size. Do not use for general PBIR editing; use pbir.tools for that.
---

# Power BI PBIR accessibility checks

Run this after adding or modifying a visual, page, or theme, and whenever the user mentions "pbir-a11y", "accessibility check", or "a11y" in a Power BI context — accessibility issues introduced during editing (missing alt text on a new visual, a title toggled off, a duplicate tab order) are cheapest to catch immediately, so run the check after edits rather than only when explicitly asked.

`pbir-a11y` is a CLI that runs the same rule engine as the [PBIX A11y](https://pbiaudits.com) browser tool against a PBIP project folder on disk...
## When to run it

- After adding a new visual, page, or changing a report theme
- After toggling a title, alt text field, or tab order value
- Before telling the user a report is "done" or "ready to publish"
- Whenever the user asks a Power BI accessibility question - run a check first rather than answering from general WCAG knowledge, since the actual issues in *their* report are more useful than generic advice

## Workflow

1. Locate the PBIP project root (contains a `.pbip` file) or the `*.Report` folder directly. If unsure, look for a `*.Report` folder in the current working directory or ask the user for the path.
2. Run the check with JSON output so you can parse it:

   ```
   pbir-a11y check <path> --json
   ```

3. Parse `summary.overallScore`, `summary.issueCount`, and each page's `issues` (page-level: titles, tab order, clutter) and `visuals[].issues` (visual-level: alt text, contrast, visual/axis titles, font size, target size).
4. For each issue, the JSON already includes `why` (rationale) and `fix` (what to change) - use these directly rather than re-deriving accessibility guidance yourself.
5. If you can make the fix (e.g. you're already editing that visual's JSON), apply it and re-run the check to confirm it's resolved. If you can't determine the right fix (e.g. what alt text to write), surface the issue and its `fix` text to the user instead of guessing content.
6. Report results concisely: score, count by severity, and the specific issues - not a restatement of every WCAG criterion involved.

## Writing alt text when fixing an `altText` issue

The check only tells you alt text is missing or empty- it does not (yet) score the *quality* of alt text that's already present. When you do write alt text to fix a flagged issue, follow these rules rather than writing a generic description:

- **Lead with the insight, not the chart type.** "Revenue rose 12% QoQ" is correct; "Bar chart showing revenue" is not - SC 1.1.1 requires the text content to substitute for the visual's *meaning*, not just its type.
- Include actual numbers and comparisons where the visual has them (current value vs. target/prior period), not just a description of axes.
- Keep it under ~150 characters for cards/simple visuals, ~300 for complex multi-measure visuals.
- If the visual's story changes with filters/slicers, prefer a DAX measure driving the alt text over a static string, so it stays accurate as the user interacts with the report. Ask the user before doing this if it's not obvious which measure should drive it - same rule as never guessing alt text content.

**Visual groups are the exception to all of the above.** A flagged `altText` issue on a "Visual group" visual isn't a chart - it's a layout container - so none of the templates below apply, and Power BI only offers it a *static* alt-text field (Format pane → Properties): there's no measure-binding option for it, so never suggest one. Instead, describe what the group represents and roughly how many items it holds, e.g. "KPI summary group with three cards showing regional sales totals." Don't state an exact count - it goes stale the moment a visual is added to or removed from the group. Elements *inside* a group still get the full guidance above for their own alt text; only the group container itself follows this exception.

These four templates cover most cases (chart-type visuals only - see the visual-group exception above):

| Pattern | Shape |
|---|---|
| Headline + Trend | `[Measure] [direction] [amount] over [period]. Currently at [value], compared to [reference].` |
| Structure + Finding | `[Chart type] showing [measure] by [dimension]. [Key finding]: [specific data point].` |
| Comparison | `Comparing [measure] across [N] [items]. [Leader]: [value]. [Runner-up]: [value].` |
| Data-as-table fallback | `Data table: [headers]. Row 1: [values]. Row 2: [values]...` — use only when the above don't fit, or for dense multi-measure visuals |

## Choosing colors that work for Color Vision Deficiency (CVD)

`contrast` checks luminance-based ratios (SC 1.4.3/1.4.11), which is a different thing from whether a palette stays distinguishable to someone with color blindness (SC 1.4.1, Use of Color). A palette can pass contrast math perfectly and still be indistinguishable under CVD, so treat this as a separate, active step when choosing or reviewing report colors - not just a contrast check with extra steps.

- **Prevalence:** ~8% of men, ~0.5% of women have some form of CVD. Most common: deuteranopia and protanopia (both red-green), then tritanopia (blue-yellow).
- **Prefer CVD-safe palettes by default:** Okabe-Ito (8 colors), viridis, and cividis all pass every CVD type. Reach for one of these over an arbitrary custom palette whenever the report leans on color to distinguish categories or series.
- **Simulate before calling it done:** Chrome DevTools → Rendering → Emulate vision deficiencies, or the Coblis web tool. If any two colors in the palette become indistinguishable under simulation, that's a fail regardless of what the contrast numbers say.
- **The rule that matters most, regardless of palette:** never let color be the only signal. Pair it with a second channel — label, shape, or pattern — so the report still works even if two colors are indistinguishable to some viewer.

There is no `--category` for this yet, so it's not something `check` will flag on its own - apply it proactively when picking or reviewing colors, the same way you'd apply the alt-text guidance above when writing alt text.

## Useful flags

- `--category <name>` - scope to one check (`contrast`, `altText`, `clutter`, `pageTitles`, `visualTitles`, `axisTitles`, `fontScaling`, `tabOrder`, `targetSize`, `customVisuals`) when you only touched one aspect of the report
- `--page <name>` - scope to the page you just edited, to avoid re-reporting pre-existing issues elsewhere in the project as if they were new
- `--fail-on warn` - treat warnings as blocking too (default only fails on `fail`-severity issues), useful before a publish step
- `--include-hidden` - also check pages marked hidden-in-view-mode (e.g. drillthrough/tooltip pages). These are skipped by default since end users don't land on them directly, but if the report reaches them via drillthrough or bookmarks, their visuals still need auditing - use this flag when the user asks for a full/complete audit, not just the pages in normal navigation
- `--docx <path>` - in addition to the normal output, write a formatted Word document of the findings to `<path>`. Use this when the user asks to "export", "share", or "present" the findings, e.g. to a client or stakeholder who won't be reading raw CLI/JSON output
- Exit code: `0` clean, `1` issues found at or above `--fail-on` threshold, `2` couldn't read the project (bad path, unsupported format)

## Manual checks worth pairing with this tool

Some WCAG concerns can't be reliably determined from static PBIR JSON alone — they depend on runtime behavior. Recommend these to the user (or perform them directly if you have report-viewing access) alongside, not instead of, the automated check:

- **Full keyboard-only pass:** unplug the mouse and Tab through the entire report. Every visual, slicer, and button must be reachable and operable using only the keys below. `tabOrder` catches structural ordering issues in the JSON; it does not confirm every control actually responds to keyboard input at runtime — this table is what to test manually against.

  | Key | Action in PBI Report |
  |---|---|
  | `Tab` | Move to next visual in tab order |
  | `Shift+Tab` | Move to previous visual in tab order |
  | `Enter` / `Space` | Activate / select focused element |
  | `Escape` | Exit current visual / deselect |
  | `Ctrl+Right/Left` | Move between data points within a visual |
  | `Alt+Shift+F10` | Open visual header menu |
  | `Alt+Shift+F11` | Open filter pane |
  | `Ctrl+F6` | Move focus between report sections |
  | `Shift+?` | Show keyboard shortcuts dialog |
  | Arrow keys | Navigate within slicers, matrices, tables |

  **Test protocol:** navigate the entire report using only the keys above. Every visual, slicer, and button must be reachable and operable.

- **200% zoom:** confirm no clipping, overlap, or text truncation. This is the literal reading of SC 1.4.4 (Resize Text) — `fontScaling` checks starting size against the canvas, which is a related but distinct concern from zoom-survivability.
- **High-contrast mode (Windows Settings → High Contrast):** confirm all visuals remain legible and nothing becomes invisible. PBI respects OS-level high contrast; custom theme overrides can break this even when the base `contrast` check passes.
- **Screen reader pass (NVDA or Narrator):** confirm every visual is announced with its alt text and that reading order is logical — this validates the *combination* of `tabOrder` and `altText` results in a way neither check confirms alone.

## Looking up a rule without running a check

```
pbir-a11y explain <category>   # e.g. pbir-a11y explain tabOrder
pbir-a11y explain              # lists all categories
```

Use this when the user asks "why does X matter" or you need the WCAG reference for something, without needing a project on hand.

## What this skill does not do

- Does not edit PBIR/PBIX files — it only reports
- Does not audit PBIX (compiled binary) files yet — PBIP/PBIR projects only
- Does not check custom visual internals — `customVisuals` is advisory-only, flagging that a custom visual is present, not scoring its accessibility

## Known gaps (not yet checked)

These are real gaps, not covered by any current `--category` - flag them as such if a user asks whether the tool covers them, rather than implying the check is comprehensive.

**Alt text content quality.** `altText` currently checks presence/absence only. A visual with alt text reading just "chart" or "image" passes the automated check but fails the actual intent of SC 1.1.1. See the alt-text-writing guidance above when you're the one fixing a flagged issue, and treat a human-reported "the alt text is bad, not missing" complaint as valid even though the CLI won't flag it today.

## Avoiding truncated results

`check` prints every issue with no pagination on its side, but if you (or the user) are reading it from a terminal rather than parsing `--json`, a short or narrow terminal window can scroll earlier findings out of view before they're seen - this can look like the tool "missed" issues on visuals covered earlier in the run when it didn't. Prefer `--json` (or `--docx`) as the source of truth over eyeballing scrolled terminal output, and if a human reports issues that "should have" been flagged but weren't visible in what they pasted, re-run with `--json` yourself and check the full result before concluding there's a real bug in the rule engine.
