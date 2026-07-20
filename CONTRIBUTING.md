# Contributing

Contributions are welcome to this attributed MIT-licensed fork.

## Checks

```bash
cd extension
npm ci
npm test
npm run package

cd ..
python -m unittest discover -s tests -v
python benchmarks/run_benchmark.py
```

Tokenizer changes must update the shared language-profile data and golden
fixtures. Trainer and TypeScript runtime token streams must remain identical.

Public model contributions must document corpus repositories, revisions, and
licenses. Do not submit models trained from private code, generated/vendor
trees, minified bundles, or corpora whose licenses do not permit redistribution.

Keep completion local and telemetry-free. New network behavior must be
user-initiated, documented, and independently disableable.
