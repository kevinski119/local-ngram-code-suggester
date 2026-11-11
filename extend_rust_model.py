"""Rebuild only the Rust portion of a format-v3 model; retain all other languages.

Usage: python extend_rust_model.py extension/models/model.json.gz
Rust observations come exclusively from the original MIT starter templates.
Running repeatedly replaces Rust counts instead of inflating them.
"""
import argparse
from code_model_trainer import CodeNGramModel
from ngram_tokenizer import TOKENIZER_PROFILE_VERSION
from starter_corpus import iter_starter_samples


def extend(filepath):
    model = CodeNGramModel()
    model.load(filepath)
    if model.format_version != 3:
        raise ValueError('Rust extension requires a format-v3 base model')
    model.total_patterns -= sum(
        sum(counts.values()) for contexts in model.orders.pop('.rs', {}).values()
        for counts in contexts.values()
    )
    for index in (model.vocab, model.token_frequencies, model.member_access):
        index.pop('.rs', None)
    for extension, sample in iter_starter_samples():
        if extension == '.rs':
            model.train_on_text(sample, extension)
    model.tokenizer_profile_version = TOKENIZER_PROFILE_VERSION
    model.corpus['rust'] = {'source': 'starter_corpus.py:_rust_sample', 'license': 'MIT'}
    model.save(filepath, compress=filepath.endswith('.gz'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model')
    extend(parser.parse_args().model)
