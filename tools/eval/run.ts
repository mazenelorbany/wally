// Wally eval harness — does the AI agree with the VM team well enough to trust?
//
// Scores the annotated gold images in wally-poc/data/samples against the REAL
// storefront rubric, applies the same confidence floor + per-photo rollup the
// running app uses (imported directly from apps/api/src/modules/scoring), and —
// if a gold file exists — reports recall-on-fails + precision PER CHECK KIND
// (presence vs aesthetic), mirroring wally-poc/harness/metrics.py + calibrate.py.
//
// Run (from repo root):
//   pnpm eval -- --dry                 # print the harness, no model calls / no key
//   pnpm eval -- --fixture storefront  # real scoring (needs ANTHROPIC_API_KEY)
//   pnpm eval -- --gold tools/eval/gold.jsonl
//
// Pure dry mode never reads the network and never needs a key, so it's safe in CI.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { Criterion, CriterionResult, ScoreResult, VerdictValue } from "@wally/types";
import { applyConfidenceFloor, fixtureRollup } from "../../apps/api/src/modules/scoring/rollup";
import { RubricStore } from "./rubric-loader";
import { Counts, fmtPct, precision, recall, type GoldLabel } from "./metrics";
import { AnthropicVisionProvider, type VisionProvider } from "./vision-provider";

// ───────────────────────────────────────────── config / locations
// The POC is the source of truth for rubrics + sample photos (decision T1).
const POC_ROOT = process.env.WALLY_POC_ROOT ?? "/Users/mazen/work/TCC/wally-poc";
const RUBRICS_DIR = join(POC_ROOT, "rubrics");
const SAMPLES_DIR = join(POC_ROOT, "data", "samples");

interface Args {
  dry: boolean;
  fixture: string;
  campaign: string;
  threshold: number;
  goldPath: string | null;
  sendReference: boolean;
  images: string[]; // explicit image paths, else every msp2img-*.png in samples
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dry: false,
    fixture: "storefront",
    campaign: "MSP2-2026",
    threshold: Number(process.env.WALLY_CONFIDENCE_FLOOR ?? 0.7),
    goldPath: null,
    sendReference: false,
    images: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dry":
        a.dry = true;
        break;
      case "--reference":
        a.sendReference = true;
        break;
      case "--fixture":
        a.fixture = argv[++i] ?? a.fixture;
        break;
      case "--campaign":
        a.campaign = argv[++i] ?? a.campaign;
        break;
      case "--threshold":
        a.threshold = Number(argv[++i]);
        break;
      case "--gold":
        a.goldPath = argv[++i] ?? null;
        break;
      case "--image":
        a.images.push(argv[++i] ?? "");
        break;
      default:
        if (arg && !arg.startsWith("--")) a.images.push(arg);
    }
  }
  a.images = a.images.filter(Boolean);
  return a;
}

// ───────────────────────────────────────────── gold labels (optional)
interface GoldRow {
  image_path: string;
  fixture: string;
  campaign: string;
  labels: Record<string, GoldLabel>;
}

function loadGold(path: string): GoldRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldRow);
}

function resolveImage(p: string): string {
  if (isAbsolute(p) && existsSync(p)) return p;
  for (const cand of [p, join(POC_ROOT, p), join(SAMPLES_DIR, basename(p))]) {
    if (existsSync(cand)) return resolve(cand);
  }
  return resolve(p);
}

function defaultImages(): string[] {
  if (!existsSync(SAMPLES_DIR)) return [];
  return readdirSync(SAMPLES_DIR)
    .filter((n) => /^msp2img-\d+\.png$/.test(n))
    .sort()
    .map((n) => join(SAMPLES_DIR, n));
}

const ICON: Record<VerdictValue, string> = { pass: "PASS", fail: "FAIL", unsure: "????" };

// ───────────────────────────────────────────── pretty printing
function printHarness(criteria: Criterion[], images: string[], a: Args): void {
  console.log(`\nWally eval harness — fixture=${a.fixture} campaign=${a.campaign}`);
  console.log(`rubrics dir : ${RUBRICS_DIR}`);
  console.log(`samples dir : ${SAMPLES_DIR}`);
  console.log(`confidence floor: ${a.threshold}   send reference: ${a.sendReference}`);
  console.log(`\nCRITERIA (${criteria.length}):`);
  for (const kind of ["presence", "aesthetic"] as const) {
    console.log(`  ${kind.toUpperCase()}`);
    for (const c of criteria.filter((x) => x.kind === kind)) {
      console.log(`    ${c.critical ? "CRIT" : "soft"}  ${c.id}`);
    }
  }
  console.log(`\nIMAGES TO SCORE (${images.length}):`);
  for (const img of images) console.log(`  - ${basename(img)}`);
}

