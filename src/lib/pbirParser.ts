// PBIR parser  -  runs entirely in the browser. Accepts a .zip containing a
// PBIR project folder (either the legacy single Layout file, or the modern
// split-file format with definition/pages/<name>/visuals/<id>/visual.json).
// Output is normalised into the same ParsedReport shape produced by the PBIX
// parser so every audit downstream works without changes.

import JSZip from "jszip";
import { buildReportFromLayout, PBIXParseError, type ParsedReport } from "./pbixParser";

export class PBIRParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PBIRParseError";
  }
}

export interface PBIRParseResult {
  report: ParsedReport;
  /** Non-blocking warnings  -  surfaced in the UI but don't stop the audit. */
  warnings: string[];
}

function decodeText(buf: Uint8Array): string {
  // PBIR files are UTF-8 (BOM optional). Some legacy layouts are UTF-16LE.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.subarray(3));
  }
  return new TextDecoder("utf-8").decode(buf);
}

async function readJson(zip: JSZip, name: string): Promise<any | null> {
  const entry = zip.file(name);
  if (!entry) return null;
  const buf = await entry.async("uint8array");
  try {
    return JSON.parse(decodeText(buf));
  } catch {
    return null;
  }
}

/** Find a single file by path-suffix (case-insensitive). */
function findOne(zip: JSZip, suffix: string): JSZip.JSZipObject | null {
  const target = suffix.toLowerCase();
  return (
    Object.values(zip.files).find(
      (f) => !f.dir && f.name.toLowerCase().endsWith(target),
    ) ?? null
  );
}

/** Returns all files matching a regex. */
function findAll(zip: JSZip, re: RegExp): JSZip.JSZipObject[] {
  return Object.values(zip.files).filter((f) => !f.dir && re.test(f.name));
}

/** Build a synthetic "Layout" object compatible with the PBIX parser from a
 *  modern PBIR split-file project (definition/pages/<page>/visuals/<id>/visual.json). */
async function synthesiseLayoutFromSplitFiles(
  zip: JSZip,
  warnings: string[],
): Promise<any | null> {
  // Locate definition/pages/pages.json or any page.json under pages/
  const pageFiles = findAll(zip, /(^|\/)pages\/[^/]+\/page\.json$/i);
  if (pageFiles.length === 0) return null;

  // Optional report.json for theme.
  const reportFile = findOne(zip, "/definition/report.json") || findOne(zip, "/report.json");
  let themeCollection: any = undefined;
  if (reportFile) {
    try {
      const r = JSON.parse(decodeText(await reportFile.async("uint8array")));
      themeCollection = r?.themeCollection ?? r?.theme ?? undefined;
    } catch {
      /* ignore */
    }
  }

  const sections: any[] = [];
  for (const pf of pageFiles) {
    let pageJson: any;
    try {
      pageJson = JSON.parse(decodeText(await pf.async("uint8array")));
    } catch {
      warnings.push(`Could not read page metadata for "${pf.name}".`);
      continue;
    }
    const pageDir = pf.name.replace(/page\.json$/i, "");
    // Visuals live under <pageDir>visuals/<id>/visual.json
    const visualFiles = Object.values(zip.files).filter(
      (f) =>
        !f.dir &&
        f.name.toLowerCase().startsWith(pageDir.toLowerCase()) &&
        /visuals\/[^/]+\/visual\.json$/i.test(f.name),
    );
    const visualContainers: any[] = [];
    for (const vf of visualFiles) {
      let v: any;
      try {
        v = JSON.parse(decodeText(await vf.async("uint8array")));
      } catch {
        warnings.push(`Skipped unreadable visual "${vf.name}".`);
        continue;
      }
      const pos = v.position ?? {};
      // A visual-group container (a layout grouping of other visuals) has a
      // `visualGroup` key instead of `visual`. It isn't a renderable chart -
      // it still gets its own alt-text field in Desktop (Format pane →
      // Properties), stored the same way any other visual container's is
      // (`visualContainerObjects.general[0].properties.altText`, at the top
      // level here since there's no nested `visual` object to hold it) - but
      // it must be tagged with its own type rather than falling through to
      // `v` and resolving to "unknown", which the rule engine can't
      // distinguish from a genuine unrecognised visual.
      const isGroup = !!v.visualGroup && !v.visual;
      const visual = v.visual ?? v;
      // Modern PBIR stores tab order at a few possible locations. Forward all
      // of them so the PBIX rule engine can recognise authored / hidden state.
      const tabOrder =
        v.tabOrder ??
        visual.tabOrder ??
        v.visualContainerObjects?.general?.[0]?.properties?.tabOrder ??
        visual.visualContainerObjects?.general?.[0]?.properties?.tabOrder ??
        visual.objects?.general?.[0]?.properties?.tabOrder ??
        null;
      const single = {
        name: v.name ?? visual.name,
        visualType: isGroup ? "visualGroup" : (visual.visualType ?? visual.type ?? "unknown"),
        objects: visual.objects ?? {},
        vcObjects: visual.vcObjects ?? visual.visualContainerObjects ?? {},
        projections: visual.projections ?? visual.query?.queryState ?? {},
        prototypeQuery: visual.query?.queryState
          ? undefined
          : visual.prototypeQuery,
        tabOrder,
      };
      visualContainers.push({
        id: v.name ?? vf.name,
        x: Number(pos.x ?? 0),
        y: Number(pos.y ?? 0),
        z: Number(pos.z ?? 0),
        width: Number(pos.width ?? 0),
        height: Number(pos.height ?? 0),
        tabOrder,
        rawVisual: v,
        // The PBIX parser expects `config` to be a JSON string OR object  - 
        // expand() handles both. Pass an object directly for safety.
        config: { name: single.name, singleVisual: single, rawVisual: v },
      });
    }

    sections.push({
      name: pageJson.name ?? pageDir,
      displayName: pageJson.displayName ?? pageJson.name ?? "Page",
      width: Number(pageJson.width ?? pageJson.height ?? 0) || undefined,
      height: Number(pageJson.height ?? 0) || undefined,
      visibility: pageJson.visibility === "HiddenInViewMode" || pageJson.hidden ? 1 : 0,
      visualContainers,
    });
  }

  if (sections.length === 0) return null;

  return {
    config: themeCollection ? { themeCollection } : {},
    sections,
  };
}

