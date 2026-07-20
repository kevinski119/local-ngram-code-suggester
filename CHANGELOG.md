# Changelog

All notable changes are documented here.

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
