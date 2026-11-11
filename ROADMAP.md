# Roadmap

## v3 preview

Implemented locally: Rust support and starter data, exact project patterns,
project identifier completion, project-aware continuation, workspace isolation,
bounded learning, suffix-aware edits, and a native status-bar controls menu.
The v3.1 preview adds exact source-sequence reuse, session acceptance preferences,
shared prefix-scan caching, faster profile preparation, and configurable longer
Quality completions.

## Before a public v3 release

- Review the preview in everyday Rust and existing-language projects.
- Run the existing CI matrix on Windows, macOS, and Linux.
- Expand the original smoke fixtures to held-out repositories with clear licenses
  and measure end-to-end editor latency as well as lookup accuracy.
- Refresh Marketplace screenshots from the v3 extension host; current images
  are explicitly labeled simulations from the earlier release.
- Publish under the existing publisher after review.

## Later candidates

- Documentation-comment completion as a model separate from code.
- Incremental lexical scanning or worker-based inference for large documents.
- Optional workspace indexing that honors ignore rules and user exclusions.
- Go language profile and starter corpus.
- Compact binary context indexes if JSON.gz load time becomes the dominant cost.