function printVerdicts(score: ScoreResult, criteria: Criterion[]): void {
  const byId = new Map(score.results.map((r) => [r.id, r]));
  console.log(
    `  OVERALL: ${score.overall.toUpperCase()}  (needsReview=${score.needsReview}, conf=${fmtPct(
      score.confidence,
    )})`,
  );
  console.log(
    `  stamp: ${score.rubricVersion} | ${score.modelId} | ${score.promptVersion}`,
  );
  for (const c of criteria) {
    const v = byId.get(c.id);
    const verdict = v?.verdict ?? "unsure";
    const conf = v ? fmtPct(v.confidence) : "-";
    const ev = v?.evidence ?? "(no verdict)";
    console.log(`    ${ICON[verdict]} [${conf.padStart(4)}] ${c.id}: ${ev}`);
  }
}

// ───────────────────────────────────────────── main
async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  const store = new RubricStore(RUBRICS_DIR);

  let rubric;
  try {
    rubric = store.get(a.fixture, a.campaign);
  } catch (e) {
    console.error(`Cannot load rubric: ${(e as Error).message}`);
    return 1;
  }

  const goldRows = a.goldPath ? loadGold(a.goldPath) : [];
  const images =
    a.images.length > 0
      ? a.images.map(resolveImage)
      : goldRows.length > 0
        ? goldRows.map((g) => resolveImage(g.image_path))
        : defaultImages();

  if (images.length === 0) {
    console.error(`No images to score (looked in ${SAMPLES_DIR}). Pass --image <path>.`);
    return 1;
  }

  printHarness(rubric.criteria, images, a);

  if (a.dry) {
    console.log("\n[dry] no model called. Re-run without --dry (and ANTHROPIC_API_KEY set) to score.");
    if (goldRows.length === 0 && a.goldPath) {
      console.log(`[dry] no gold rows at ${a.goldPath} — metrics will be skipped.`);
    }
    return 0;
  }

  // Real scoring path — needs a key.
  const provider: VisionProvider = new AnthropicVisionProvider(
    process.env.WALLY_VISION_MODEL ?? "claude-sonnet-4-6",
    process.env.ANTHROPIC_API_KEY ?? "",
  );
  console.log(`\nScoring with ${provider.modelId} ...`);

  const goldByImage = new Map(goldRows.map((g) => [resolveImage(g.image_path), g]));
  const counts: Record<Criterion["kind"], Counts> = {
    presence: new Counts(),
    aesthetic: new Counts(),
  };
  const kindById = new Map(rubric.criteria.map((c) => [c.id, c.kind]));

  for (const img of images) {
    console.log(`\n=== ${basename(img)} ===`);
    let raw: CriterionResult[];
    try {
      raw = await provider.score({
        imagePath: img,
        referencePath: a.sendReference ? referencePath(rubric.referenceKey) : null,
        criteria: rubric.criteria,
      });
    } catch (e) {
      console.error(`  scoring failed: ${(e as Error).message}`);
      continue;
    }
    const floored = applyConfidenceFloor(raw, a.threshold);
    const score = fixtureRollup(floored, rubric.criteria, {
      modelId: provider.modelId,
      promptVersion: provider.promptVersion,
      rubricVersion: rubric.rubricVersion,
      rule: rubric.rollupRule,
    });
    printVerdicts(score, rubric.criteria);

    // Tally against gold, split by check kind (escalations counted separately).
    const gold = goldByImage.get(img);
    if (gold) {
      const wallyById = new Map(floored.map((r) => [r.id, r.verdict]));
      for (const [cid, goldLabel] of Object.entries(gold.labels)) {
        const kind = kindById.get(cid);
        if (!kind) continue;
        // A criterion the model never returned is an escalation, not a pass.
        counts[kind].add(goldLabel, wallyById.get(cid) ?? "unsure");
      }
    }
  }

  printSummary(counts, goldRows.length);
  return 0;
}

function referencePath(referenceKey: string | null | undefined): string | null {
  if (!referenceKey) return null;
  const p = isAbsolute(referenceKey) ? referenceKey : join(POC_ROOT, referenceKey);
  return existsSync(p) ? p : null;
}

function printSummary(counts: Record<Criterion["kind"], Counts>, goldRowCount: number): void {
  console.log("\n──────────────────────────────────────────────");
  console.log("CALIBRATION SUMMARY (positive class = a display FAILURE)");
  if (goldRowCount === 0) {
    console.log("  No gold labels supplied (--gold). Scored photos only; nothing to grade against.");
    console.log("  Add VM-graded labels to get recall/precision (see tools/eval/README.md).");
    return;
  }
  console.log("  kind       recall   precision   escalated   n");
  for (const kind of ["presence", "aesthetic"] as const) {
    const c = counts[kind];
    console.log(
      `  ${kind.padEnd(9)}  ${fmtPct(recall(c)).padStart(5)}    ${fmtPct(precision(c)).padStart(7)}    ${String(
        c.escalated,
      ).padStart(7)}   ${c.total()}`,
    );
  }
  console.log("\n  Human-human baseline: TODO — have two VM reviewers grade the same set first.");
  console.log("  Pre-MVP gate: presence recall must clear the human-human baseline (see ARCHITECTURE.md).");
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
