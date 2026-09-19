import * as assert from 'assert';
import { classifyChangedPaths, parseBranchOptions } from '../features/aicodeContext/branchComparison';

suite('Branch Comparison', () => {
    test('distinguishes refs, excludes current and symbolic refs, and retains the upstream', () => {
        const output = [
            'refs/heads/feature\0feature\0',
            'refs/heads/main\0main\0',
            'refs/remotes/origin/HEAD\0origin\0refs/remotes/origin/main',
            'refs/remotes/origin/feature\0origin/feature\0',
            'refs/remotes/origin/main\0origin/main\0',
        ].join('\n');

        assert.deepStrictEqual(parseBranchOptions(output, 'main'), [
            { ref: 'refs/heads/feature', label: 'feature', type: 'Local' },
            { ref: 'refs/remotes/origin/feature', label: 'origin/feature', type: 'Remote' },
            { ref: 'refs/remotes/origin/main', label: 'origin/main', type: 'Remote' },
        ]);
    });

    test('classifies exact files, directory contents, and untracked files as changed', () => {
        assert.deepStrictEqual(
            [
                ...classifyChangedPaths(
                    ['src', 'README.md', 'new.txt', 'stable.txt'],
                    'src/index.ts\nREADME.md\n',
                    'new.txt\n',
                ),
            ],
            ['src', 'README.md', 'new.txt'],
        );
    });
});
