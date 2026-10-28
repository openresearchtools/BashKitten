# Semantic search over a paper collection

Embedding similarity can help the agent and researcher find related papers or
choose what to read next. It can also help explore a proposed score boundary.
The search question, model, representation, review criteria, and acceptable risk
remain research choices. No automatic eligibility cutoff is implied.

## Represent the text you actually have

For the requested paper-ranking use case, each document combines its title and
abstract, retaining both originals and its stable source ID. An example input is
`title + "\n\n" + abstract`. The topic is a separate query input. A model may need
additional query/document instructions or prefixes; those are part of the recipe,
not replacements for the title and abstract.

A missing abstract leaves title-only evidence. An empty title and abstract leave
no usable text. Keep missing/failed inputs visible and report how they were
handled. Low scores for incomplete metadata do not establish that the paper is
irrelevant. If lawful full text is needed to decide, retrieve/read it separately;
an abstract embedding is not a full-text assessment.

Document the exact topic text, source/corpus version, IDs, text composition,
model/version, dimensions, pooling, normalization, query/document instructions,
server settings affecting input, and any intentional changes to text. Hashes or
saved inputs can identify the actual embedded text without a mandated file layout.
Use the same compatible model and recipe for query and corpus. Changing a model,
prompt, representation, or aggregation rule requires compatible recomputation and
a fresh assessment of the ranking and any proposed boundary.

Check token limits with the selected model and serving configuration. A character
limit is not a token count. Do not assume a successful HTTP response means every
input token was used. Establish whether the server rejects or truncates overlong
inputs, and fail or explicitly handle overflow before treating the score as
representative of the whole title and abstract. If chunking is chosen, preserve
chunk boundaries and the aggregation rule; averaging or taking the maximum of
chunk scores creates a different retrieval method and needs its own assessment.

