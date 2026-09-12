import { ChangelogData, Commit } from './changelogData';

export const startMarker = '<!-- aicode-changelog:start -->';
export const endMarker = '<!-- aicode-changelog:end -->';

const categories = ['Added', 'Fixed', 'Changed', 'Removed', 'Other Changes'] as const;
type Category = (typeof categories)[number];

export function buildManagedSection(data: ChangelogData): string {
    const releases = data.releases.map((release) => {
        const date = !release.unreleased && release.date.trim() ? ` - ${release.date.trim()}` : '';
        const groups = new Map<Category, string[]>(categories.map((category) => [category, []]));
        for (const commit of release.commits) {
            const parsed = parseCommit(commit);
            groups.get(parsed.category)!.push(parsed.text);
        }
        const bodies = categories.flatMap((category) => {
            const entries = groups.get(category)!;
            return entries.length ? [`### ${category}`, '', ...entries, ''] : [];
        });
        return [`## [${release.version}]${date}`, '', ...bodies].join('\n').trimEnd();
    });
    return [startMarker, '', ...joinWithBlankLine(releases), '', endMarker].join('\n');
}

export function buildNewChangelog(data: ChangelogData): string {
    return [
        '# Changelog',
        '',
        'All notable changes to this project will be documented in this file.',
        '',
        buildManagedSection(data),
        '',
    ].join('\n');
}

export function replaceManagedSection(original: string, managed: string): string | undefined {
    const starts = indexesOf(original, startMarker);
    const ends = indexesOf(original, endMarker);
    if (!starts.length && !ends.length) {
        return undefined;
    }
    if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) {
        throw new Error(
            'CHANGELOG.md must contain exactly one ordered pair of Project Atlas changelog markers. Fix the markers and generate it again.',
        );
    }
    return original.slice(0, starts[0]) + managed + original.slice(ends[0]! + endMarker.length);
}

function parseCommit(commit: Commit): { category: Category; text: string } {
    const subject = escapeMarkers(commit.subject.trim());
    const match = /^(feat|fix|perf|refactor|revert|docs|test|build|ci|chore)(?:\(([^)]+)\))?!?:\s*(.+)$/i.exec(subject);
    if (!match) {
        return { category: 'Other Changes', text: `- ${subject}` };
    }
    const type = match[1]!.toLowerCase();
    const category: Category =
        type === 'feat'
            ? 'Added'
            : type === 'fix'
              ? 'Fixed'
              : type === 'perf' || type === 'refactor'
                ? 'Changed'
                : type === 'revert'
                  ? 'Removed'
                  : 'Other Changes';
    const description = match[3]!;
    return { category, text: match[2] ? `- **${match[2]}:** ${description}` : `- ${description}` };
}

function escapeMarkers(value: string): string {
    return value
        .replaceAll(startMarker, '&lt;!-- aicode-changelog:start --&gt;')
        .replaceAll(endMarker, '&lt;!-- aicode-changelog:end --&gt;');
}

function indexesOf(value: string, needle: string): number[] {
    const result: number[] = [];
    for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + needle.length)) {
        result.push(index);
    }
    return result;
}

function joinWithBlankLine(parts: string[]): string[] {
    return parts.flatMap((part, index) => (index ? ['', part] : [part]));
}
