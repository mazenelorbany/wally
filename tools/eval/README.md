# `tools/eval` — Wally calibration harness

> Does the AI agree with the VM team well enough to trust it?

A standalone harness that scores store photos against the **real** rubric and — if VM gold
labels exist — reports how well Wally catches the displays the VM team would flag. It uses
the same scoring rollup the running app uses (imported from
`apps/api/src/modules/scoring/rollup`), so eval numbers are comparable to production.

## Run

From the repo root:

```bash
pnpm eval -- --dry                          # print the harness — no model calls, no key (CI-safe)
pnpm eval -- --fixture storefront           # real scoring (needs ANTHROPIC_API_KEY)
pnpm eval -- --gold tools/eval/gold.jsonl   # score + grade against VM gold labels
pnpm eval -- --reference                     # also send the rubric's reference image
pnpm eval -- --image /path/to/photo.png      # score a specific image (repeatable)
pnpm eval -- --threshold 0.8                  # override the confidence floor
```

Flags: `--dry`, `--fixture <key>` (default `storefront`), `--campaign <key>` (default
`MSP2-2026`), `--threshold <0..1>`, `--gold <path>`, `--reference`, `--image <path>`.

By default it scores every `msp2img-*.png` in the POC samples dir. Point at a different POC
checkout with `WALLY_POC_ROOT=/path/to/wally-poc`.

## What it measures

The positive class is a **display failure** (catching problems is the whole job):

```
recall    = of the displays the VM team marked WRONG, how many Wally caught
precision = of the displays Wally FLAGGED,            how many were actually wrong
escalated = Wally answered "unsure" → handed to a human (counted separately)
```

Presence checks (objective) and aesthetic checks (subjective) are reported **separately** —
they have different trust bars. See `../../ARCHITECTURE.md` §6 for the pre-MVP gate
(presence recall must clear a human–human baseline before Wally auto-decides).

## Gold labels

One JSON object per line:

```json
{"image_path": "data/samples/msp2img-05.png", "fixture": "storefront", "campaign": "MSP2-2026",
 "labels": {"storewide_callouts_front": "fail", "store_shoppable": "pass"}}
```

`labels` maps a rubric criterion id → the VM team's ground-truth `pass`/`fail`. You don't
have to label every criterion — only the ones a human graded. See
[`gold.example.jsonl`](./gold.example.jsonl).

> Real gold files are VM-graded photos that **may contain people** — keep them out of the
> repo (gitignored). The example file uses only criterion ids + labels, no image bytes.

## Files

| File                  | Role                                                                 |
| --------------------- | ------------------------------------------------------------------- |
| `run.ts`              | the harness entry point (arg parsing, scoring loop, summary table)  |
| `vision-provider.ts`  | standalone Anthropic vision client (same forced-tool contract as the API) |
| `rubric-loader.ts`    | reads the versioned rubric YAML into the `@wally/types` shape        |
| `metrics.ts`          | recall / precision counts (port of `wally-poc/harness/metrics.py`)  |
| `gold.example.jsonl`  | the gold-label format, by example                                   |
