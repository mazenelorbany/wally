# Rubrics

One checklist file per fixture per campaign. Format + rules: `docs/RUBRIC_SCHEMA.md`.

- Naming: `<fixture>.<campaign>.v<N>.yaml`
- Bump `version` on any change; verdicts are stamped with it (decision T1).
- `refs/` holds the reference ("what good looks like") images. A clean VM
  reference shot with no people in it is fine to commit; if a reference contains
  staff/customers, keep it in `data/` instead (gitignored).

`doorbuster.MSP2-2026.v1.yaml` is a worked example: 4 simple presence checks +
4 decomposed aesthetic sub-rules. It is illustrative — the real criteria come
out of the workshop with the VM team.
