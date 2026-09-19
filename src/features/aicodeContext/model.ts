import * as vscode from 'vscode';

export const CONFIG_FILE = '.aicode.json';
export const DEFAULT_GROUP = 'Default';

export interface AICodeConfig {
    activeGroup: string;
    groups: Record<string, string[]>;
}

export type ConfigLoadResult =
    | { kind: 'ok'; config: AICodeConfig; source: 'current' | 'legacy' | 'empty'; stamp?: string }
    | { kind: 'missing' }
    | { kind: 'invalid'; message: string; cause?: unknown };

export interface ContextTarget {
    folder: vscode.WorkspaceFolder;
    relativePath: string;
    uri: vscode.Uri;
}

export function defaultConfig(): AICodeConfig {
    return { activeGroup: DEFAULT_GROUP, groups: { [DEFAULT_GROUP]: [] } };
}

export function cloneConfig(config: AICodeConfig): AICodeConfig {
    return {
        activeGroup: config.activeGroup,
        groups: Object.fromEntries(Object.entries(config.groups).map(([name, paths]) => [name, [...paths]])),
    };
}
