import * as vscode from 'vscode';
import { AvailableUpdate } from './model';
import { UpdateService } from './updateService';

const LAST_CHECK_AT = 'projectAtlas.update.lastCheckAt';
const IGNORED_VERSION = 'projectAtlas.update.ignoredVersion';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const STARTUP_DELAY_MS = 15_000;

export function activateUpdateFeature(context: vscode.ExtensionContext): void {
    const service = new UpdateService();
    let checking = false;
    const check = async (manual: boolean): Promise<void> => {
        if (checking) {
            if (manual) {
                await vscode.window.showInformationMessage('Project Atlas: An update check is already in progress.');
            }
            return;
        }
        checking = true;
        try {
            const currentVersion = String(context.extension.packageJSON.version);
            const result = manual
                ? await vscode.window.withProgress(
                      { location: vscode.ProgressLocation.Notification, title: 'Project Atlas: Checking for updates…' },
                      () => service.check(currentVersion),
                  )
                : await service.check(currentVersion);
            await context.globalState.update(LAST_CHECK_AT, Date.now());
            if (result.kind === 'upToDate') {
                if (manual) {
                    await vscode.window.showInformationMessage(
                        `Project Atlas is up to date (${result.currentVersion}).`,
                    );
                }
                return;
            }
            if (!manual && context.globalState.get<string>(IGNORED_VERSION) === result.update.manifest.latestVersion) {
                return;
            }
            await showUpdate(context, result.update);
        } catch (error) {
            if (manual) {
                await vscode.window.showErrorMessage(
                    `Project Atlas: Unable to check for updates: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        } finally {
            checking = false;
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand('project-atlas.checkForUpdates', () => check(true)));
    if (
        vscode.workspace.getConfiguration('projectAtlas.update').get<boolean>('enabled', true) &&
        vscode.workspace.getConfiguration('projectAtlas.update').get<boolean>('autoCheck', true) &&
        !wasCheckedRecently(context)
    ) {
        const timer = setTimeout(() => void check(false), STARTUP_DELAY_MS);
        context.subscriptions.push({ dispose: () => clearTimeout(timer) });
    }
}

async function showUpdate(context: vscode.ExtensionContext, update: AvailableUpdate): Promise<void> {
    const { manifest, currentVersion, mandatory } = update;
    const message = `Project Atlas ${manifest.latestVersion} is available (current: ${currentVersion}).`;
    const options: vscode.MessageOptions = mandatory
        ? { modal: true, detail: 'Your installed version is no longer supported.' }
        : { modal: false };
    const choice = await vscode.window.showInformationMessage(
        message,
        options,
        'Upgrade Now',
        'View Release Notes',
        'Later',
        'Ignore This Version',
    );
    if (choice === 'Upgrade Now') {
        await vscode.env.openExternal(vscode.Uri.parse(manifest.download.url));
        await vscode.window.showInformationMessage(
            'After downloading, run “Extensions: Install from VSIX...” to install Project Atlas.',
        );
    } else if (choice === 'View Release Notes') {
        await vscode.env.openExternal(vscode.Uri.parse(manifest.releaseNotes));
    } else if (choice === 'Ignore This Version') {
        await context.globalState.update(IGNORED_VERSION, manifest.latestVersion);
    }
}

function wasCheckedRecently(context: vscode.ExtensionContext): boolean {
    const lastCheckAt = context.globalState.get<number>(LAST_CHECK_AT, 0);
    return Date.now() - lastCheckAt < CHECK_INTERVAL_MS;
}
