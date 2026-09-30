import type * as vscode from 'vscode';

export type ConfigSource = 'current' | 'legacy' | 'empty';

export interface AICodeConfig {
    activeGroup: string;
    groups: Record<string, string[]>;
}

export interface ConfigLoaded {
    kind: 'ok';
    config: AICodeConfig;
    source: ConfigSource;
    stamp?: string;
}

export interface ConfigMissing {
    kind: 'missing';
}

export interface ConfigInvalid {
    kind: 'invalid';
    message: string;
    cause?: unknown;
}

export type ConfigLoadResult = ConfigLoaded | ConfigMissing | ConfigInvalid;

export interface ContextTarget {
    folder: vscode.WorkspaceFolder;
    relativePath: string;
    uri: vscode.Uri;
}

export interface ConfigParseResult {
    config: AICodeConfig;
    source: Extract<ConfigSource, 'current' | 'legacy'>;
}

export interface FileActivationState {
    uri: string;
    time: number;
}

export interface CompareEntry {
    path: string;
    changed: boolean;
}

export interface CompareResult {
    folder: vscode.WorkspaceFolder;
    current: string;
    compare: string;
    entries: CompareEntry[];
}

export interface RenamedUri {
    oldUri: vscode.Uri;
    newUri: vscode.Uri;
}
