import * as vscode from 'vscode';
import { CommonCommand, deleteCommonCommand, updateCommonCommand } from '../commonCommands/commonCommandStore';
import { deleteGitMessage, formatGitMessage, GitMessage, updateGitMessage } from '../gitMessages/gitMessageStore';
import { TemplateItem } from './templatesFeature';

type Prompt = (options: vscode.InputBoxOptions) => Thenable<string | undefined>;

export async function editCommonCommandItem(
    item: TemplateItem<CommonCommand>,
    prompt: Prompt = vscode.window.showInputBox,
): Promise<void> {
    const value = item.snapshot.entries[item.index]!;
    const command = await prompt({
        title: 'Edit Common Command (1/2)',
        value: value.command,
        validateInput: (text) =>
            !text.trim()
                ? 'Command is required.'
                : item.snapshot.entries.some((entry, index) => index !== item.index && entry.command === text.trim())
                  ? 'This command already exists.'
                  : undefined,
    });
    if (command === undefined) {
        return;
    }
    const description = await prompt({
        title: 'Edit Common Command (2/2)',
        prompt: 'Description (optional; clear to remove)',
        value: value.description ?? '',
    });
    if (description === undefined) {
        return;
    }
    assertSaved(item.file);
    await updateCommonCommand(item.snapshot, item.index, { command, description }, item.file);
}

export async function editGitMessageItem(
    item: TemplateItem<GitMessage>,
    prompt: Prompt = vscode.window.showInputBox,
): Promise<void> {
    const value = item.snapshot.entries[item.index]!;
    const type = await prompt({
        title: 'Edit Git Message (1/3)',
        prompt: 'Type',
        value: value.type,
        validateInput: (text) => (text.trim() ? undefined : 'Type is required.'),
    });
    if (type === undefined) {
        return;
    }
    const scope = await prompt({
        title: 'Edit Git Message (2/3)',
        prompt: 'Scope (optional; clear to remove)',
        value: value.scope ?? '',
    });
    if (scope === undefined) {
        return;
    }
    const subject = await prompt({
        title: 'Edit Git Message (3/3)',
        prompt: 'Subject',
        value: value.subject,
        validateInput: (text) => (text.trim() ? undefined : 'Subject is required.'),
    });
    if (subject === undefined) {
        return;
    }
    assertSaved(item.file);
    await updateGitMessage(item.snapshot, item.index, { type, scope, subject }, item.file);
}

function assertSaved(file: string): void {
    if (vscode.workspace.textDocuments.some((document) => document.uri.fsPath === file && document.isDirty)) {
        throw new Error('Save or discard the JSON file’s unsaved changes, then refresh the view and try again.');
    }
}

export function registerTemplateCommands(context: vscode.ExtensionContext): void {
    for (const kind of ['commonCommand', 'gitMessage'] as const) {
        for (const action of ['edit', 'delete'] as const) {
            const name = `${action}${kind === 'commonCommand' ? 'CommonCommand' : 'GitMessage'}`;
            context.subscriptions.push(
                vscode.commands.registerCommand(`project-atlas.${name}`, async (item: unknown) => {
                    if (!(item instanceof TemplateItem) || item.contextValue !== kind) {
                        return;
                    }
                    try {
                        assertSaved(item.file);
                        if (action === 'edit') {
                            if (kind === 'commonCommand') {
                                await editCommonCommandItem(item as TemplateItem<CommonCommand>);
                            } else {
                                await editGitMessageItem(item as TemplateItem<GitMessage>);
                            }
                        } else {
                            const label =
                                kind === 'commonCommand'
                                    ? (item.snapshot.entries[item.index] as CommonCommand).command
                                    : formatGitMessage(item.snapshot.entries[item.index] as GitMessage);
                            const confirmed = await vscode.window.showWarningMessage(
                                `Delete this record?\n${label}`,
                                { modal: true, detail: 'Only this JSON record will be removed.' },
                                'Delete',
                            );
                            if (confirmed !== 'Delete') {
                                return;
                            }
                            assertSaved(item.file);
                            if (kind === 'commonCommand') {
                                await deleteCommonCommand(item.snapshot, item.index, item.file);
                            } else {
                                await deleteGitMessage(item.snapshot, item.index, item.file);
                            }
                        }
                    } catch (error) {
                        await vscode.window.showErrorMessage(
                            `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    } finally {
                        await vscode.commands.executeCommand(
                            `project-atlas.refresh${kind === 'commonCommand' ? 'CommonCommands' : 'GitMessages'}`,
                        );
                    }
                }),
            );
        }
    }
}
