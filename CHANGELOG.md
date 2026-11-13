# Changelog

All notable changes are documented here.

## Unreleased

- Add N-Gram Quick Fixes (lightbulb / Ctrl+.) for code that is already typed.
  The local model ranks small edits (quote a run of bare words such as
  `print(hello world)`, or insert, remove or swap one punctuation token) and
  offers up to three. Two line-shape checks the model cannot see also run: a
  missing `:` on a Python block header and a bracket left open at the end of
  a statement. Nothing is applied automatically. Disable with
  `codeSuggester.quickFix.enabled`.
- Experimental `codeSuggester.quickFix.showHints` (off by default) marks edited
  lines with a faint hint after you move off them.

## 3.1.0 — local preview

- Retrieve exact single-line code sequences from indexed open files for inline
  completions, preserving spacing. Matches require exact receiver/context tokens,
  respect workspace isolation and length limits, and exclude string literals.
- Rank available suggestions using choices accepted in the same context during
  this session. Preferences stay in bounded memory and can be reset or disabled.
- Reuse cursor-prefix scans between providers with version/language/position
  invalidation and bounded LRU storage. Prepare lexical profiles once instead of
  sorting comment and string definitions at every character.
- Show scan reuse and acceptance counters in diagnostics.
- Fix Quality mode's hidden five-token cap and honor the configured soft latency
  budget. Default length remains five tokens; Quality can now use up to twelve.

## 3.0.0 — local preview

- Add Rust activation, language profile, trainer support, bundled starter data,
  and tokenizer parity fixtures covering nested comments, literals, lifetimes,
  raw identifiers, macros, paths and ranges. Exclude Cargo `target` directories.
- Learn exact project contexts and identifier prefixes; use project patterns in
  multi-token continuation, with workspace-folder isolation and bounded memory.
- Preserve completion prefixes and matching right-hand text in both providers.
- Add a status-bar controls menu and pause/resume setting.
- Suppress code suggestions in unfinished strings; honor explicit inline requests
  regardless of automatic trigger-character restrictions.
- Cancel pending learning on close/clear and remove stale oversized documents.
  Clearing project context no longer erases the bundled prefix vocabulary.
- Label ranking values as scores rather than misleading percentages.

## 2.1.0

- Added first-class Java and JSON/JSONC language profiles, activation, training,
  project adaptation, and comment-safe tokenizer fixtures.
- Added an original MIT-licensed curated starter corpus and token-frequency
  metadata for stronger cold-start and prefix ranking.
- Made Quality mode and a `0.85` confidence gate the defaults to favor fewer,
  more trustworthy first-run completions.
- Made multi-token stopping language-aware and raised continuation confidence
  so accepted JSON values and code blocks do not drift into weak predictions.
- Added held-out Java and JSON smoke benchmarks.
- Added a 0â€“100 automatic suggestion-frequency control and reduced Quality
  completions from eight tokens to a configurable five-token default.
- Added conservative persistent cross-project learning: saved files only,
  diagnostic-error rejection, repeated-identifier filtering, capped
  contributions, hashed project IDs, and multiple-project promotion.
- Namespaced learned external-library identifiers by detected pip, npm, Java,
  and .NET imports to prevent dependency APIs leaking into unrelated projects.
- Added receiver-aware member statistics and preserved numeric literals so
  expressions such as `screen.get_height() / 2` can complete accurately.
- Added syntax-transition guards that reject obvious word collisions after
  closing expressions.

## 2.0.0 - Unreleased

- Rebranded the attributed fork as Local N-Gram Code Suggester.
- Added declarative C#, JavaScript/TypeScript, Python, Vue, and Razor profiles.
- Added comment-safe, multiline-aware tokenization shared by trainer and runtime fixtures.
- Added model format v3 with orders 2–6, normalized contexts, corpus metadata, and checksums.
- Replaced model-wide fuzzy scans with exact interpolated backoff.
- Added bounded multi-token inline completion with Fast, Balanced, and Quality presets.
- Added local cache/latency/model diagnostics and a status-bar indicator.
- Added local and catalog language-pack installation with SHA-256 verification.
- Kept legacy v2 JSON and JSON.gz model loading.

## 1.2.0 - 2026-07-20

- Fixed project-context lifecycle and configuration reload behavior.
- Enabled inline and IntelliSense providers.
- Added trainer and runtime regression tests.
- Replaced a missing Git LFS model with a valid starter model.
- Modernized packaging, linting, and dependencies.

## Upstream

This project is derived from
[amest/vscode-ngram-code-suggester](https://github.com/amest/vscode-ngram-code-suggester)
by Erik Klabukov (`nb47`) under the MIT License.
