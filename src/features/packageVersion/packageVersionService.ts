import * as semver from 'semver';

export type VersionIncrement = 'major' | 'minor' | 'patch';

export interface VersionUpdate {
    oldVersion: string;
    newVersion: string;
    source: string;
}

interface PackageJson {
    version?: unknown;
}

interface TextRange {
    start: number;
    end: number;
}

/** Calculates the next stable version and changes only the root version value in the JSON text. */
export function applyVersionIncrement(source: string, increment: VersionIncrement): VersionUpdate {
    const packageJson = parsePackageJson(source);
    const oldVersion = getVersion(packageJson);
    const currentVersion = parseBaseVersion(oldVersion);
    const newVersion = semver.inc(currentVersion, increment);
    if (!newVersion) {
        throw new Error(`Unable to calculate the next ${increment} version.`);
    }

    const valueRange = findRootPropertyValue(source, 'version');
    if (!valueRange) {
        throw new Error('package.json does not contain a version field.');
    }
    return {
        oldVersion,
        newVersion,
        source: `${source.slice(0, valueRange.start)}${JSON.stringify(newVersion)}${source.slice(valueRange.end)}`,
    };
}

/** Throws when package.json changed after it was initially read. */
export function ensureSourceUnchanged(initialSource: Uint8Array, currentSource: Uint8Array): void {
    if (
        initialSource.byteLength !== currentSource.byteLength ||
        initialSource.some((byte, index) => byte !== currentSource[index])
    ) {
        throw new Error('package.json changed while selecting a version. Review the changes and try again.');
    }
}

/** Throws when the open package.json editor contains changes that are not on disk yet. */
export function ensureDocumentSaved(isDirty: boolean): void {
    if (isDirty) {
        throw new Error('package.json has unsaved changes. Save the file and try again.');
    }
}

function parsePackageJson(source: string): PackageJson {
    try {
        const value: unknown = JSON.parse(source);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('the root value must be an object');
        }
        return value as PackageJson;
    } catch (error) {
        throw new Error(`Unable to parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function getVersion(packageJson: PackageJson): string {
    if (packageJson.version === undefined) {
        throw new Error('package.json does not contain a version field.');
    }
    if (typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
        throw new Error('package.json contains an invalid version field; expected a non-empty string.');
    }
    return packageJson.version;
}

function parseBaseVersion(version: string): semver.SemVer {
    const parsedVersion = semver.parse(version.trim().replace(/^v/i, ''));
    if (!parsedVersion) {
        throw new Error(`Invalid semantic version: ${version}`);
    }
    return new semver.SemVer(`${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`);
}

function findRootPropertyValue(source: string, propertyName: string): TextRange | undefined {
    let index = skipWhitespace(source, 0);
    if (source[index] !== '{') {
        return undefined;
    }
    index = skipWhitespace(source, index + 1);
    let match: TextRange | undefined;
    while (source[index] !== '}') {
        const keyRange = readString(source, index);
        const key = JSON.parse(source.slice(keyRange.start, keyRange.end)) as string;
        index = skipWhitespace(source, keyRange.end);
        if (source[index] !== ':') {
            return undefined;
        }
        const valueStart = skipWhitespace(source, index + 1);
        const valueEnd = skipValue(source, valueStart);
        if (key === propertyName) {
            match = { start: valueStart, end: valueEnd };
        }
        index = skipWhitespace(source, valueEnd);
        if (source[index] === ',') {
            index = skipWhitespace(source, index + 1);
        } else if (source[index] !== '}') {
            return undefined;
        }
    }
    return match;
}

function skipWhitespace(source: string, start: number): number {
    let index = start;
    while (/\s/.test(source[index] ?? '')) {
        index += 1;
    }
    return index;
}

function readString(source: string, start: number): TextRange {
    let index = start + 1;
    while (index < source.length) {
        if (source[index] === '\\') {
            index += 2;
        } else if (source[index] === '"') {
            return { start, end: index + 1 };
        } else {
            index += 1;
        }
    }
    return { start, end: source.length };
}

function skipValue(source: string, start: number): number {
    if (source[start] === '"') {
        return readString(source, start).end;
    }
    if (source[start] !== '{' && source[start] !== '[') {
        let index = start;
        while (index < source.length && source[index] !== ',' && source[index] !== '}') {
            index += 1;
        }
        return index;
    }

    const closings = [source[start] === '{' ? '}' : ']'];
    let index = start + 1;
    while (closings.length > 0 && index < source.length) {
        if (source[index] === '"') {
            index = readString(source, index).end;
        } else {
            if (source[index] === '{') {
                closings.push('}');
            } else if (source[index] === '[') {
                closings.push(']');
            } else if (source[index] === closings[closings.length - 1]) {
                closings.pop();
            }
            index += 1;
        }
    }
    return index;
}
