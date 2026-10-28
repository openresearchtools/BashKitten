---
name: screening
description: Apply explicit eligibility criteria to records or full texts, handle uncertain cases, and reconcile decisions without opaque or unreviewed exclusion.
license: AGPL-3.0-or-later
disable-model-invocation: true
---

# Screen against explicit criteria

Use for a defined set of eligibility decisions or their reconciliation. Apply the
[shared safeguards](../../SKILL.md). Keep the researcher's artifact format and
reviewer policy; do not impose a screening table or require subagents.

## Establish the decision basis

Identify the criteria/version, screening level, record set, and authority to
finalize decisions. If criteria are missing or materially ambiguous, surface the
question and make provisional recommendations rather than inventing exclusions.
Pilot a small, varied sample when helpful to expose inconsistent interpretations.
Resolve those interpretations before scaling the work.

Title/abstract screening and full-text screening use different evidence. Lack of
information at an early level is not proof of ineligibility. Use a conservative
uncertain/retrieve recommendation when a decisive criterion cannot be assessed.

## Make each decision checkable

- Apply the actual criteria, not topical similarity, prestige, citation count,
  opaque scores, or an assistant's preferred findings. Ranking may prioritize
  reading; it must not silently exclude lower-ranked records.
- Retain the source identity, criteria version, decision/recommendation, and a
  concise rationale tied to relevant evidence and a locator. For full-text
  exclusions, use a clear criterion-based reason; apply any agreed reason
  hierarchy consistently rather than inventing one after seeing results.
- Read the material necessary for the decision using
  [evidence reading](../evidence-reading/SKILL.md). If only an abstract or partial
  source was available, say so. Unretrieved full texts belong in access/coverage
  reporting, not a fabricated substantive exclusion reason.
- Keep duplicates, companion reports, superseded versions, and independent
  studies distinguishable. Link related reports so information from a companion
  paper is not lost or counted twice.
- Mark uncertain cases and agent-generated judgements visibly. Do not finalize
  automated exclusions without the researcher's agreed review process. Do not
  claim independent dual human screening from multiple model passes.

## Reconcile without erasing disagreement

When a second assessment is available, preserve both initial decisions and
rationales. Compare the disputed evidence and criterion; seek designated human
adjudication for unresolved ambiguity. An extra model vote does not establish
truth. If the rule changes, record an amendment and revisit affected decisions.

Keep accounting possible at the correct unit: retrieved records, unique records,
reports sought/retrieved/assessed, and included studies as relevant. Counts should
come from the actual decisions, not from a desired flow-diagram total. Record
pending cases separately and avoid counting them as exclusions.

Deliver decisions in the requested artifact plus unresolved cases, checks, and
coverage limitations. Load [verification](../verification/SKILL.md) for a larger
count or audit exercise; screening does not require extraction or synthesis.
