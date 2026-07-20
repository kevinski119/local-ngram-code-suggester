# Changelog

All notable changes are documented here.

## 2.1.0 - Unreleased

- Added first-class Java and JSON/JSONC language profiles, activation, training,
  project adaptation, and comment-safe tokenizer fixtures.
- Added an original MIT-licensed curated starter corpus and token-frequency
  metadata for stronger cold-start and prefix ranking.
- Made Quality mode and a `0.85` confidence gate the defaults to favor fewer,
  more trustworthy first-run completions.
- Made multi-token stopping language-aware and raised continuation confidence
  so accepted JSON values and code blocks do not drift into weak predictions.
- Added held-out Java and JSON smoke benchmarks.

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
