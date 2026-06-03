import { describe, it, expect } from "vitest";
import type { Criterion, CriterionResult, FixtureOutcome } from "@wally/types";
import { applyConfidenceFloor, fixtureRollup } from "./rollup";
import { ApplicabilityError, storeRollup } from "./store-rollup";

const CRITERIA: Criterion[] = [
  { id: "present", kind: "presence", critical: true, text: "built" },
  { id: "hero", kind: "aesthetic", critical: false, text: "hero at back" },
];
const stamp = { modelId: "m1", promptVersion: "p1", rubricVersion: "doorbuster.MSP2-2026.v1" };
const r = (id: string, verdict: CriterionResult["verdict"], c = 0.95): CriterionResult => ({
  id,
  verdict,
  confidence: c,
  evidence: "",
});

describe("fixtureRollup", () => {
  it("all pass → perfect, stamped", () => {
    const res = fixtureRollup([r("present", "pass"), r("hero", "pass")], CRITERIA, stamp);
    expect(res.overall).toBe("perfect");
    expect(res.needsReview).toBe(false);
    expect(res.rubricVersion).toBe("doorbuster.MSP2-2026.v1");
  });
  it("critical fail → not_good", () => {
    const res = fixtureRollup([r("present", "fail"), r("hero", "pass")], CRITERIA, stamp);
    expect(res.overall).toBe("not_good");
    expect(res.flags.map((f) => f.id)).toEqual(["present"]);
  });
  it("non-critical fail → good", () => {
    const res = fixtureRollup([r("present", "pass"), r("hero", "fail")], CRITERIA, stamp);
    expect(res.overall).toBe("good");
  });
  it("unsure escalates (no silent pass)", () => {
    const res = fixtureRollup([r("present", "unsure", 0.4), r("hero", "pass")], CRITERIA, stamp);
    expect(res.overall).toBe("needs_review");
  });
  it("a criterion the model never graded escalates", () => {
    const res = fixtureRollup([r("present", "pass")], CRITERIA, stamp);
    expect(res.overall).toBe("needs_review");
  });
  it("unknown criterion escalates", () => {
    const res = fixtureRollup([r("ghost", "pass")], CRITERIA, stamp);
    expect(res.overall).toBe("needs_review");
  });
});

describe("applyConfidenceFloor", () => {
  it("low-confidence pass becomes unsure", () => {
    const [out] = applyConfidenceFloor([r("present", "pass", 0.5)], 0.7);
    expect(out!.verdict).toBe("unsure");
  });
  it("confident pass is untouched", () => {
    const [out] = applyConfidenceFloor([r("present", "pass", 0.9)], 0.7);
    expect(out!.verdict).toBe("pass");
  });
});

const fx = (
  fixture: string,
  status: FixtureOutcome["status"],
  overall?: FixtureOutcome["overall"],
): FixtureOutcome => ({ fixture, label: fixture, status, overall });

describe("storeRollup", () => {
  const base = { storeId: "s1", storeName: "Cairns", campaignKey: "MSP2-2026", rubricVersions: [] };
  it("all scored perfect → perfect", () => {
    const s = storeRollup({ ...base, fixtures: [fx("storefront", "scored", "perfect")] });
    expect(s.overall).toBe("perfect");
    expect(s.expected).toBe(1);
  });
  it("a not_good fixture → not_good", () => {
    const s = storeRollup({ ...base, fixtures: [fx("storefront", "scored", "not_good")] });
    expect(s.overall).toBe("not_good");
    expect(s.failed).toEqual(["storefront"]);
  });
  it("good storefront + missing table → needs_review (escalation-first)", () => {
    const s = storeRollup({
      ...base,
      fixtures: [fx("storefront", "scored", "good"), fx("vm_table_1", "not_submitted")],
    });
    expect(s.overall).toBe("needs_review");
    expect(s.missing).toEqual(["vm_table_1"]);
  });
  it("not_applicable excluded from the count", () => {
    const s = storeRollup({
      ...base,
      fixtures: [fx("storefront", "scored", "perfect"), fx("vm_table_2", "not_applicable")],
    });
    expect(s.overall).toBe("perfect");
    expect(s.expected).toBe(1);
    expect(s.notApplicable).toEqual(["vm_table_2"]);
  });
  it("nothing scored, only missing → incomplete", () => {
    const s = storeRollup({ ...base, fixtures: [fx("storefront", "not_submitted")] });
    expect(s.overall).toBe("incomplete");
  });
  it("every fixture not_applicable → throws", () => {
    expect(() => storeRollup({ ...base, fixtures: [fx("vm_table_1", "not_applicable")] })).toThrow(
      ApplicabilityError,
    );
  });
});
