import { SemVer, VersionCandidates } from './types';

const versionPattern = /^v(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(value: string): SemVer | undefined {
    const match = versionPattern.exec(value);
    return match ? { major: BigInt(match[1]!), minor: BigInt(match[2]!), patch: BigInt(match[3]!) } : undefined;
}

export function formatVersion(version: SemVer): string {
    return `v${version.major}.${version.minor}.${version.patch}`;
}

export function compareVersions(left: SemVer, right: SemVer): number {
    for (const key of ['major', 'minor', 'patch'] as const) {
        if (left[key] < right[key]) {
            return -1;
        }
        if (left[key] > right[key]) {
            return 1;
        }
    }
    return 0;
}

export function calculateCandidates(tags: Iterable<string>): VersionCandidates {
    let current: SemVer = { major: 0n, minor: 0n, patch: 0n };
    for (const tag of tags) {
        const parsed = parseVersion(tag);
        if (parsed && compareVersions(parsed, current) > 0) {
            current = parsed;
        }
    }
    return {
        current,
        major: { major: current.major + 1n, minor: 0n, patch: 0n },
        minor: { major: current.major, minor: current.minor + 1n, patch: 0n },
        patch: { major: current.major, minor: current.minor, patch: current.patch + 1n },
    };
}

export function parseRemoteTags(output: string): string[] {
    const tags = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
        const match = /^[0-9a-fA-F]+\s+refs\/tags\/(.+)$/.exec(line.trim());
        if (match && !match[1]!.endsWith('^{}')) {
            tags.add(match[1]!);
        }
    }
    return [...tags];
}
