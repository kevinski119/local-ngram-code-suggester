# 500-case N-Gram experiment

Executed on 2026-11-11 with extension **3.1.0**, VS Code **1.146.0**, Windows x64.
All 500 distinct cases completed in each of six configurations: three feature
combinations at 5- and 12-token limits, totaling **3,000 case/configuration pairs**.
Each pair also passed three repeated-output consistency checks after warm-up.
No production completion code was changed to improve the results.

## Newest engine: project learning and reuse enabled

Each language has **80 completion cases and 20 safety controls**. Accuracy is
calculated on the 80 completion cases only. Safety checks are not counted as
correct completions.

| Language | Cases run | First token correct | Full match, 5 tokens | Full match, 12 tokens | Safety controls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rust | 100 | 65/80 (81.25%) | 35/80 (43.75%) | 55/80 (68.75%) | 20/20 |
| TypeScript | 100 | 65/80 (81.25%) | 35/80 (43.75%) | 55/80 (68.75%) | 20/20 |
| Python | 100 | 65/80 (81.25%) | 35/80 (43.75%) | 55/80 (68.75%) | 20/20 |
| Java | 100 | 65/80 (81.25%) | 35/80 (43.75%) | 55/80 (68.75%) | 20/20 |
| C# | 100 | 65/80 (81.25%) | 35/80 (43.75%) | 55/80 (68.75%) | 20/20 |
| **Total** | **500** | **325/400** | **175/400** | **275/400** | **100/100** |

The identical reuse scores are expected from applying the same template families
and intended outcomes to each language. They do **not** establish equal accuracy
on real Rust, TypeScript, Python, Java, or C# projects. This is a synthetic lexical
completion exercise, not a compiler or language-server benchmark.

## What the features add

| Configuration | Next token correct | Full match, 5 tokens | Full match, 12 tokens |
| --- | ---: | ---: | ---: |
| Bundled model only | 0/400 | 0/400 | 0/400 |
| Project learning | 325/400 | 105/400 (26.25%) | 7/400 (1.75%) |
| Project learning + sequence reuse | 325/400 | 175/400 (43.75%) | 275/400 (68.75%) |

At five tokens, reuse adds **70 full matches**, an improvement of **17.5 percentage
points** over project learning alone. At twelve tokens, reuse adds **268 full
matches**, or **67 percentage points**. Longer generated beams without reuse often
over-complete or select incorrect arguments/punctuation, causing their exact-match
score to drop. Increasing the cap is not inherently an improvement.

The bundled-only result is deliberately difficult: these cases ask for invented,
project-specific methods such as `reserveStockBatch`, unavailable from general
starter patterns. Its zero score is **not** a general accuracy measurement.
Project learning predates v3.1; the incremental reuse comparison isolates the
newer feature. These are current-engine feature ablations, not historical binaries.

### Remaining misses

At twelve tokens with reuse, the 125 full-match misses are:

- 50 new-argument cases: the method is right but the old argument is reused.
  The intended new argument is absent from observed support and context.
- 50 unseen-method cases: the intended method has never been observed.
- 25 ambiguous cases: the engine picks the other plausible call.

At five tokens, another 100 misses come from the short cap truncating two-argument
or chained calls. All 100 isolation/comment/string controls passed in all six
configurations (600 control checks). Completion misses are reported as misses;
they are not described as passing tests.

## Cases and reproducibility

[Fixtures](project-500-fixtures.json) are generated deterministically by
[generate_500_fixtures.js](generate_500_fixtures.js): ten domain vocabularies crossed
with ten editing scenarios per language. The scenarios are a repeated call,
spacing, chaining, partial identifiers, new arguments, ambiguous alternatives,
unseen members, receiver disambiguation, workspace isolation, and suppression in
comments/unfinished strings. All 500 case identities and content tuples are
distinct, but their shared templates make them correlated observations. This is
not 500 independently sampled repository edits or an estimate of general usage.

The harness uses the real extension API in twenty-five fresh-profile batches of
twenty cases. Each case gets a separate workspace folder. Only observed support
and the unfinished target prefix are opened; the expected answer is never
indexed. Each batch has 42 documents, avoiding both the extension's file cap and
VS Code's eviction of unused file buffers. Indexed document counts are asserted.

Settings match the [focused benchmark](PROJECT_BENCHMARK.md): Quality mode,
`minConfidence=0.85`, five candidates, cross-project memory and acceptance learning
off. Both token caps use a 250 ms quality-evaluation budget to reduce timing noise;
this is not the default 35 ms deadline under load. Automatic triggering and UI
rendering are excluded. Snippets need not be standalone compilable programs;
the extension performs lexical completion. No third-party completions are scored.

From `extension/` with dependencies installed:

```bash
npm run benchmark:500
```

On headless Linux use `xvfb-run -a npm run benchmark:500`. The runner resolves
stable VS Code once, then reuses that executable for every batch. Set
`VSCODE_EXECUTABLE_PATH` to an installed test executable to skip that network step.
The recorded 500-case run was on **Windows only**; the separate focused benchmark
is run in CI on Windows, Ubuntu, and macOS.

Outputs:

- `project-500-summary.json`: committed metrics by language, group and feature set,
  plus model, fixture and engine hashes and environment metadata.
- `project-500-latest.json`: generated full report including every suggestion and
  timing; gitignored because it is larger and changes with each run.
- `project-500-cases.csv`: generated, sortable table of all 3,000 pairs, expected
  outcomes and first suggestions; gitignored.

The command finishes and records all cases before failing if any safety control
fails. Inference misses are measurements, not fatal assertions. Fixture/setup,
document-count, scoring and deterministic-output checks fail immediately to avoid
reporting invalid measurements. The production engine hash matches the smaller
benchmark, so the two runs did not use differently tuned engines.
