import * as vscode from 'vscode';
import type { GitHubRepository } from './types';

type ShowInputBox = (options: vscode.InputBoxOptions) => Thenable<string | undefined>;

export async function confirmGitHubRepositoryDeletion(
    repository: GitHubRepository,
    showInputBox: ShowInputBox,
): Promise<boolean> {
    const typedName = await showInputBox({
        title: 'Confirm GitHub Repository Deletion',
        prompt: `This permanently deletes the GitHub repository and its hosted data. Type ${repository.fullName} to confirm.`,
        placeHolder: repository.fullName,
        ignoreFocusOut: true,
        validateInput: (value) =>
            value === repository.fullName ? undefined : `Enter the exact name: ${repository.fullName}`,
    });
    return typedName === repository.fullName;
}
