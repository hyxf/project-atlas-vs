import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AICodeConfig, CONFIG_FILE, ConfigLoadResult, DEFAULT_GROUP, defaultConfig } from './model';

export class ConfigRepository {
    public configUri(folder: vscode.WorkspaceFolder): vscode.Uri {
        return vscode.Uri.joinPath(folder.uri, CONFIG_FILE);
    }

    public async load(folder: vscode.WorkspaceFolder): Promise<ConfigLoadResult> {
        const uri = this.configUri(folder);
        let bytes: Uint8Array;
        try {
            bytes = await vscode.workspace.fs.readFile(uri);
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return { kind: 'missing' };
            }
            return { kind: 'invalid', message: `Cannot read ${uri.fsPath}: ${messageOf(error)}`, cause: error };
        }
        const text = Buffer.from(bytes)
            .toString('utf8')
            .replace(/^\uFEFF/, '');
        const stamp = digest(bytes);
        if (text.trim() === '') {
            return { kind: 'ok', config: defaultConfig(), source: 'empty', stamp };
        }
        try {
            return { kind: 'ok', ...parseConfig(JSON.parse(text) as unknown), stamp };
        } catch (error) {
            return { kind: 'invalid', message: `Invalid ${uri.fsPath}: ${messageOf(error)}`, cause: error };
        }
    }

    public async save(folder: vscode.WorkspaceFolder, config: AICodeConfig, expectedStamp?: string): Promise<string> {
        const uri = this.configUri(folder);
        if (expectedStamp !== undefined) {
            const current = await this.load(folder);
            if (current.kind !== 'ok' || current.stamp !== expectedStamp) {
                throw new Error(`${CONFIG_FILE} changed externally. Refresh and retry.`);
            }
        }
        const normalized = normalizeConfig(config);
        const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
        const temporary = vscode.Uri.joinPath(folder.uri, `.${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`);
        try {
            await vscode.workspace.fs.writeFile(temporary, bytes);
            await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
        } catch (error) {
            try {
                await vscode.workspace.fs.delete(temporary);
            } catch {
                // The temporary file may not have been created.
            }
            throw error;
        }
        return digest(bytes);
    }
}

export function normalizeRelativePath(value: string, allowBackslash = true): string {
    if (value.includes('\0') || /[\u0001-\u001f\u007f]/u.test(value)) {
        throw new Error(`path contains a control character: ${JSON.stringify(value)}`);
    }
    if (!allowBackslash && value.includes('\\')) {
        throw new Error(`path must use / separators: ${value}`);
    }
    let normalized = allowBackslash ? value.replace(/\\/gu, '/') : value;
    normalized = normalized.replace(/\/{2,}/gu, '/');
    const parts = normalized.split('/').filter((part) => part !== '.');
    if (
        normalized === '' ||
        normalized.startsWith('/') ||
        /^[A-Za-z]:/u.test(normalized) ||
        parts.some((part) => part === '..' || part === '') ||
        normalized.endsWith('/')
    ) {
        throw new Error(`invalid relative file path: ${value}`);
    }
    return parts.join('/');
}

function parseConfig(value: unknown): { config: AICodeConfig; source: 'current' | 'legacy' } {
    if (Array.isArray(value)) {
        if (!value.every((entry) => typeof entry === 'string')) {
            throw new Error('legacy array must contain only strings');
        }
        return {
            source: 'legacy',
            config: normalizeConfig({ activeGroup: DEFAULT_GROUP, groups: { [DEFAULT_GROUP]: value } }, false),
        };
    }
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'activeGroup' && key !== 'groups')) {
        throw new Error('root must contain only activeGroup and groups');
    }
    if (typeof value.activeGroup !== 'string' || !isRecord(value.groups) || Object.keys(value.groups).length === 0) {
        throw new Error('activeGroup must be a string and groups must be a non-empty object');
    }
    const groups: Record<string, string[]> = {};
    for (const [name, paths] of Object.entries(value.groups)) {
        validateGroupName(name);
        if (!Array.isArray(paths) || !paths.every((entry) => typeof entry === 'string')) {
            throw new Error(`group ${JSON.stringify(name)} must be an array of strings`);
        }
        groups[name] = paths.map((entry) => normalizeRelativePath(entry, false));
    }
    if (!(value.activeGroup in groups)) {
        throw new Error(`activeGroup ${JSON.stringify(value.activeGroup)} does not exist in groups`);
    }
    return { source: 'current', config: { activeGroup: value.activeGroup, groups } };
}

export function validateGroupName(value: string): string {
    const name = value.trim();
    if (name.length === 0 || Array.from(name).length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) {
        throw new Error('Group name must be 1-100 characters and contain no control characters.');
    }
    return name;
}

function normalizeConfig(config: AICodeConfig, allowBackslash = true): AICodeConfig {
    const groups: Record<string, string[]> = {};
    for (const [name, paths] of Object.entries(config.groups)) {
        validateGroupName(name);
        groups[name] = [...new Set(paths.map((entry) => normalizeRelativePath(entry, allowBackslash)))];
    }
    if (Object.keys(groups).length === 0 || !(config.activeGroup in groups)) {
        throw new Error('activeGroup must reference a non-empty groups object');
    }
    return { activeGroup: config.activeGroup, groups };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digest(bytes: Uint8Array): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
