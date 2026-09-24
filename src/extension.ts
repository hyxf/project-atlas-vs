import { activateAiPrompts } from './features/aiPrompts/aiPromptsFeature';
import * as vscode from 'vscode';
import {
    addTerminalSelectionToCommonCommand,
    editCommonCommands,
    insertCommonCommand,
    runCommonCommand,
} from './features/commonCommands/commonCommandCommands';
import { createReleaseTagCommand } from './features/gitTagRelease/createReleaseTagCommand';
import { copyGitMessage, editGitMessages, selectGitMessage } from './features/gitMessages/gitMessageCommands';
import { registerGitRemoteCommands } from './features/gitRemote/gitRemoteCommands';
import { activateProjectManagement } from './features/projectManagement/projectManagementFeature';
import { registerChangelogCommands } from './features/changelog/createOrUpdateChangelog';
import { registerPackageVersionCommand } from './features/packageVersion/packageVersionCommand';
import { activateAICodeContext } from './features/aicodeContext/aicodeContextFeature';
import { activateRepositoryManagement } from './features/repositoryManagement/repositoryManagementFeature';
import { activateGitHubRepositories } from './features/githubRepositories/githubRepositoriesFeature';
import { ensureCommonCommandsFile } from './features/commonCommands/commonCommandStore';
import { ensureGitMessagesFile } from './features/gitMessages/gitMessageStore';
import { activateTemplates } from './features/templates/templatesFeature';
import { activateTemplateBackup } from './features/templateBackup/templateBackupFeature';
import { activateUpdateFeature } from './features/update/updateFeature';
import { activateNpmPackages } from './features/npmPackages/npmPackagesFeature';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    await Promise.all([run(() => ensureCommonCommandsFile()), run(() => ensureGitMessagesFile())]);
    activateProjectManagement(context);
    registerChangelogCommands(context);
    registerGitRemoteCommands(context);
    registerPackageVersionCommand(context);
    activateAICodeContext(context);
    activateRepositoryManagement(context);
    activateGitHubRepositories(context);
    activateTemplates(context);
    activateAiPrompts(context);
    activateTemplateBackup(context);
    activateUpdateFeature(context);
    activateNpmPackages(context);
    const handlers: Record<string, (...args: unknown[]) => unknown> = {
        createReleaseTag: createReleaseTagCommand,
        insertCommonCommand,
        runCommonCommand: (item) => runCommonCommand(item),
        editCommonCommands,
        addTerminalSelectionToCommonCommand,
        selectGitMessage,
        copyGitMessage,
        editGitMessages,
    };
    for (const [name, handler] of Object.entries(handlers)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(`project-atlas.${name}`, (...args) => run(() => handler(...args))),
        );
    }
}

async function run(action: () => unknown): Promise<unknown> {
    try {
        return await action();
    } catch (error) {
        await vscode.window.showErrorMessage(
            `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
    }
}

export function deactivate(): void {}
