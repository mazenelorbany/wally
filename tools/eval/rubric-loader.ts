// Reads the REAL versioned rubric YAML files (the ones the seed also loads) and
// maps them into the shared @wally/types Rubric shape. One source of truth for
// "what good looks like": wally-poc/rubrics/<fixture>.<campaign>.v<N>.yaml.
//
// Mirrors the POC's wally/rubric.py: highest version on disk wins, filename
// version must match the in-file version, malformed files fail loudly.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { Criterion, Rubric, RollupRule } from "@wally/types";

interface RawCriterion {
  id: string;
  kind: string;
  critical?: boolean;
  text: string;
}

interface RawRubric {
  fixture: string;
  campaign: string;
  version: number;
  reference_image?: string;
  rollup?: Partial<RollupRule>;
  criteria: RawCriterion[];
}

const DEFAULT_ROLLUP: RollupRule = {
  not_good_if_any_critical_fails: true,
  good_if_only_noncritical_fails: true,
};

function assertKind(kind: string, fixture: string, id: string): Criterion["kind"] {
  if (kind !== "presence" && kind !== "aesthetic") {
    throw new Error(
      `rubric ${fixture}: criterion "${id}" has invalid kind "${kind}" (expected presence|aesthetic)`,
    );
  }
  return kind;
}

/** Map one parsed YAML rubric onto the shared @wally/types Rubric. */
export function toRubric(raw: RawRubric): Rubric {
  if (!raw?.fixture || !raw?.campaign || typeof raw?.version !== "number") {
    throw new Error("rubric is missing fixture/campaign/version");
  }
  const criteria: Criterion[] = (raw.criteria ?? []).map((c) => ({
    id: c.id,
    kind: assertKind(c.kind, raw.fixture, c.id),
    critical: Boolean(c.critical),
    text: c.text.replace(/\s+/g, " ").trim(),
  }));
  if (criteria.length === 0) {
    throw new Error(`rubric ${raw.fixture}.${raw.campaign}.v${raw.version} has no criteria`);
  }
  return {
    id: `${raw.fixture}.${raw.campaign}.v${raw.version}`,
    fixtureKey: raw.fixture,
    campaignKey: raw.campaign,
    version: raw.version,
    criteria,
    rollupRule: { ...DEFAULT_ROLLUP, ...(raw.rollup ?? {}) },
    referenceKey: raw.reference_image ?? null,
    rubricVersion: `${raw.fixture}.${raw.campaign}.v${raw.version}`,
  };
}

/** Loads rubrics from a directory of `<fixture>.<campaign>.v<N>.yaml` files. */
export class RubricStore {
  constructor(private readonly root: string) {}

  /** Highest version for a fixture+campaign, or a pinned version. */
  get(fixture: string, campaign: string, version?: number): Rubric {
    const v = version ?? this.latestVersion(fixture, campaign);
    const path = join(this.root, `${fixture}.${campaign}.v${v}.yaml`);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      throw new Error(`no rubric file: ${path}`);
    }
    const raw = YAML.parse(text) as RawRubric;
    if (raw.version !== v) {
      throw new Error(`${path}: filename v${v} != file version v${raw.version}`);
    }
    return toRubric(raw);
  }

  private latestVersion(fixture: string, campaign: string): number {
    const prefix = `${fixture}.${campaign}.v`;
    const versions = readdirSync(this.root)
      .filter((n) => n.startsWith(prefix) && n.endsWith(".yaml"))
      .map((n) => Number.parseInt(n.slice(prefix.length, -".yaml".length), 10))
      .filter((n) => Number.isInteger(n));
    if (versions.length === 0) {
      throw new Error(`no rubric for ${fixture}/${campaign} in ${this.root}`);
    }
    return Math.max(...versions);
  }
}
