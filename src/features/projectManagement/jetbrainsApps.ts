import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import type { ProjectItem } from './types';

export type JetBrainsIde = 'pycharm' | 'idea';

const applicationMatchers: Record<JetBrainsIde, RegExp> = {
    pycharm: /^pycharm(?: .*)?\.app$/i,
    idea: /^intellij idea(?: .*)?\.app$/i,
};
const executeFile = promisify(execFile);

export function macOSApplicationsDirectories(): string[] {
    if (process.platform !== 'darwin') {
        return [];
    }
    return ['/Applications', path.join(os.homedir(), 'Applications')];
}

export async function findJetBrainsApp(
    ide: JetBrainsIde,
    applicationDirectories = macOSApplicationsDirectories(),
): Promise<string | undefined> {
    for (const directory of applicationDirectories) {
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        const application = entries.find((entry) => applicationMatchers[ide].test(entry.name));
        if (application) {
            return path.join(directory, application.name);
        }
    }
    return undefined;
}

export async function syncJetBrainsMenuContext(): Promise<void> {
    const [pycharm, idea] = await Promise.all([findJetBrainsApp('pycharm'), findJetBrainsApp('idea')]);
    await Promise.all([
        vscode.commands.executeCommand('setContext', 'projectAtlas.pycharmAvailable', pycharm !== undefined),
        vscode.commands.executeCommand('setContext', 'projectAtlas.ideaAvailable', idea !== undefined),
    ]);
}

export async function openJetBrainsProject(
    project: ProjectItem | undefined,
    ide: JetBrainsIde,
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
    const application = await findJetBrainsApp(ide);
    if (!application) {
        throw new Error(`${ide === 'pycharm' ? 'PyCharm' : 'IntelliJ IDEA'} is not installed.`);
    }
    await executeFile('open', ['-a', application, project.path]);
    await markOpened(project);
}
