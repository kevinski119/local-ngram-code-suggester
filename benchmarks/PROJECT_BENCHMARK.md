# Project learning and sequence reuse benchmark

For the additional 100-per-language experiment, see [the 500-case suite](PROJECT_500.md).

This measures feature effects in extension 3.1.0 using its actual
`getInlineSuggestions` API inside VS Code 1.146.0. It does not reimplement the
completion algorithm and does not compare historical v3.0 and v3.1 binaries.
Project learning existed before v3.1. Sequence reuse is the new feature isolated
by the second comparison below. No production engine code was changed to improve
these scores.

## Recorded results

The committed [report](project-v31.json) was recorded on Windows x64 on
2026-11-11. Two fresh-profile local runs reproduced the same quality scores.
There are 20 quality cases (10 Rust, 10 TypeScript), plus 4 separate safety controls.
All percentages below use all 20 quality cases; abstentions count as misses.

| Token limit | Enabled features | Next token top-1 | Full tokens top-1 | Full tokens top-3 | Exact text top-1 | Correct leading tokens |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 5 (default) | Bundled model | 5% | 0% | 0% | 0% | 1.8% |
| 5 | + project learning | 75% | 20% | 30% | 15% | 44.2% |
| 5 | + sequence reuse | 75% | 40% | 50% | 40% | 51.3% |
| 12 | Bundled model | 5% | 0% | 0% | 0% | 1.8% |
| 12 | + project learning | 75% | 0% | 0% | 0% | 43.4% |
| 12 | + sequence reuse | 75% | 50% | 60% | 50% | 60.2% |

Increasing the token limit does not always improve a generated completion. With
reuse disabled, the longer beam-generated suggestions often continue past the
correct call or add incorrect punctuation/arguments. At 12 tokens, this causes
zero exact full matches despite 75% correct first tokens. This is a measured
weakness, not a reason to hide the 12-token result. Inspect each candidate in the
JSON report, for example `rs-transfer-argument` and `ts-transfer-chain`.

At the default limit, sequence reuse wins four additional full matches and loses
none, compared with learning alone. At 12 tokens, it wins ten full matches. It
also swaps one correct first-token result for an incorrect one on an ambiguous
TypeScript case while winning its paired alternative. Both directions are
listed by case ID in the report's `paired` field.

### Where the gains come from

Results with learning and reuse enabled, at 12 tokens:

| Scenario | Cases | Next token top-1 | Full tokens top-1 |
| --- | ---: | ---: | ---: |
| Deliberate repetition in a separate target file | 6 | 100% | 100% |
| Known method, new argument | 4 | 100% | 0% |
| Two plausible calls | 4 | 50% | 50% |
| Unseen member or standard-library context | 4 | 25% | 0% |
| Partial identifier | 2 | 100% | 100% |

The new-argument cases retrieve the old argument, not the intended new one.
On unseen cases, learning increases incorrect first-token suggestions from 25%
to 75%, mainly replacing abstention; reuse does not fix that. Across all cases,
coverage increases from 35% to 100%, but coverage alone is not success.

## Experimental controls

- Original, hand-authored synthetic fixtures; not randomly sampled repositories.
  The intentionally project-specific vocabulary makes the bundled-only baseline
  weak. Do not market the 70-point next-token gain as a general accuracy gain.
- Each case gets its own workspace folder. Support code is opened before a
  separate target file containing only text up to the cursor. Expected suffixes
  remain in the evaluation JSON outside the learned workspace.
- Exact support repetitions are intentional: reuse is meant to copy observed
  expressions. They are labeled separately from unseen continuations. Assertions
  check that repeated targets occur in support and new-argument/unseen targets do
  not. This is a controlled retrieval task, not a claim to avoid all training
  overlap with the bundled model.
- Two other-workspace cases ensure support cannot leak across scopes. A Rust
  comment and TypeScript string require abstention. These four controls are
  excluded from quality averages; all four passed in every configuration.
- Every mode uses the same bundled model, contexts, ranking threshold `0.85`,
  Quality preset, and five returned choices. Project learning and reuse are the
  only feature toggles. Cross-project memory and acceptance preferences are off.
- Both the default 5-token and optional 12-token caps are evaluated. A generous
  250 ms computation budget reduces deadline noise for quality evaluation;
  this is not a benchmark of the default 35 ms deadline under load.
- Built-in TypeScript diagnostics are disabled so incomplete synthetic targets
  are not unpredictably excluded from learning. No third-party completions are
  included. Files are indexed exactly once per configuration; indexed counts are
  asserted. The setup creates 50 documents, below the 128-document cap.
- SHA-256 values identify the canonical fixture JSON, model bytes, and relevant
  engine sources. Runtime, OS, architecture and VS Code version are recorded.
  Canonical fixture hashing avoids Windows line-ending differences.

## Metrics and timing

Suggestions are applied using their actual replacement ranges. This accounts for
partial identifiers, rather than giving credit for duplicated prefixes.
Next-token accuracy compares the first complete predicted token. Full-token
accuracy requires the entire intended continuation, with no extra tokens;
whitespace differences are ignored. Exact-text accuracy additionally requires
the intended spacing. Top-3 considers only the first three suggestions.

Correct-leading-token fraction sums contiguous correct leading tokens across
cases and divides by the total expected tokens. Credit stops at the first wrong
token. It is not a user study or measured keystroke savings. Scorer self-checks
cover partial identifiers, wrong arguments, spacing, over-completion, abstention,
and the top-3 cutoff.

Each case records its first API call, then three warm-up calls and twenty timed
calls. Every measured repetition must return the same result. Timings include
synchronous scanning, candidate generation, caching and edit construction. They
exclude model loading, UI rendering and automatic-trigger scheduling. The first
request is not a cold-process measurement, and mode order is fixed, so these
numbers should not be used to claim a feature makes the editor faster.
`warmRequestP95Ms` in a summary is the p95 of per-case warm p95 values, not one
pooled p95. Index timing includes VS Code command dispatch and all support/target
documents. No latency thresholds are enforced across different machines.

## Reproduce and inspect

From `extension/`, after `npm ci`, run:

```bash
npm run benchmark:project:check
```

Linux without a display: `xvfb-run -a npm run benchmark:project:check`.
The harness normally downloads/resolves stable VS Code. To run without that
network step after installing dependencies, set `VSCODE_EXECUTABLE_PATH` to an
existing VS Code executable. The temporary user profile and fixture workspace
are removed after the run; the normal editor profile is untouched.

The output is `benchmarks/project-latest.json` (gitignored). Set
`NGRAM_BENCH_OUTPUT` to override the output path. `npm run benchmark:project`
generates the report without comparing it to the committed baseline.

CI publishes an artifact named `project-benchmark-Windows`,
`project-benchmark-Linux`, or `project-benchmark-macOS`. The regression checker
requires matching model, fixtures and settings, and rejects per-case losses in
previously correct next-token, full-token, text, or leading-token matches. It
also rejects failed safety controls or newly wrong suggestions replacing prior
abstentions. Improvements are allowed. Changed fixtures/models require an
explicit baseline review; timing variation does not fail CI.

These results establish that the features work on these scenarios and reveal
specific failure modes. Estimating general usefulness needs a larger licensed,
held-out set of real editing histories with a chronological support/target split.
