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
