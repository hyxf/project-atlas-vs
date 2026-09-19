import * as vscode from 'vscode';
import { Commit, Release, SemVer } from './changelogData';
import { GitCommandError, runGit } from '../gitTagRelease/gitTagService';

interface Tag extends SemVer {
    readonly name: string;
    readonly date: string;
    readonly order: number;
}

export class NonLinearReleaseHistoryError extends Error {}

export class GitChangelogService {
    async read(root: string, token: vscode.CancellationToken): Promise<{ readonly releases: readonly Release[] }> {
        const tagResult = await runGit(
            root,
            ['tag', '--merged', 'HEAD', '--format=%(refname:short)%09%(creatordate:short)'],
            token,
        );
        if (tagResult.code !== 0) {
            throw new GitCommandError([], tagResult);
        }
        const tags = parseTags(tagResult.stdout).sort(compareTags);
        for (let index = 1; index < tags.length; index++) {
            const previous = tags[index - 1]!;
            const current = tags[index]!;
            const result = await runGit(root, ['merge-base', '--is-ancestor', previous.name, current.name], token);
            if (result.code === 1) {
                throw new NonLinearReleaseHistoryError(
                    `Cannot generate an accurate changelog because ${previous.name} is not an ancestor of ${current.name}. The semantic-version tags do not form a linear release history.`,
                );
            }
            if (result.code !== 0) {
                throw new GitCommandError([], result);
            }
        }
        const descending = [...tags].reverse();
        const releases: Release[] = [];
        releases.push({
            version: 'Unreleased',
            date: '',
            commits: await this.commits(root, tags.length ? `${tags.at(-1)!.name}..HEAD` : 'HEAD', token),
            unreleased: true,
        });
        for (let index = 0; index < descending.length; index++) {
            const tag = descending[index]!;
            const previous = tags[tags.indexOf(tag) - 1];
            releases.push({
                version: tag.name.slice(1),
                date: tag.date,
                commits: await this.commits(root, previous ? `${previous.name}..${tag.name}` : tag.name, token),
                unreleased: false,
            });
        }
        return { releases };
    }

    private async commits(root: string, revision: string, token: vscode.CancellationToken): Promise<Commit[]> {
        const result = await runGit(root, ['log', '--no-merges', '--pretty=format:%H%x09%s', revision], token);
        if (result.code !== 0) {
            throw new GitCommandError([], result);
        }
        return splitLines(result.stdout).flatMap((line) => {
            const tab = line.indexOf('\t');
            if (tab <= 0 || tab === line.length - 1) {
                return [];
            }
            return [{ hash: line.slice(0, tab), subject: line.slice(tab + 1).trim() }];
        });
    }
}

export function parseTags(output: string): Tag[] {
    return splitLines(output).flatMap((line, order) => {
        const tab = line.indexOf('\t');
        const name = tab < 0 ? line : line.slice(0, tab);
        const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(name);
        if (!match) {
            return [];
        }
        return [
            {
                name,
                date: tab < 0 ? '' : line.slice(tab + 1).trim(),
                major: BigInt(match[1]!),
                minor: BigInt(match[2]!),
                patch: BigInt(match[3]!),
                order,
            },
        ];
    });
}

function compareTags(left: Tag, right: Tag): number {
    for (const key of ['major', 'minor', 'patch'] as const) {
        if (left[key] < right[key]) {
            return -1;
        }
        if (left[key] > right[key]) {
            return 1;
        }
    }
    return left.order - right.order;
}

function splitLines(value: string): string[] {
    return value.split(/\r?\n/).filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}
