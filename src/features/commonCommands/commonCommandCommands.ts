import * as vscode from 'vscode';
import { TemplateItem } from '../templates/templatesFeature';
import {
    addCommonCommand,
    CommonCommand,
    commonCommandsFile,
    ensureCommonCommandsFile,
    readCommonCommands,
} from './commonCommandStore';

export async function insertCommonCommand(item?: unknown): Promise<void> {
    const command =
        item instanceof TemplateItem && item.contextValue === 'commonCommand'
            ? (item as TemplateItem<CommonCommand>).snapshot.entries[item.index]?.command
            : await pickCommonCommand();
    if (!command) {
        return;
    }

    const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal({ name: 'Project Atlas' });
    terminal.show();
    terminal.sendText(command, false);
}

export async function runCommonCommand(item: unknown): Promise<void> {
    if (!(item instanceof TemplateItem) || item.contextValue !== 'commonCommand') {
        return;
    }
    const command = (item as TemplateItem<CommonCommand>).snapshot.entries[item.index]?.command;
    if (!command) {
        throw new Error('This command no longer exists. Refresh the view and try again.');
    }

    const workspaceFolder = vscode.window.activeTextEditor
        ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
        : vscode.workspace.workspaceFolders?.[0];
    const execution = new vscode.ShellExecution(
        command,
        workspaceFolder ? { cwd: workspaceFolder.uri.fsPath } : undefined,
    );
    const task = new vscode.Task(
        { type: 'project-atlas-common-command', command },
        vscode.TaskScope.Workspace,
        command,
        'Project Atlas',
        execution,
    );
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Shared,
        clear: true,
        focus: false,
        showReuseMessage: false,
    };
    await vscode.tasks.executeTask(task);
}

async function pickCommonCommand(): Promise<string | undefined> {
    const commands = await readCommonCommands();
    if (!commands.length) {
        await vscode.window.showInformationMessage('Project Atlas: No common commands configured.');
        return;
    }
    const picked = await vscode.window.showQuickPick(
        commands.map((item) => ({
            label: item.command,
            command: item.command,
            ...(item.description ? { detail: item.description } : {}),
        })),
        {
            title: 'Insert Common Command',
            placeHolder: 'Choose a command to insert into the terminal',
            matchOnDetail: true,
        },
    );
    return picked?.command;
}

export async function editCommonCommands(): Promise<void> {
    await ensureCommonCommandsFile();
    await vscode.window.showTextDocument(vscode.Uri.file(commonCommandsFile));
}

export async function addTerminalSelectionToCommonCommand(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
    const selection = await vscode.env.clipboard.readText();
    if (!selection.trim()) {
        throw new Error('Select terminal text before adding a common command.');
    }

    const description = await vscode.window.showInputBox({
        title: 'Add Terminal Selection to Common Command',
        prompt: 'Description (optional)',
    });
    if (description === undefined) {
        return;
    }
    await ensureCommonCommandsFile();
    await addCommonCommand(selection, description);
    await vscode.window.showInformationMessage('Project Atlas: Common command added.');
}