/**
 * Browser entry point  -  unchanged from the original tool. Accepts a .zip
 * File from a file-drop/input element, then delegates to parsePbirFromZip.
 */
export async function parsePbir(file: File): Promise<PBIRParseResult> {
  if (!file) throw new PBIRParseError("No file provided");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new PBIRParseError("PBIP / PBIR uploads must be a .zip of the project folder.");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new PBIRParseError("Could not open the ZIP file. It may be corrupted or password-protected.");
  }

  return parsePbirFromZip(zip, file.name, file.size);
}

/**
 * CLI / Node entry point  -  same logic as parsePbir, but takes an
 * already-populated JSZip instance instead of a browser File. This is what
 * lets the CLI read a PBIP project folder straight off disk: the folder
 * loader (see src/io/loadFromFolder.ts) builds a JSZip in memory that
 * mirrors the directory tree, then hands it here unchanged.
 */
export async function parsePbirFromZip(
  zip: JSZip,
  sourceName: string,
  sourceSize: number,
  opts?: { includeHidden?: boolean },
): Promise<PBIRParseResult> {
  const warnings: string[] = [];

  // Validate that this looks like a PBIP or PBIR project: must contain at
  // least one of report.json / pages/*/page.json / a Layout file.
  const hasReportJson = !!findOne(zip, "report.json");
  const hasPagesDir = findAll(zip, /(^|\/)pages\/[^/]+\/page\.json$/i).length > 0;
  const legacyLayout =
    findOne(zip, "/report/layout") ||
    findOne(zip, "/report/layout.json") ||
    findOne(zip, "/layout") ||
    findOne(zip, "/layout.json");
  const isPbip = Object.values(zip.files).some((f) =>
    /\.report\/(definition|layout)/i.test(f.name) || /\/report\/(layout|definition)/i.test(f.name),
  );

  if (!hasReportJson && !hasPagesDir && !legacyLayout) {
    throw new PBIRParseError(
      "This ZIP does not contain a valid PBIP or PBIR project. Please export the folder from Power BI and compress it before uploading.",
    );
  }

  // Prefer split-file format (modern PBIR / PBIP).
  let layout: any | null = null;
  if (hasPagesDir) {
    layout = await synthesiseLayoutFromSplitFiles(zip, warnings);
  }
  // Fall back to a legacy Layout file (same format as PBIX Report/Layout).
  if (!layout && legacyLayout) {
    try {
      const buf = await legacyLayout.async("uint8array");
      layout = JSON.parse(decodeText(buf));
    } catch {
      throw new PBIRParseError("The PBIP/PBIR layout could not be read. This report may use features not yet supported.");
    }
  }

  if (!layout) {
    throw new PBIRParseError("The PBIP/PBIR layout could not be read. This report may use features not yet supported.");
  }

  let report: ParsedReport;
  try {
    report = buildReportFromLayout(layout, sourceName, sourceSize, opts);
  } catch (e) {
    if (e instanceof PBIXParseError) throw new PBIRParseError(e.message);
    throw new PBIRParseError("The PBIP/PBIR layout could not be parsed.");
  }

  if (report.pages.length === 0) {
    warnings.push("No visible pages were found in this project.");
  }

  if (isPbip) {
    warnings.push("Some PBIP metadata is not yet supported. Results may be partially incomplete.");
  }

  return { report, warnings };
}
