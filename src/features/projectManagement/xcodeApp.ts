import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { ProjectItem } from './model';

const executeFile = promisify(execFile);

export function macOSApplicationsDirectories(): string[] {
    if (process.platform !== 'darwin') {
        return [];
    }
    return ['/Applications', path.join(os.homedir(), 'Applications')];
}

export async function findXcodeApp(
    applicationDirectories = macOSApplicationsDirectories(),
): Promise<string | undefined> {
    for (const directory of applicationDirectories) {
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        const application = entries.find((entry) => /^xcode\.app$/i.test(entry.name));
        if (application) {
            return path.join(directory, application.name);
        }
    }
    return undefined;
}

export async function syncXcodeMenuContext(): Promise<void> {
    await vscode.commands.executeCommand(
        'setContext',
        'projectAtlas.xcodeAvailable',
        (await findXcodeApp()) !== undefined,
    );
}

export async function openXcodeProject(
    project: ProjectItem | undefined,
    markOpened: (project: ProjectItem) => Promise<void>,
): Promise<void> {
    if (!project) {
        return;
    }
    const exists = await fs.stat(project.path).then(
        (stat) => stat.isDirectory(),
        () => false,
    );
    if (!exists) {
        throw new Error(`Project directory is missing: ${project.path}`);
    }
    const application = await findXcodeApp();
    if (!application) {
        throw new Error('Xcode is not installed.');
    }
    await executeFile('open', ['-a', application, project.path]);
    await markOpened(project);
}
