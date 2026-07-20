# Local N-Gram Code Suggester

Fast, private, comment-aware code completion that runs locally.

![Local N-Gram icon](assets/icon.png)

## Highlights

- Inline and IntelliSense completion without an account or subscription.
- Comments are excluded from code context and training.
- Variable-order n-grams with exact backoff instead of model-wide fuzzy scans.
- Bounded multi-token suggestions with Fast, Balanced, and Quality presets.
- Optional local project adaptation and free language-pack support.
- Local diagnostics with no telemetry.

Supported profiles: C#, JavaScript, TypeScript, Python, JSX/TSX, Vue, and Razor.

Source, releases, and issue tracking:
[kevinski119/local-ngram-code-suggester](https://github.com/kevinski119/local-ngram-code-suggester).

Run **Local N-Gram: Show Model Diagnostics** to inspect the active model and
latency. Run **Local N-Gram: Manage Language Packs** to import a local pack or
use a configured trusted catalog. No pack is downloaded without user action.

## Privacy

Tokenization, completion, project context, and diagnostics stay on your
machine. Network access is limited to user-initiated pack catalog/download
operations or explicitly opted-in pack update checks.

## Attribution

Derived from Erik Klabukov's
[amest/vscode-ngram-code-suggester](https://github.com/amest/vscode-ngram-code-suggester)
under the MIT License. The
[original Marketplace listing](https://marketplace.visualstudio.com/items?itemName=nb47.vscode-ngram-suggester)
is maintained separately.

## License

MIT. See the included license.
