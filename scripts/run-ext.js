import { spawn } from 'node:child_process';
import console from 'node:console';
import { access } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const codeCliNames = process.platform === 'win32' ? ['code.cmd', 'code'] : ['code'];
const macCodeCliPaths = [
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    join(process.env.HOME ?? '', 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'),
];

const findCodeCli = async () => {
    if (process.env.VSCODE_CLI) {
        return process.env.VSCODE_CLI;
    }

    const pathEntries = (process.env.PATH ?? '').split(delimiter);
    const candidates = [
        ...pathEntries.flatMap((pathEntry) => codeCliNames.map((name) => join(pathEntry, name))),
        ...(process.platform === 'darwin' ? macCodeCliPaths : []),
    ];

    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try the next known VS Code CLI location.
        }
    }

    throw new Error(
        'Could not find the VS Code command-line launcher. Add `code` to PATH or set VSCODE_CLI to its full path.',
    );
};

const run = (command, args, options = {}) =>
    new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd: root,
            stdio: 'inherit',
            ...options,
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolvePromise();
            } else {
                reject(new Error(`${command} exited with ${signal ?? code}`));
            }
        });
    });

try {
    await run('pnpm', ['run', 'compile']);
    const codeCli = await findCodeCli();
    await run(codeCli, [
        '--new-window',
        '--disable-extensions',
        `--extensionDevelopmentPath=${root}`,
    ]);
} catch (error) {
    console.error(
        `[Project-Atlas-VS] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
}
