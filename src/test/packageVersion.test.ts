import * as assert from 'assert';
import {
    applyVersionIncrement,
    ensureDocumentSaved,
    ensureSourceUnchanged,
} from '../features/packageVersion/packageVersionService';

suite('Package Version', () => {
    test('increments major, minor, and patch versions', () => {
        const source = '{"name":"sample","version":"1.2.3"}';
        assert.strictEqual(applyVersionIncrement(source, 'major').newVersion, '2.0.0');
        assert.strictEqual(applyVersionIncrement(source, 'minor').newVersion, '1.3.0');
        assert.strictEqual(applyVersionIncrement(source, 'patch').newVersion, '1.2.4');
    });

    test('removes a v prefix and prerelease suffix before incrementing', () => {
        assert.strictEqual(applyVersionIncrement('{"version":"v1.2.3"}', 'patch').newVersion, '1.2.4');
        assert.strictEqual(applyVersionIncrement('{"version":"1.2.3-alpha.1"}', 'minor').newVersion, '1.3.0');
    });

    test('changes only the root version JSON value', () => {
        const source = [
            '{',
            '  "metadata": { "version": "unchanged", "values": [{"nested": true}] },',
            '  "version" : "1.2.3",',
            '  "escaped": "keep\\tthis"',
            '}',
            '',
        ].join('\r\n');
        const expected = source.replace('"version" : "1.2.3"', '"version" : "1.2.4"');
        assert.strictEqual(applyVersionIncrement(source, 'patch').source, expected);
    });

    test('rejects missing, non-string, and invalid versions', () => {
        assert.throws(() => applyVersionIncrement('{"name":"sample"}', 'patch'), /does not contain a version field/);
        assert.throws(() => applyVersionIncrement('{"version":1}', 'patch'), /expected a non-empty string/);
        assert.throws(() => applyVersionIncrement('{"version":"next"}', 'patch'), /Invalid semantic version/);
        assert.throws(() => applyVersionIncrement('{invalid}', 'patch'), /Unable to parse package.json/);
    });

    test('detects changes made after the initial read', () => {
        const initial = new TextEncoder().encode('{"version":"1.2.3"}');
        assert.doesNotThrow(() => ensureSourceUnchanged(initial, initial.slice()));
        assert.throws(
            () => ensureSourceUnchanged(initial, new TextEncoder().encode('{"version":"1.2.4"}')),
            /changed while selecting a version/,
        );
    });

    test('rejects an open package.json with unsaved changes', () => {
        assert.doesNotThrow(() => ensureDocumentSaved(false));
        assert.throws(() => ensureDocumentSaved(true), /has unsaved changes/);
    });
});
