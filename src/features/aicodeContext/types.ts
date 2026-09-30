import type * as vscode from 'vscode';

/** Source format from which an AICode configuration was successfully loaded. */
export type ConfigSource = 'current' | 'legacy' | 'empty';

/** Context groups and the active group persisted in a workspace `.aicode.json`. */
export interface AICodeConfig {
    activeGroup: string;
    groups: Record<string, string[]>;
}

/** Result returned when a configuration has been successfully parsed. */
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

/** Exhaustive result of attempting to load a workspace configuration. */
export type ConfigLoadResult = ConfigLoaded | ConfigMissing | ConfigInvalid;

/** A workspace-relative file path paired with its owning workspace folder. */
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
