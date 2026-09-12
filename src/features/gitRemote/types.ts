import * as vscode from 'vscode';

export type OpenTarget = 'repository' | 'branch' | 'directory' | 'file';
export type HostingPlatform = 'github' | 'gitlab' | 'bitbucket' | 'gitee' | 'codeup';

export interface RepositoryInfo {
    root: vscode.Uri;
    originUrl: string;
    currentBranch?: string;
}
