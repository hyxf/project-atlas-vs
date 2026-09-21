import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { AvailableUpdate } from './model';
import { downloadAndInstallUpdate } from './updateInstaller';
import { downloadUpdate, UpdateService } from './updateService';

const LAST_CHECK_AT = 'projectAtlas.update.lastCheckAt';
const IGNORED_VERSION = 'projectAtlas.update.ignoredVersion';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const STARTUP_DELAY_MS = 15_000;

export function activateUpdateFeature(context: vscode.ExtensionContext): void {
    const service = new UpdateService();
    let checking = false;
    const check = async (manual: boolean): Promise<void> => {
        if (checking) {
            return;
        }
        checking = true;
        try {
            const currentVersion = String(context.extension.packageJSON.version);
            const result = manual
                ? await vscode.window.withProgress(
                      { location: vscode.ProgressLocation.Notification, title: 'Project Atlas: Checking for updates…' },
                      () => service.check(currentVersion, vscode.version),
                  )
                : await service.check(currentVersion, vscode.version);
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
    const choice = await vscode.window.showInformationMessage(message, options, ...updateActions(mandatory));
    if (choice === 'Upgrade Now') {
        await installUpdate(update);
    } else if (choice === 'View Release Notes') {
        await vscode.env.openExternal(vscode.Uri.parse(manifest.releaseNotes));
    } else if (choice === 'Ignore This Version') {
        await context.globalState.update(IGNORED_VERSION, manifest.latestVersion);
    }
}

export function updateActions(mandatory: boolean): readonly string[] {
    return mandatory
        ? ['Upgrade Now', 'View Release Notes']
        : ['Upgrade Now', 'View Release Notes', 'Later', 'Ignore This Version'];
}

async function installUpdate(update: AvailableUpdate): Promise<void> {
    const { manifest } = update;
    const temporaryFile = path.join(os.tmpdir(), `project-atlas-${manifest.latestVersion}-${randomUUID()}.vsix`);
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Project Atlas: Downloading ${manifest.download.fileName}…`,
                cancellable: false,
            },
            async (progress) => {
                let lastProgress = 0;
                await downloadAndInstallUpdate(
                    manifest,
                    temporaryFile,
                    downloadUpdate,
                    async (file) => {
                        await vscode.commands.executeCommand('workbench.extensions.command.installFromVSIX', [
                            vscode.Uri.file(file),
                        ]);
                    },
                    (downloadedBytes, totalBytes) => {
                        const percentage = totalBytes === undefined ? undefined : (downloadedBytes / totalBytes) * 100;
                        progress.report({
                            message:
                                percentage === undefined ? formatBytes(downloadedBytes) : `${Math.round(percentage)}%`,
                            ...(percentage === undefined ? {} : { increment: percentage - lastProgress }),
                        });
                        if (percentage !== undefined) {
                            lastProgress = percentage;
                        }
                    },
                );
            },
        );
    } catch (error) {
        await vscode.window.showErrorMessage(
            `Project Atlas: Unable to install the update: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function wasCheckedRecently(context: vscode.ExtensionContext): boolean {
    const lastCheckAt = context.globalState.get<number>(LAST_CHECK_AT, 0);
    return Date.now() - lastCheckAt < CHECK_INTERVAL_MS;
}
