import * as vscode from 'vscode';
import {
    CommonCommand,
    commonCommandsFile,
    deleteCommonCommand,
    readCommonCommandSnapshot,
    updateCommonCommand,
} from '../commonCommands/commonCommandStore';
import {
    deleteGitMessage,
    formatGitMessage,
    GitMessage,
    gitMessagesFile,
    readGitMessageSnapshot,
    updateGitMessage,
} from '../gitMessages/gitMessageStore';
import { TemplateItem } from './templatesFeature';
import { disposeTemplateForms, showTemplateForm, TemplateForm } from './templateForm';

export async function editCommonCommandItem(
    item: TemplateItem<CommonCommand>,
    form: TemplateForm = showTemplateForm,
    creating = false,
): Promise<void> {
    const value = creating ? { command: '', description: '' } : item.snapshot.entries[item.index]!;
    await form({
        title: creating ? 'Add Common Command' : 'Edit Common Command',
        description: 'Keep a command ready to reuse from your workspace.',
        fields: [
            {
                name: 'command',
                label: 'Command',
                value: value.command,
                required: true,
                multiline: true,
                monospace: true,
                placeholder: 'git status',
                hint: 'Enter a command or a multi-line script.',
            },
            {
                name: 'description',
                label: 'Description',
                value: value.description ?? '',
                multiline: true,
                placeholder: 'Show the working tree status',
                hint: 'A short note to help you find this command later.',
            },
        ],
        save: async (values) => {
            assertSaved(item.file);
            await updateCommonCommand(
                item.snapshot,
                creating ? null : item.index,
                { command: values.command!, description: values.description! },
                item.file,
            );
        },
    });
}

export async function editGitMessageItem(
    item: TemplateItem<GitMessage>,
    form: TemplateForm = showTemplateForm,
    creating = false,
): Promise<void> {
    const value = creating ? { type: '', scope: '', subject: '' } : item.snapshot.entries[item.index]!;
    const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
    if (value.type && !types.includes(value.type)) {
        types.push(value.type);
    }
    await form({
        title: creating ? 'Add Git Message' : 'Edit Git Message',
        description: 'Create a reusable commit message for Source Control.',
        fields: [
            {
                name: 'type',
                label: 'Type',
                value: value.type,
                required: true,
                options: types,
                halfWidth: true,
                hint: 'Choose the kind of change.',
            },
            {
                name: 'scope',
                label: 'Scope',
                value: value.scope ?? '',
                halfWidth: true,
                placeholder: 'e.g. ui, api, auth',
                hint: 'The area affected by this change.',
            },
            {
                name: 'subject',
                label: 'Subject',
                value: value.subject,
                required: true,
                multiline: true,
                placeholder: 'Describe the change',
                hint: 'Write the message without the type or scope prefix.',
            },
        ],
        save: async (values) => {
            assertSaved(item.file);
            await updateGitMessage(
                item.snapshot,
                creating ? null : item.index,
                { type: values.type!, scope: values.scope!, subject: values.subject! },
                item.file,
            );
        },
    });
}

export async function addCommonCommandItem(
    file = commonCommandsFile,
    form: TemplateForm = showTemplateForm,
): Promise<void> {
    assertSaved(file);
    const snapshot = await readCommonCommandSnapshot(file);
    await editCommonCommandItem(new TemplateItem('', snapshot, 0, file, 'commonCommand'), form, true);
}

export async function addGitMessageItem(file = gitMessagesFile, form: TemplateForm = showTemplateForm): Promise<void> {
    assertSaved(file);
    const snapshot = await readGitMessageSnapshot(file);
    await editGitMessageItem(new TemplateItem('', snapshot, 0, file, 'gitMessage'), form, true);
}

function assertSaved(file: string): void {
    if (vscode.workspace.textDocuments.some((document) => document.uri.fsPath === file && document.isDirty)) {
        throw new Error('Save or discard the JSON file’s unsaved changes, then refresh the view and try again.');
    }
}

export function registerTemplateCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push({ dispose: disposeTemplateForms });
    for (const [name, add, refresh] of [
        ['addCommonCommand', addCommonCommandItem, 'refreshCommonCommands'],
        ['addGitMessage', addGitMessageItem, 'refreshGitMessages'],
    ] as const) {
        context.subscriptions.push(
            vscode.commands.registerCommand(`project-atlas.${name}`, async () => {
                try {
                    await add();
                } catch (error) {
                    await vscode.window.showErrorMessage(
                        `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
                    );
                } finally {
                    await vscode.commands.executeCommand(`project-atlas.${refresh}`);
                }
            }),
        );
    }
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