Model recipes vary. For example, Nomic Embed Text v1.5 requires task prefixes:
`search_query: ` for the topic and `search_document: ` for each paper. Its model
card also specifies pooling and normalization examples; context capacity depends
on how the model is served. Other models can use different instructions or no
prefix. Follow the chosen model and endpoint rather than adding these prefixes
universally.
[Official Nomic model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5).
Sentence Transformers likewise distinguishes query and document encoding for
models trained with different prompts or routes.
[Official semantic-search documentation](https://www.sbert.net/examples/sentence_transformer/applications/semantic-search/README.html).

## Interpret a cosine ranking

Cosine compares the direction of two nonzero vectors:
`dot(query, document) / (norm(query) * norm(document))`.
Its numeric range is -1 to 1. It is not a probability of relevance or inclusion.
A score of 0.4 has no universal scientific interpretation; distributions depend
on the model, task, text and embedding recipe. The E5 model card, for example,
explains why its scores tend to occupy a relatively high range. Preserve raw
scores and ordering, and assess the actual texts in this collection.
[Official E5 model card](https://huggingface.co/intfloat/multilingual-e5-base).

The helper's ranking can be copied into a spreadsheet, Markdown notes, an analysis
script, or an existing research store. Keep stable IDs so a re-sort or changed
score cannot break the link to the evidence. Retain tied scores and records not
scored; neither tie-breaking nor input order conveys relevance.

Use exact keyword/identifier searches and topic synonyms alongside semantic
ranking when helpful. Check known relevant papers and investigate where they
rank, including relevant papers missed by the initial source search. These checks
can reveal failures, but they do not estimate recall for an unknown literature by
themselves. Similar language can retrieve ineligible papers; different language
can hide relevant ones. Missing abstracts and poorly represented languages or
subtopics deserve separate attention.

## Explore a cutoff without turning one example into a rule

Suppose the agent reads an irrelevant paper with cosine 0.4. That observation
supports an assessment of that paper. It supplies no monotonic guarantee that
all lower-scoring papers are irrelevant. A score cutoff is a retrieval convenience
or a proposed stopping decision, separate from the eligibility criteria.

For a useful investigation, inspect multiple complete available titles and
abstracts from score regions around and below the proposed boundary. Coverage
might combine nearby scores, several deeper bands, low-score tail records, and
random samples from the remaining low-score population. These serve different
purposes: boundary examples expose local mistakes; deeper/random observations
can reveal failures that inspecting only the boundary misses. Examine uncertain,
missing-abstract, language, and unusual-subtopic cases separately rather than
letting abundant easy negatives stand in for them. Choose sample sizes and bands
for the collection and user's goal; a ten-paper demonstration is not validation
of a stopping rule for thousands of papers.

For a small collection, reading all titles and abstracts may be easier. For a
larger one, keep the sample selection reproducible and avoid calling a purposive
sample statistically representative. If a quantified estimate of missed relevant
records is required, use an appropriate probability sampling and uncertainty
analysis for that design; a convenience sample or a few bands is not enough.
No sample with zero relevant hits proves that the unsampled remainder is empty
of relevant papers.

A relevant paper below the cutoff is a counterexample to the proposed blanket
exclusion. An uncertain paper also needs attention. Retain those records and
investigate why they scored low: topic phrasing, missing content, terminology,
language, input truncation, or a model/task mismatch may be involved. More than
one topic query or complementary keyword searching may help. Revisit the proposed
method with the researcher as needed. Moving the cutoff to the lowest relevant
sampled score does not make the unexamined lower region safe.

A useful record of the investigation contains, in the researcher's chosen format:

- The topic, model/recipe, corpus size, proposed boundary and score-band counts.
- Sampled stable IDs and scores, selection method/seed, and which text was read.
- Per-record relevance/eligibility judgement and reason tied to the question or
  criteria, including uncertainty and missing information.
- Counts reviewed per region, relevant/uncertain exceptions, and what remains
  unreviewed or unscored.
- The resulting provisional decision and its limits, including remaining recall
  uncertainty and any further work the researcher elects to do.

Preserve the original ranking and reasons when changing methods. Agent judgements
should be labelled as such; repeated agent runs do not constitute independent
human review. Loading this capability does not authorize deletion of low-ranked
records or upload of evidence to another service.

## Bundled helper

Inspect the standalone helper from the package directory:

```sh
node scripts/embeddings.mjs --help
node scripts/embeddings.mjs rank --input /path/to/works.json \
  --query 'barriers to sharing and reusing scientific research data' \
  --base-url http://127.0.0.1:8080/v1 --model YOUR_EMBEDDING_MODEL \
  --output /path/to/ranked.json
```

The URL and model name are examples: use the researcher's already configured
embedding endpoint and its actual model ID. The helper does not install or start
it. Set model-specific `--query-prefix` and `--document-prefix` when required;
blank prefixes are appropriate only for a compatible recipe. Optional
`EMBEDDINGS_API_KEY` authentication is sent only as a header and is not saved.
Do not send a local corpus to a remote endpoint without the relevant permission.

The helper combines trimmed title and abstract with a blank line, reports which
text fields are missing, and rejects records with neither. It preserves the
original input under `source`; ranked records link stable IDs and original input
positions. Output includes embedding recipe/provenance and a reusable cache.
Use `--cache /path/to/previous-ranked.json` only for compatible cached vectors;
model, endpoint, recipe and actual text must agree. An unchanged model alias can
hide replaced weights or changed server configuration: record the model revision
or weight hash and invalidate the cache when those change. The helper cannot
detect that substitution from the alias alone. A cache does not preserve the
meaning of a cutoff across a changed corpus or question.

Byte/request limits and response validation bound the operation; they do not
verify the server's tokenization or prevent server-side truncation. Check the
actual model/server input behavior as described above. Inspect `--help` for
batch size, timeout, supported input and other current limits. Existing output
files are preserved unless `--overwrite` is explicit.

This deterministic aid obtains embeddings and ranks by cosine. It does not infer
a scientific cutoff or decide eligibility, and needs no vector database or new
agent loop. Keep endpoint credentials and private corpus files out of Git.

See the [capability instructions](../skills/systematic-review/capabilities/semantic-search/SKILL.md)
for agent-facing guidance, [research artifacts](research-artifacts.md) for flexible
file choices, and [OpenAlex](openalex.md) for metadata/abstract retrieval. Zotero
reads use the running application's local HTTP API, including the native Termux
port, or an offline snapshot; semantic ranking does not require Zotero.
