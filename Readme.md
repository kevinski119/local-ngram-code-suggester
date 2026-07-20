# Local N-Gram Code Suggester

Fast, private code completion that runs entirely on your machine. Model v3 uses
comment-aware language profiles, variable-order n-grams, exact backoff, local
project adaptation, and bounded multi-token completion—without an account,
subscription, telemetry, or mandatory network connection.

> This is an attributed MIT-licensed fork of Erik Klabukov's
> [amest/vscode-ngram-code-suggester](https://github.com/amest/vscode-ngram-code-suggester).
> The original extension remains available on the
> [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=nb47.vscode-ngram-suggester).

## What v2 adds

- Stateful comment/string handling for C#, Java, JavaScript/TypeScript, JSON,
  JSONC, Python, JSX/TSX, Vue, and Razor.
- Comments excluded from training and project context; suggestions in comments
  disabled by default.
- N-gram orders 2–6 with normalized contexts and exact interpolated backoff.
- Fast, Balanced, and Quality performance presets.
- Multi-token inline suggestions with a configurable latency budget.
- Frequency control and a five-token default cap to keep ghost text focused.
- Saved, error-free patterns can transfer across projects at low weight only
  after independent project support; project identities are stored as hashes.
- External-library identifiers are kept in dependency-specific namespaces, so
  a project without `pygame` (or the matching npm/Java/.NET dependency) will
  not receive that library's learned functions.
- Receiver-aware member completion preserves useful API patterns such as
  `screen.get_height() / 2` while numeric literals remain structural context.
- Local model, cache, project, and p95 latency diagnostics.
- Optional user-initiated language packs with size and SHA-256 verification.
- Backward-compatible loading of v2 JSON and JSON.gz models.

## Build and test

Requirements: Python 3.9+, Node.js 20+, and VS Code 1.85+.

```bash
cd extension
npm ci
npm test
npm run package

cd ..
python -m unittest discover -s tests -v
python benchmarks/run_benchmark.py
```

Install the resulting VSIX:

```bash
code --install-extension extension/local-ngram-code-suggester-2.1.0.vsix
```

## Train a model v3

The dependency-free trainer excludes common generated/vendor directories and
uses the same language profiles as the extension.

```bash
python code_model_trainer.py \
  --model extension/models/model.json \
  --language all \
  --n-gram 6 \
  --include-starter-corpus \
  --fresh
```

Use `--language cs|java|js|json|ts|py|all`, or supply one or more source globs
with `--pattern`. The optional starter corpus is original MIT-licensed,
deterministically generated training data for stronger cold-start structure.
Without `--fresh`, training merges into a compatible existing model. Public
packs must document corpus sources and redistribution licenses.

## Settings

| Setting | Default | Purpose |
| --- | ---: | --- |
| `codeSuggester.performancePreset` | `quality` | Fast, Balanced, or Quality behavior |
| `codeSuggester.maxLatencyMs` | `35` | Inline completion computation budget |
| `codeSuggester.minConfidence` | `0.85` | Hide weak cold-start predictions |
| `codeSuggester.enableMultiToken` | `true` | Bounded multi-token inline completion |
| `codeSuggester.maxInlineTokens` | `5` | Maximum length of one ghost-text suggestion |
| `codeSuggester.suggestionFrequency` | `50` | Automatic suggestion frequency from 0 to 100 |
| `codeSuggester.suggestInComments` | `false` | Permit code suggestions in comments |
| `codeSuggester.modelPath` | bundled model | Custom model path |
| `codeSuggester.useProjectContext` | `true` | Learn from open supported documents |
| `codeSuggester.updateOnFileChange` | `false` | Re-index documents while editing |
| `codeSuggester.crossProjectLearning` | `true` | Conservatively retain portable saved patterns |
| `codeSuggester.languagePacks.autoUpdate` | `false` | Opt into pack update checks |
| `codeSuggester.languagePacks.catalogUrl` | empty | Trusted optional pack catalog |

## Marketplace release status

The code and VSIX are ready for manual upload under the `KevinJarz`
Marketplace publisher. Run `npm run release:check` from `extension/` to rebuild
and validate the upload artifact.

The Marketplace preview images and feature animation are deterministic,
privacy-safe Pillow renders driven by the bundled n-gram model. Optional
language-pack catalog URLs and corpus/license records are required only when
public packs are published; they do not block the bundled starter release.

Development and issue tracking live at
[kevinski119/local-ngram-code-suggester](https://github.com/kevinski119/local-ngram-code-suggester).

See [ROADMAP.md](ROADMAP.md), [SUPPORT.md](SUPPORT.md),
[SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and
[PUBLISHING.md](PUBLISHING.md).

## Reproducible offline benchmark

The checked-in smoke corpus is intentionally small, but it prevents silent
accuracy and latency regressions. Missing predictions count as zero.

| Engine | Coverage | Top-1 | Top-3 | MRR | Lookup p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| v1.2 fixed-order baseline | 8.6% | 4.3% | 5.4% | 0.048 | 0.006 ms |
| v2.1 Quality (`0.85` gate) | 74.6% | 55.1% | 57.4% | 0.563 | 0.087 ms |

Results: [v1.2 baseline](benchmarks/v1.2-baseline.json) and
[current v2](benchmarks/latest.json). Public quality claims must additionally
use held-out repositories supplied through repeated `--test-root` arguments.

## License and attribution

MIT. The original copyright notice remains unchanged in [LICENSE](LICENSE).
