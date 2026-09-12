import * as path from 'path';
import * as vscode from 'vscode';
import { ensureGitMessagesFile, formatGitMessage, gitMessagesFile, readGitMessages } from './gitMessageStore';

interface GitRepository {
    rootUri: vscode.Uri;
    inputBox: { value: string };
}

interface GitApi {
    repositories: GitRepository[];
    getRepository(uri: vscode.Uri): GitRepository | null;
}

export async function editGitMessages(): Promise<void> {
    await ensureGitMessagesFile();
    await vscode.window.showTextDocument(vscode.Uri.file(gitMessagesFile));
}

export async function selectGitMessage(sourceControl?: unknown): Promise<void> {
    const messages = await readGitMessages();
    if (!messages.length) {
        await vscode.window.showInformationMessage('Project Atlas: No Git messages configured.');
        return;
    }
    const picked = await vscode.window.showQuickPick(
        messages.map((message) => ({ label: formatGitMessage(message), message })),
        { title: 'Select Git Message', placeHolder: 'Choose a message for the Source Control input' },
    );
    if (!picked) {
        return;
    }
    const repository = await resolveRepository(sourceControl);
    if (!repository) {
        throw new Error('No Git repository is available.');
    }
    repository.inputBox.value = formatGitMessage(picked.message);
}

async function resolveRepository(sourceControl?: unknown): Promise<GitRepository | undefined> {
    if (hasInputBox(sourceControl)) {
        return sourceControl;
    }
    const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
    if (!extension) {
        return undefined;
    }
    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports.getAPI(1);
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeRepository = activeUri && api.getRepository(activeUri);
    if (activeRepository) {
        return activeRepository;
    }
    if (api.repositories.length === 1) {
        return api.repositories[0];
    }
    const picked = await vscode.window.showQuickPick(
        api.repositories.map((repository) => ({
            label: path.basename(repository.rootUri.fsPath),
            description: repository.rootUri.fsPath,
            repository,
        })),
        { title: 'Select Git Repository', matchOnDescription: true },
    );
    return picked?.repository;
}

function hasInputBox(value: unknown): value is GitRepository {
    if (!value || typeof value !== 'object' || !('inputBox' in value)) {
        return false;
    }
    const inputBox = (value as { inputBox?: unknown }).inputBox;
    return Boolean(inputBox && typeof inputBox === 'object' && 'value' in inputBox);
}
