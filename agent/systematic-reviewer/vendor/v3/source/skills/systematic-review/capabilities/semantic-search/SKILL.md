---
name: semantic-search
description: Rank a paper collection against a research topic using embeddings, investigate score boundaries, and identify retrieval gaps without equating similarity with eligibility.
license: AGPL-3.0-or-later
disable-model-invocation: true
---

# Explore a corpus by semantic similarity

Use when the researcher wants related papers, a useful reading order, or evidence
about a proposed similarity boundary. Apply the [shared safeguards](../../SKILL.md).
This capability is optional; it does not require a vector database, a fixed
screening process, an embedding model, or an exclusion threshold.

Read the [semantic-search guide](../../../../docs/semantic-search.md) for the
bundled helper, embedding recipes, and examples of boundary investigation.
Use the researcher's configured embedding service or existing compatible vectors;
inspect current helper help. Do not install a model, start a server, or send a
local corpus to another service merely because this capability is loaded.

## Use scores as retrieval evidence

- For paper retrieval, combine each available title and abstract into one
  document input, preserving its stable source identity and original text.
  If the question calls for another representation, make that choice explicit.
  Distinguish missing abstracts, title-only inputs, and failed embeddings from
  assessed irrelevance; do not quietly drop those records.
- Embed the topic with the model's query recipe and the papers with its document
  recipe. Check required prefixes/instructions, pooling, normalization, dimensions,
  languages, and token/context limits against the selected model and server.
  Never silently truncate text or mix incompatible vectors. Record the actual
  model/version, input recipe, topic, corpus, and missing/failed inputs.
- Cosine similarity orders these inputs under this recipe. It is not an
  eligibility probability, evidence-quality score, or portable numeric scale.
  Inspect actual titles and abstracts against the research question; topic
  resemblance alone cannot establish population, design, outcome, or eligibility.
- Exact keywords, identifiers, synonyms, known relevant papers, and citation
  chasing can expose semantic misses. Compare complementary searches where useful;
  a high-scoring list or a small successful example does not establish recall.

## Investigate a proposed boundary

A low-scoring irrelevant paper is evidence about that paper, not every paper
below it. In particular, one irrelevant item at 0.4 cannot justify discarding all
items below 0.4. Keep any tentative cutoff separate from eligibility decisions.

When assessing a cutoff, read multiple actual titles and abstracts below it,
not only the nearest item or a score histogram. Use samples that cover several
score bands around and below the boundary, the lower tail, and random draws from
the remaining low-score population; investigate missing-text, ambiguous, and
other unusual cases separately. Choose coverage and effort for the corpus,
question, risk of missed evidence, and user's constraints, rather than applying
a universal sample size. If the collection is small, reading all candidates may
be simpler. Record the selection method and random seed where used.

Relevant or uncertain exceptions below the proposed boundary undermine a simple
exclusion rule. Keep those records in consideration, inspect similar cases, and
reconsider the topic wording, representation, model, or threshold as appropriate.
Do not merely move the cutoff to the lowest relevant sampled score and claim the
remaining tail is clear. If the user elects to stop reviewing a region, describe
that as an explicit, provisional decision with remaining recall uncertainty.

Report the sampled identities, counts and score regions, text actually read,
decisions and reasons, exceptions, and unsampled population. Preserve the full
ranking and source links in the user's chosen artifact format. State what the
investigation supports and what remains unknown: a sample with no relevant hits
does not prove that the unsampled records contain none. Load
[screening](../screening/SKILL.md) for eligibility assessment when needed; semantic
ranking does not change the researcher's criteria or supply completed human review.
