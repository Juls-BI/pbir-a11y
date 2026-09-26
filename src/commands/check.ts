import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { Command } from "commander";
import { loadPbirFromFolder } from "../io/loadFromFolder";
import {
  analyze,
  describeVisual,
  ALL_CHECKS,
  type Category,
  type CheckSelection,
  type Severity,
} from "../lib/rulesEngine";
import { PBIRParseError } from "../lib/pbirParser";
import { buildAccessibilityDocx } from "../lib/docxReport";

interface CheckOptions {
  json?: boolean;
  category?: string;
  failOn?: string;
  page?: string;
  includeHidden?: boolean;
  docx?: string;
}

const SEVERITY_RANK: Record<Severity, number> = { pass: 0, info: 1, warn: 2, fail: 3 };

function severityIcon(s: Severity): string {
  switch (s) {
    case "fail":
      return "✗";
    case "warn":
      return "!";
    case "pass":
      return "✓";
    default:
      return "·";
  }
}

export function registerCheckCommand(program: Command): void {
  program
    .command("check <path>")
    .description(
      "Run accessibility checks against a PBIP project folder (or a *.Report folder inside one).",
    )
    .option("--json", "Output machine-readable JSON instead of a human summary")
    .option(
      "--category <name>",
      "Only run one check category (contrast, altText, clutter, pageTitles, visualTitles, axisTitles, fontScaling, tabOrder, targetSize, customVisuals)",
    )
    .option(
      "--fail-on <severity>",
      "Exit with a non-zero code if any issue at or above this severity is found (warn|fail). Default: fail.",
      "fail",
    )
    .option("--page <name>", "Only show results for one page (by display name or id)")
    .option(
      "--include-hidden",
      "Also check pages marked hidden-in-view-mode (e.g. drillthrough/tooltip pages), which are skipped by default",
    )
    .option(
      "--docx <path>",
      "Also write a formatted Word document of the findings to this path, suitable for sharing with a client or stakeholder",
    )
    .action(async (path: string, opts: CheckOptions) => {
      try {
        const { report, warnings } = await loadPbirFromFolder(path, { includeHidden: opts.includeHidden });

        const selection = { ...ALL_CHECKS };
        if (opts.category) {
          const cat = opts.category as Category;
          if (!(cat in selection)) {
            console.error(`Unknown category "${opts.category}".`);
            process.exitCode = 2;
            return;
          }
          for (const key of Object.keys(selection) as (keyof CheckSelection)[]) {
            selection[key] = key === cat;
          }
        }

        const result = analyze(report, selection);

        let pages = result.pages;
        if (opts.page) {
          const needle = opts.page.toLowerCase();
          pages = pages.filter(
            (p) => p.page.displayName.toLowerCase() === needle || p.page.id.toLowerCase() === needle,
          );
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify({ ...result, pages }, null, 2) + "\n");
        } else {
          printHuman(result, pages, warnings);
        }

        if (opts.docx) {
          const outPath = nodePath.resolve(opts.docx);
          const buffer = await buildAccessibilityDocx(result, pages);
          fs.mkdirSync(nodePath.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, buffer);
          console.log(`Word report written to ${outPath}`);
        }

        const failOn = (opts.failOn ?? "fail") as Severity;
        const threshold = SEVERITY_RANK[failOn] ?? SEVERITY_RANK.fail;
        const hasBlockingIssue = pages.some(
          (p) =>
            p.issues.some((i) => SEVERITY_RANK[i.severity] >= threshold) ||
            p.visuals.some((v) => v.issues.some((i) => SEVERITY_RANK[i.severity] >= threshold)),
        );
        process.exitCode = hasBlockingIssue ? 1 : 0;
      } catch (err) {
        if (err instanceof PBIRParseError) {
          console.error(`✗ ${err.message}`);
        } else {
          console.error("✗ Unexpected error:", (err as Error).message);
        }
        process.exitCode = 2;
      }
    });
}

function printHuman(
  result: ReturnType<typeof analyze>,
  pages: ReturnType<typeof analyze>["pages"],
  loadWarnings: string[],
): void {
  console.log(`\n${result.fileName}  —  score ${result.summary.overallScore}/100`);
  console.log(
    `${result.summary.pageCount} page(s), ${result.summary.visualCount} visual(s), ${result.summary.issueCount} issue(s)\n`,
  );

  for (const w of loadWarnings) console.log(`  note: ${w}`);
  if (loadWarnings.length) console.log("");

  for (const page of pages) {
    const visualIssues = page.visuals.flatMap((v) =>
      v.issues.map((issue) => ({ issue, visualName: describeVisual(v.visual) })),
    );
    const pageLevel = page.issues.map((issue) => ({ issue, visualName: null as string | null }));
    const all = [...pageLevel, ...visualIssues];
    if (all.length === 0) continue;

    const hiddenNote = page.page.hidden ? "  (hidden / drillthrough page)" : "";
    console.log(`${page.page.displayName}${hiddenNote}`);
    for (const { issue, visualName } of all) {
      const location = visualName ? ` (${visualName})` : "";
      console.log(`  ${severityIcon(issue.severity)} [${issue.category}]${location} ${issue.title}`);
      console.log(`      ${issue.detail}`);
      console.log(`      fix: ${issue.fix}`);
    }
    console.log("");
  }

  if (result.summary.issueCount === 0) {
    console.log("No issues found for the selected checks.\n");
  }
}
