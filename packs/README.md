# Language-pack publishing

Language packs are ordinary model v3 JSON or JSON.gz files. Publish immutable
files as GitHub Release assets, calculate SHA-256 over the exact downloaded
bytes, and add entries to a catalog matching `catalog.example.json`.

Before publishing a pack:

- Record every corpus repository, revision, and license.
- Exclude generated, vendor, dependency, minified, benchmark, and test-fixture
  trees.
- Confirm comments and license headers are absent from model observations.
- Train and test by repository, never by random files from the same repository.
- Run the offline benchmark and report accuracy, latency, model size, and
  pattern count.
- Keep each pack under the extension's 256 MB download safety limit.

The catalog must be served over HTTPS from a maintainer-controlled location.
Users configure that URL explicitly; the extension has no default network
endpoint until real packs and their provenance are published.
