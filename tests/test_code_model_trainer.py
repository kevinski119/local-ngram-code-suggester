import gzip
import json
import os
import tempfile
import unittest

from code_model_trainer import (
    CodeNGramModel,
    compressed_model_path,
    is_ignored_path,
)
from ngram_tokenizer import scan_text


class CodeModelTrainerTests(unittest.TestCase):
    def test_golden_tokenizer_fixtures(self):
        fixture_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'extension',
            'src',
            'test',
            'fixtures',
            'tokenizer_cases.json',
        )
        with open(fixture_path, 'r', encoding='utf-8') as fixture_file:
            cases = json.load(fixture_file)

        for case in cases:
            with self.subTest(case=case['name']):
                result = scan_text(case['text'], case['language'])
                self.assertEqual(
                    [token.value for token in result['tokens']],
                    case['tokens'],
                )
                self.assertEqual(
                    [token.normalized for token in result['tokens']],
                    case['normalized'],
                )

    def test_cursor_in_comment(self):
        code = 'const value = 1; // unfinished comment'
        self.assertTrue(scan_text(code, 'typescript')['cursor_in_comment'])
        string = 'const value = "// not a comment";'
        self.assertFalse(scan_text(string, 'typescript')['cursor_in_comment'])

    def test_comments_do_not_change_model_observations(self):
        commented = 'const value = 1; /* explanation */ return value; // done'
        clean = 'const value = 1; return value;'
        self.assertEqual(
            [token.value for token in scan_text(commented, 'typescript')['tokens']],
            [token.value for token in scan_text(clean, 'typescript')['tokens']],
        )

    def test_compressed_path_is_not_duplicated(self):
        self.assertEqual(compressed_model_path('model.json'), 'model.json.gz')
        self.assertEqual(compressed_model_path('model.json.gz'), 'model.json.gz')

    def test_ignored_dependency_directories(self):
        self.assertTrue(is_ignored_path(os.path.join('project', 'node_modules', 'file.js')))
        self.assertFalse(is_ignored_path(os.path.join('project', 'src', 'file.js')))

    def test_train_and_save_compressed_model(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = os.path.join(directory, 'sample.py')
            with open(source_path, 'w', encoding='utf-8') as source:
                source.write('def greet(name):\n    return "hello"\n')

            model = CodeNGramModel(n=3, smoothing='laplace', alpha=0.5)
            model.train_on_file(source_path)
            output_path = model.save(os.path.join(directory, 'model.json.gz'))

            self.assertEqual(output_path, os.path.join(directory, 'model.json.gz'))
            self.assertGreater(model.total_patterns, 0)
            with gzip.open(output_path, 'rt', encoding='utf-8') as model_file:
                data = json.load(model_file)

            self.assertEqual(data['n'], 3)
            self.assertEqual(data['format_version'], 3)
            self.assertEqual(data['min_order'], 2)
            self.assertEqual(data['max_order'], 3)
            self.assertEqual(data['file_extensions'], ['.py'])
            self.assertIn('.py', data['orders'])
            self.assertIn('python', data['language_ids']['.py'])
            self.assertIn('<ID>', data['string_table'])
            self.assertRegex(data['checksum_sha256'], r'^[a-f0-9]{64}$')


if __name__ == '__main__':
    unittest.main()
