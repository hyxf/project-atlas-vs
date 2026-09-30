import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import type { ProjectItem } from './types';

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

export async function findXcodeProject(projectPath: string): Promise<string | undefined> {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const findEntry = (matcher: RegExp) =>
        entries
            .filter((entry) => matcher.test(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name))[0];
    const workspace = findEntry(/\.xcworkspace$/i);
    const xcodeProject = findEntry(/\.xcodeproj$/i);
    const swiftPackage = entries.find((entry) => entry.name === 'Package.swift');
    const projectEntry = workspace ?? xcodeProject ?? swiftPackage;
    return projectEntry ? path.join(projectPath, projectEntry.name) : undefined;
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
    const xcodeProject = await findXcodeProject(project.path);
    if (!xcodeProject) {
        throw new Error('No .xcworkspace, .xcodeproj, or Package.swift file was found in this project directory.');
    }
    await executeFile('open', ['-a', application, xcodeProject]);
    await markOpened(project);
}
