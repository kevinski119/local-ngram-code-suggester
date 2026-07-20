"""Offline next-token benchmark for model v3.

Test files live outside trainer input by default. For public benchmark reports,
pass held-out repository roots that were never used to train the model.
"""

import argparse
import gzip
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ngram_tokenizer import scan_text


SUPPORTED_EXTENSIONS = {
    '.cs', '.cshtml', '.java', '.js', '.json', '.jsonc', '.jsx',
    '.py', '.ts', '.tsx', '.vue',
}


def load_model(filepath):
    opener = gzip.open if filepath.endswith('.gz') else open
    with opener(filepath, 'rt', encoding='utf-8') as model_file:
        model = json.load(model_file)
    return model


def predict(
    model,
    extension,
    raw_context,
    normalized_context,
    limit=3,
    min_confidence=0.0,
):
    if model.get('format_version', 2) < 3:
        order = model['n']
        if len(raw_context) < order - 1:
            return []
        context_key = json.dumps(raw_context[-(order - 1):])
        counts = model.get('ngrams', {}).get(extension, {}).get(context_key, {})
        total = sum(counts.values())
        return [
            token
            for token, count in sorted(
                counts.items(),
                key=lambda item: item[1],
                reverse=True,
            )
            if total and count / total >= min_confidence
        ][:limit]

    scores = {}
    max_order = model['max_order']
    min_order = model['min_order']
    extension_orders = model['orders'].get(extension, {})
    for order in range(max_order, min_order - 1, -1):
        if len(normalized_context) < order - 1:
            continue
        context = normalized_context[-(order - 1):]
        context_key = json.dumps(context)
        counts = extension_orders.get(str(order), {}).get(context_key)
        if not counts:
            continue
        total = sum(counts.values())
        weight = 0.65 ** (max_order - order)
        for token, count in counts.items():
            scores[token] = scores.get(token, 0.0) + (count / total) * weight
    if len(raw_context) >= 2 and raw_context[-1] == '.':
        receiver = raw_context[-2]
        members = (
            model.get('member_access', {})
            .get(extension, {})
            .get(receiver, {})
        )
        total = sum(members.values())
        if total:
            for token, count in members.items():
                scores[token] = max(
                    scores.get(token, 0.0),
                    0.75 + 0.25 * (count / total),
                )
    return [
        token
        for token, score in sorted(
            scores.items(),
            key=lambda item: item[1],
            reverse=True,
        )
        if score >= min_confidence
    ][:limit]


def iter_source_files(roots):
    for root in roots:
        for directory, subdirectories, filenames in os.walk(root):
            subdirectories[:] = [
                name for name in subdirectories
                if name not in {'.git', 'node_modules', 'dist', 'build', 'out', '__pycache__'}
            ]
            for filename in filenames:
                filepath = os.path.join(directory, filename)
                if os.path.splitext(filename)[1].lower() in SUPPORTED_EXTENSIONS:
                    yield filepath


def percentile(values, percentile_value):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * percentile_value + 0.999) - 1))
    return ordered[index]


def run(model, roots, min_confidence=0.0):
    top1 = 0
    top3 = 0
    reciprocal_rank = 0.0
    observations = 0
    covered = 0
    latencies = []

    for filepath in iter_source_files(roots):
        extension = os.path.splitext(filepath)[1].lower()
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as source_file:
            scan = scan_text(source_file.read(), extension)
        raw = [token.value for token in scan['tokens']]
        normalized = [token.normalized for token in scan['tokens']]
        for index in range(1, len(raw)):
            observations += 1
            started = time.perf_counter()
            predictions = predict(
                model,
                extension,
                raw[:index],
                normalized[:index],
                min_confidence=min_confidence,
            )
            latencies.append((time.perf_counter() - started) * 1000)
            if not predictions:
                continue
            covered += 1
            expected = raw[index]
            if predictions[0] == expected:
                top1 += 1
            if expected in predictions:
                rank = predictions.index(expected) + 1
                top3 += 1
                reciprocal_rank += 1 / rank

    return {
        'observations': observations,
        'coverage': covered / observations if observations else 0.0,
        'top1_accuracy': top1 / observations if observations else 0.0,
        'top3_accuracy': top3 / observations if observations else 0.0,
        'mrr': reciprocal_rank / observations if observations else 0.0,
        'mean_latency_ms': statistics.mean(latencies) if latencies else 0.0,
        'p95_latency_ms': percentile(latencies, 0.95),
        'max_latency_ms': max(latencies, default=0.0),
    }


def main():
    parser = argparse.ArgumentParser(description='Offline Local N-Gram benchmark')
    parser.add_argument(
        '--model',
        default=os.path.join('extension', 'models', 'model.json.gz'),
    )
    parser.add_argument(
        '--test-root',
        action='append',
        default=[],
        help='Held-out repository root; repeat for multiple repositories',
    )
    parser.add_argument('--baseline', help='Optional prior benchmark JSON')
    parser.add_argument('--json-out')
    parser.add_argument('--max-p95-ms', type=float, default=35.0)
    parser.add_argument(
        '--min-confidence',
        type=float,
        default=0.0,
        help='Apply the runtime confidence gate during evaluation',
    )
    args = parser.parse_args()
    roots = args.test_root or [os.path.join('benchmarks', 'fixtures')]

    result = run(load_model(args.model), roots, args.min_confidence)
    result['min_confidence'] = args.min_confidence
    print(json.dumps(result, indent=2))
    if args.json_out:
        with open(args.json_out, 'w', encoding='utf-8') as output:
            json.dump(result, output, indent=2)

    if result['p95_latency_ms'] > args.max_p95_ms:
        raise SystemExit(
            f"p95 latency {result['p95_latency_ms']:.2f} ms exceeds {args.max_p95_ms:.2f} ms"
        )
    if args.baseline:
        with open(args.baseline, 'r', encoding='utf-8') as baseline_file:
            baseline = json.load(baseline_file)
        target = baseline['mrr'] * 1.25
        if result['mrr'] < target:
            raise SystemExit(
                f"MRR {result['mrr']:.4f} did not reach the 25% improvement target {target:.4f}"
            )


if __name__ == '__main__':
    main()
