---
name: extraction
description: Capture source-grounded study characteristics, quantitative results, or qualitative findings with locators and explicit derivations in researcher-chosen artifacts.
license: AGPL-3.0-or-later
disable-model-invocation: true
---

# Extract evidence for the intended use

Use for selected sources, a focused question, or checking existing extractions.
Apply the [shared safeguards](../../SKILL.md). Start with the researcher's current
notes or data; there is no universal set of extraction columns.

## Agree what the evidence must support

Identify the planned comparison, descriptive question, or qualitative synthesis
and the appropriate unit: study, report, group, outcome, time point, or finding.
Choose only the information needed to answer it and appraise its limitations.
Clarify definitions and selection rules with a small sample if useful. Do not
select the most favorable result among multiple measures or time points.

Use [evidence reading](../evidence-reading/SKILL.md) for full-text and table
verification. Abstracts alone may not support complete extraction; label their
scope and retain unavailable or unreadable material as a gap.

## Preserve meaning and provenance

- Keep the source/version and precise page, table, figure, section, or other
  locator with consequential observations. Link companion reports to the same
  study without overwriting conflicting values. Explain which source is used
  and why; do not pick a value silently.
- Separate the source's reported value or statement from any standardized value,
  calculation, coding, or interpretation. Preserve raw units, scale direction,
  denominators, and transformations. Never fill an empty cell with a guess.
- Distinguish not reported, unclear, unavailable, not applicable, and zero in a
  form the researcher understands. Track queries needing resolution rather than
  collapsing all missingness into a single meaning.
- Check outcome definition, assessment method, group labels, follow-up, analysis
  population, and whether estimates are adjusted or unadjusted. Keep relevant
  adjustment variables and reference categories. Do not conflate study sample
  size with an outcome-specific denominator or number analyzed.
- For quantitative results, distinguish events from people, SD from SE, and
  confidence intervals from ranges/IQRs. Keep effect measure, uncertainty, and
  units together. Note clustering, pairing, repeated observations, multi-arm
  dependencies, and attrition where relevant to later analysis.
- For qualitative evidence, retain participant/context information, the authors'
  analytical findings, and supporting participant quotations as distinct layers.
  Record translations or interpretive coding transparently. Do not turn a
  theme's mention frequency into a prevalence estimate.

## Check before handing off

Verify numerical values, table alignment, footnotes, and decisive quotations
against the source. Apply range, arithmetic, unit, and cross-report consistency
checks as appropriate, but do not silently fix unusual data. Derived quantities
need inputs, formula/assumptions, and a rerunnable calculation. Figure digitization
or imputation requires an explicit method and uncertainty, not false precision.

A second extraction/check can help when requested; preserve disagreements and
reconciliation. Do not imply independent human verification when an agent did it.
Deliver the requested artifact with gaps and checks, and load
[analysis](../analysis/SKILL.md) only when synthesis or computation is needed.
