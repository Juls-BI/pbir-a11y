import type { Command } from "commander";

// Short, stable descriptions of each check category — independent of any
// specific report, so an agent (or a person) can call `explain <rule>`
// before touching a file to understand what a category checks and why,
// without needing to run an analysis first.
const RULE_DOCS: Record<string, { summary: string; wcag?: string }> = {
  contrast: {
    summary:
      "Text and non-text contrast against its background. Text needs 4.5:1, graphical objects (bars, lines, points) need 3:1.",
    wcag: "WCAG 1.4.3, 1.4.11",
  },
  colourblind: {
    summary:
      "Flags when series/categories are only distinguishable by hue, which fails for the ~8% of men with colour vision deficiency.",
    wcag: "WCAG 1.4.1",
  },
  altText: {
    summary:
      "Every visual needs meaningful alt text describing what it shows and the key insight, not a placeholder or empty string.",
    wcag: "WCAG 1.1.1",
  },
  clutter: {
    summary:
      "Estimates visual density per page. Very dense pages overwhelm working memory and make screen-reader navigation harder.",
  },
  pageTitles: {
    summary: "Every page needs a visible title so sighted users and screen readers can orient themselves.",
    wcag: "WCAG 2.4.2",
  },
  visualTitles: {
    summary: "Every visual needs a visible, non-empty title — not just an alt text description.",
    wcag: "WCAG 1.3.1",
  },
  axisTitles: {
    summary: "Chart axes need visible titles stating what they represent and the unit of measure.",
    wcag: "WCAG 1.3.1",
  },
  fontScaling: {
    summary: "Minimum font size across titles, labels and axes so text stays legible when projected or scaled.",
  },
  tabOrder: {
    summary:
      "Keyboard tab order must be intentional: no duplicate positions within the same group/page level, decorative elements shouldn't receive focus, and the authored order should broadly follow the visual layout (advisory only, since only the author knows the intended reading order).",
    wcag: "WCAG 2.4.3",
  },
  targetSize: {
    summary: "Interactive elements (slicers, buttons) need a minimum click/tap target size.",
    wcag: "WCAG 2.5.5, 2.5.8",
  },
  customVisuals: {
    summary:
      "Advisory only: flags third-party custom visuals, since their internal accessibility can't be verified by static parsing.",
  },
};

export function registerExplainCommand(program: Command): void {
  program
    .command("explain [rule]")
    .description("Show what an accessibility check category looks for, and the WCAG criterion behind it")
    .action((rule?: string) => {
      if (!rule) {
        console.log("\nAvailable rule categories:\n");
        for (const key of Object.keys(RULE_DOCS)) console.log(`  ${key}`);
        console.log("\nRun `pbir-a11y explain <rule>` for details on one.\n");
        return;
      }

      const doc = RULE_DOCS[rule];
      if (!doc) {
        console.error(`Unknown rule "${rule}". Run "pbir-a11y explain" to list available rules.`);
        process.exitCode = 2;
        return;
      }

      console.log(`\n${rule}`);
      console.log(`  ${doc.summary}`);
      if (doc.wcag) console.log(`  Reference: ${doc.wcag}`);
      console.log("");
    });
}
