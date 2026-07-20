# -*- coding: utf-8 -*-
import glob
import os
import json
import gzip
import hashlib
from collections import defaultdict, Counter
import argparse

from ngram_tokenizer import (
    TOKENIZER_PROFILE_VERSION,
    get_language_profile,
    scan_text,
)

LANGUAGE_EXTENSIONS = {
    'cs': ('.cs', '.cshtml'),
    'js': ('.js', '.jsx', '.vue'),
    'ts': ('.ts', '.tsx'),
    'py': ('.py',),
    'java': ('.java',),
    'json': ('.json', '.jsonc'),
}
IGNORED_DIRECTORIES = {
    '.git', '.hg', '.svn', '.venv', 'venv', 'node_modules',
    'dist', 'build', 'out', '__pycache__', 'benchmarks',
    'test', 'tests', 'fixtures',
}
IGNORED_FILENAMES = {
    'package-lock.json', 'starter_corpus.py',
}


def checksum_canonical_value(value):
    """Normalize JSON numbers to the representation used by JSON.stringify."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [checksum_canonical_value(item) for item in value]
    if isinstance(value, dict):
        return {
            key: checksum_canonical_value(child)
            for key, child in value.items()
        }
    return value


def ngram_size(value):
    parsed = int(value)
    if parsed < 2 or parsed > 6:
        raise argparse.ArgumentTypeError('maximum n-gram order must be between 2 and 6')
    return parsed


def positive_float(value):
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError('alpha must be greater than 0')
    return parsed


def is_ignored_path(filepath):
    normalized = os.path.normpath(filepath)
    return (
        os.path.basename(normalized) in IGNORED_FILENAMES
        or any(part in IGNORED_DIRECTORIES for part in normalized.split(os.sep))
    )


def compressed_model_path(filepath):
    return filepath if filepath.lower().endswith('.gz') else f'{filepath}.gz'


class CodeNGramModel:
    def __init__(self, n=4, smoothing='laplace', alpha=1.0):
        self.n = n
        self.min_order = 2
        self.max_order = n
        self.orders = defaultdict(
            lambda: defaultdict(lambda: defaultdict(Counter))
        )
        self.file_extensions = set()
        self.total_patterns = 0
        self.version = "3.0"
        self.format_version = 3
        self.tokenizer_profile_version = TOKENIZER_PROFILE_VERSION
        self.smoothing = smoothing
        self.alpha = alpha
        self.vocab = defaultdict(set)
        self.token_frequencies = defaultdict(Counter)
        self.normalized_contexts = True
        self.corpus = {
            'sources': ['user-provided'],
            'license': 'user-responsibility',
        }
    
    def train_on_file(self, filepath):
        """Trains the model on a single file, taking into account the extension"""
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            ext = os.path.splitext(filepath)[1].lower()
            token_count = self.train_on_text(content, ext)
            print(f"Processed {filepath}: {token_count} tokens, 1 sequences")
        except Exception as e:
            print(f"Error processing {filepath}: {e}")

    def train_on_text(self, content, extension):
        """Train on an in-memory source sample and return its token count."""
        ext = extension.lower()
        self.file_extensions.add(ext)
        tokens = scan_text(content, ext)['tokens']
        self.vocab[ext].update(token.value for token in tokens)
        self.token_frequencies[ext].update(token.value for token in tokens)
        for order in range(self.min_order, self.max_order + 1):
            if len(tokens) < order:
                continue
            for index in range(len(tokens) - order + 1):
                context = tuple(
                    token.normalized
                    for token in tokens[index:index + order - 1]
                )
                next_token = tokens[index + order - 1].value
                self.orders[ext][order][context][next_token] += 1
                self.total_patterns += 1
        return len(tokens)

    def to_serializable(self):
        """Converts the model to a serializable format"""
        serializable_orders = {}
        string_table = set()
        for ext, orders in sorted(self.orders.items()):
            serializable_orders[ext] = {}
            for order, contexts in sorted(orders.items()):
                serializable_orders[ext][str(order)] = {}
                for context, counter in sorted(contexts.items()):
                    string_table.update(context)
                    string_table.update(counter.keys())
                    context_key = json.dumps(list(context))
                    serializable_orders[ext][str(order)][context_key] = dict(
                        sorted(counter.items())
                    )
        
        serializable_vocab = {}
        serializable_token_frequencies = {}
        for ext, tokens in sorted(self.vocab.items()):
            serializable_vocab[ext] = sorted(tokens)
            serializable_token_frequencies[ext] = dict(
                sorted(self.token_frequencies[ext].items())
            )
        
        return {
            'format_version': self.format_version,
            'version': self.version,
            'n': self.n,
            'min_order': self.min_order,
            'max_order': self.max_order,
            'orders': serializable_orders,
            'string_table': sorted(string_table),
            'language_ids': {
                ext: get_language_profile(ext)['languageIds']
                for ext in sorted(self.file_extensions)
            },
            'normalized_contexts': self.normalized_contexts,
            'tokenizer_profile_version': self.tokenizer_profile_version,
            'vocab': serializable_vocab,
            'token_frequencies': serializable_token_frequencies,
            'file_extensions': sorted(self.file_extensions),
            'total_patterns': self.total_patterns,
            'smoothing': self.smoothing,
            'alpha': self.alpha,
            'corpus': self.corpus,
        }
    
    def save(self, filepath, compress=True):
        """Saves the model to a JSON file"""
        data = self.to_serializable()
        checksum_payload = json.dumps(
            checksum_canonical_value(data),
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':'),
        ).encode('utf-8')
        data['checksum_sha256'] = hashlib.sha256(checksum_payload).hexdigest()
        output_path = compressed_model_path(filepath) if compress else filepath
        output_directory = os.path.dirname(os.path.abspath(output_path))
        os.makedirs(output_directory, exist_ok=True)

        if compress:
            with gzip.open(output_path, 'wt', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        else:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"Model saved to {output_path} with {self.total_patterns} patterns across {len(self.file_extensions)} languages")
        print(f"Smoothing method: {self.smoothing}, Alpha: {self.alpha}")
        return output_path
    
    def load(self, filepath):
        """Loads the model from the JSON file"""
        if filepath.endswith('.gz'):
            with gzip.open(filepath, 'rt', encoding='utf-8') as f:
                data = json.load(f)
        else:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
        
        self.version = data['version']
        self.format_version = data.get('format_version', 2)
        self.n = data['n']
        self.min_order = data.get('min_order', self.n)
        self.max_order = data.get('max_order', self.n)
        self.normalized_contexts = data.get('normalized_contexts', False)
        self.tokenizer_profile_version = data.get(
            'tokenizer_profile_version',
            'legacy',
        )
        self.file_extensions = set(data['file_extensions'])
        self.total_patterns = data['total_patterns']
        self.smoothing = data.get('smoothing', 'none')
        self.alpha = data.get('alpha', 1.0)
        
        self.orders = defaultdict(
            lambda: defaultdict(lambda: defaultdict(Counter))
        )
        if self.format_version >= 3:
            for ext, orders in data['orders'].items():
                for order, contexts in orders.items():
                    for context_key, tokens in contexts.items():
                        context = tuple(json.loads(context_key))
                        self.orders[ext][int(order)][context] = Counter(tokens)
        else:
            for ext, contexts in data['ngrams'].items():
                for context_key, tokens in contexts.items():
                    context = tuple(json.loads(context_key))
                    self.orders[ext][self.n][context] = Counter(tokens)
        
        self.vocab = defaultdict(set)
        for ext, tokens in data.get('vocab', {}).items():
            self.vocab[ext] = set(tokens)
        self.token_frequencies = defaultdict(Counter)
        for ext, counts in data.get('token_frequencies', {}).items():
            self.token_frequencies[ext] = Counter(counts)

        self.corpus = data.get('corpus', self.corpus)
        
        print(f"Model loaded from {filepath} with {self.total_patterns} patterns for {len(self.file_extensions)} languages")
        print(f"Smoothing method: {self.smoothing}, Alpha: {self.alpha}")

def main():
    parser = argparse.ArgumentParser(description='Train code suggestion model with language support and smoothing')
    parser.add_argument('--model', '-m', required=True, help='Model file path')
    parser.add_argument('--pattern', '-p', help='Glob pattern for code files')
    parser.add_argument(
        '--language',
        '-l',
        choices=['cs', 'js', 'ts', 'py', 'java', 'json', 'all'],
        help='Language to train on',
    )
    parser.add_argument('--n-gram', '-n', type=ngram_size, default=6, help='Maximum n-gram order, 2-6 (default: 6)')
    parser.add_argument('--smoothing', '-s', choices=['none', 'laplace'],
                       default='laplace', help='Smoothing method (default: laplace)')
    parser.add_argument('--alpha', '-a', type=positive_float, default=1.0, help='Alpha parameter for Laplace smoothing (default: 1.0)')
    parser.add_argument('--no-compress', action='store_true', help='Save without compression')
    parser.add_argument('--fresh', action='store_true', help='Do not merge with an existing model')
    parser.add_argument(
        '--include-starter-corpus',
        action='store_true',
        help='Add the original MIT-licensed curated cold-start corpus',
    )
    parser.add_argument(
        '--corpus-source',
        action='append',
        default=[],
        help='Repository URL/revision used for training; repeat as needed',
    )
    parser.add_argument(
        '--corpus-license',
        default='user-responsibility',
        help='SPDX license expression or provenance note for the corpus',
    )
    
    args = parser.parse_args()
    
    patterns = []
    if args.language:
        languages = LANGUAGE_EXTENSIONS if args.language == 'all' else {
            args.language: LANGUAGE_EXTENSIONS[args.language]
        }
        for extensions in languages.values():
            patterns.extend(f'**/*{extension}' for extension in extensions)
    
    if args.pattern:
        patterns.append(args.pattern)
    
    if not patterns:
        parser.error('please specify either --pattern or --language')
    
    model = CodeNGramModel(n=args.n_gram, smoothing=args.smoothing, alpha=args.alpha)
    model.corpus = {
        'sources': args.corpus_source or ['user-provided'],
        'license': args.corpus_license,
    }
    
    model_path = args.model if args.no_compress else compressed_model_path(args.model)
    
    if not args.fresh and os.path.exists(model_path):
        try:
            model.load(model_path)
            if model.format_version < 3:
                raise ValueError('legacy v2 models cannot be merged into normalized model v3')
        except Exception as e:
            print(f"Error loading model, creating new: {e}")
            model = CodeNGramModel(
                n=args.n_gram,
                smoothing=args.smoothing,
                alpha=args.alpha,
            )
            model.corpus = {
                'sources': args.corpus_source or ['user-provided'],
                'license': args.corpus_license,
            }
    
    all_files = []
    for pattern in patterns:
        files = glob.glob(pattern, recursive=True)
        filtered_files = [
            f for f in files
            if os.path.isfile(f) and not is_ignored_path(f)
        ]
        all_files.extend(filtered_files)
        print(f"Found {len(filtered_files)} files for pattern: {pattern}")

    all_files = sorted(set(all_files))
    if not all_files:
        parser.error('no source files matched the requested language or pattern')

    for i, filepath in enumerate(all_files):
        print(f"Processing {i+1}/{len(all_files)}: {filepath}")
        model.train_on_file(filepath)

    if args.include_starter_corpus:
        from starter_corpus import iter_starter_samples

        sample_count = 0
        token_count = 0
        for extension, content in iter_starter_samples():
            token_count += model.train_on_text(content, extension)
            sample_count += 1
        print(
            f"Processed curated starter corpus: "
            f"{sample_count} samples, {token_count} tokens"
        )
    
    model.save(args.model, compress=not args.no_compress)
    
    print("\nTraining completed! Statistics by language:")
    for ext in sorted(model.file_extensions):
        patterns_count = sum(
            len(contexts)
            for contexts in model.orders[ext].values()
        )
        vocab_size = len(model.vocab[ext])
        print(f"  {ext}: {patterns_count} patterns, {vocab_size} unique tokens")

if __name__ == "__main__":
    main()
