---
name: analysis
description: Perform reproducible quantitative, narrative, qualitative, or mixed-evidence synthesis with explicit assumptions, dependency handling, and robustness checks.
license: AGPL-3.0-or-later
disable-model-invocation: true
---

# Analyze and synthesize evidence

Use for one calculation, a synthesis, or checking an existing analysis. Apply the
[shared safeguards](../../SKILL.md). Match the method to the question and usable
evidence; no meta-analysis, language, package, or database is compulsory.

## Establish the analysis basis

Identify the question/estimand, population/context, comparison, outcome, time
window, and intended interpretation. Check input definitions and provenance.
Link multiple reports of a study and identify overlapping cohorts before treating
observations as independent. Preserve the planned selection rules and label
post hoc analyses; do not choose an analysis because it gives a preferred result.

Assess clinical, conceptual, and methodological compatibility before pooling.
A statistical heterogeneity measure alone cannot establish that pooling is
appropriate. When data are incompatible or insufficient, explain why and choose
a defensible descriptive, narrative, or qualitative approach.

## Quantitative work, when warranted

- Verify denominators, units, scale direction, effect measures, uncertainty,
  time points, and adjusted versus unadjusted estimates. Use explicit, justified
  transformations; do not conflate SD/SE or convert medians to means silently.
- Handle shared controls, multi-arm studies, pairing, clustering, repeated
  measures, and overlapping samples without double counting. State correlation,
  missing-data, zero-event, and continuity-correction assumptions where used.
- Justify the model, weighting, variance estimation, interval method, and relevant
  diagnostics. Report effect estimates with uncertainty and usable study/sample
  counts, not just p values. Prediction intervals or other diagnostics require
  an appropriate model and enough information, not automatic inclusion.
- Treat sparse-data and small-study/publication-bias assessments cautiously;
  a test with little power cannot prove absence of bias. Explain planned
  sensitivity analyses for influential studies, bias, and key assumptions.
  Mark subgroup/meta-regression analyses as exploratory when not prespecified.

## Narrative or qualitative work

Make grouping and comparison rules explicit. Connect each statement or theme to
the contributing studies/findings, their context, uncertainty, and limitations.
Look for contradictions and negative cases rather than selecting vivid examples.
Do not vote-count statistically significant studies, equate theme frequency with
prevalence, or infer equivalence from non-significant differences. Keep participant
accounts, authors' interpretations, and the reviewer's synthesis distinguishable.
For mixed evidence, explain how strands inform one another without erasing their
different units or standards of inference.

## Make results rerunnable and bounded

Use the researcher's existing tools where suitable. Retain input versions,
commands/scripts or workbook formulas, relevant software versions, parameters,
and random seeds where applicable. Test calculations against small known cases;
check signs, ranges, units, totals, and mappings from inputs to outputs. Do not
claim a calculation was run when only code or a method was drafted.

Present limitations from missing data, inconsistency, bias, and applicability
alongside the results. Do not make causal claims beyond the design and assumptions.
Load [appraisal](../appraisal/SKILL.md) for formal certainty assessment or
[writing](../writing/SKILL.md) to turn verified findings into a report. Keep
analysis outputs separate from immutable inputs and preserve failed/partial runs
as limitations rather than silently presenting them as complete results.
