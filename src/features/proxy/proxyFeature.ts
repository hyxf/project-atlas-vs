import { promises as fs } from 'fs';
import * as net from 'net';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { HttpsProxyAgent } from 'https-proxy-agent';

export const globalProxyFile = path.join(os.homedir(), '.project-atlas', 'proxy.json');

interface StoredProxyConfiguration extends Record<string, unknown> {
    proxy?: unknown;
    proxies?: unknown;
}

export interface ProxyOption {
    name: string;
    url: string;
}

export class ProxyConfigurationStore {
    public constructor(readonly file = globalProxyFile) {}

    public async proxies(): Promise<ProxyOption[]> {
        const source = await this.read();
        if (source.proxies !== undefined) {
            if (!Array.isArray(source.proxies)) {
                throw new Error(`The "proxies" value in ${this.file} must be an array.`);
            }
            return source.proxies.map((value) =>
                typeof value === 'string' ? legacyProxyOption(value, this.file) : parseProxyOption(value, this.file),
            );
        }
        if (source.proxy === undefined) {
            return [];
        }
        if (typeof source.proxy !== 'string') {
            throw new Error(`The "proxy" value in ${this.file} must be a string.`);
        }
        return [legacyProxyOption(source.proxy, this.file)];
    }

    public async ensureFile(): Promise<void> {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs
            .writeFile(
                this.file,
                '{\n  "proxies": [\n    { "name": "Local", "url": "http://127.0.0.1:1087" }\n  ]\n}\n',
                { encoding: 'utf8', flag: 'wx', mode: 0o600 },
            )
            .catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'EEXIST') {
                    throw error;
                }
            });
    }

    private async read(): Promise<StoredProxyConfiguration> {
        try {
            const source = JSON.parse(await fs.readFile(this.file, 'utf8')) as unknown;
            if (source === null || typeof source !== 'object' || Array.isArray(source)) {
                throw new Error('the root value must be an object');
            }
            return source as StoredProxyConfiguration;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return {};
            }
            throw new Error(`Could not parse ${this.file}; fix the JSON before changing the proxy.`, { cause: error });
        }
    }
}

export function normalizeProxyUrl(value: string, source = 'the proxy setting'): string {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch (error) {
        throw new Error(`Set ${source} to a valid HTTP or HTTPS proxy URL.`, { cause: error });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Set ${source} to an HTTP or HTTPS proxy URL.`);
    }
    const normalized = url.toString();
    return url.pathname === '/' && !url.search && !url.hash ? normalized.slice(0, -1) : normalized;
}

function parseProxyOption(value: unknown, source: string): ProxyOption {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof (value as Record<string, unknown>).name !== 'string' ||
        typeof (value as Record<string, unknown>).url !== 'string'
    ) {
        throw new Error(`Each proxy in ${source} must contain string "name" and "url" values.`);
    }
    const option = value as { name: string; url: string };
    const name = option.name.trim();
    if (!name) {
        throw new Error(`Each proxy name in ${source} must not be empty.`);
    }
    return { name, url: normalizeProxyUrl(option.url, source) };
}

function legacyProxyOption(value: string, source: string): ProxyOption {
    const url = normalizeProxyUrl(value, source);
    return { name: url, url };
}

export function activateProxyStatusBar(context: vscode.ExtensionContext): void {
    const store = new ProxyConfigurationStore();
    const toggle = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -100);
    const refresh = () => {
        const proxy = currentProxy();
        toggle.text = proxy === undefined ? '$(circle-slash) Direct' : '$(plug) Proxy';
        toggle.tooltip =
            proxy === undefined ? 'Use the configured global VS Code proxy' : `Using global VS Code proxy: ${proxy}`;
    };

    toggle.command = 'project-atlas.toggleGlobalProxy';
    refresh();
    toggle.show();

    context.subscriptions.push(
        toggle,
        vscode.commands.registerCommand('project-atlas.toggleGlobalProxy', async () => {
            const existing = currentProxy();
            await store.ensureFile();
            const proxies = await store.proxies();
            const choices: ProxyChoice[] = [
                {
                    label: 'Direct',
                    description:
                        existing === undefined
                            ? 'Do not use a VS Code HTTP proxy · $(check)'
                            : 'Do not use a VS Code HTTP proxy',
                    target: undefined,
                },
                ...(existing === undefined || proxies.some(({ url }) => url === existing)
                    ? []
                    : [
                          {
                              label: 'system',
                              description: `${existing} · $(check)`,
                              target: existing,
                          },
                      ]),
                ...proxies.map(({ name, url }) => ({
                    label: name,
                    description: url === existing ? `${url} · $(check)` : url,
                    target: url,
                })),
                {
                    kind: vscode.QuickPickItemKind.Separator,
                    label: 'Configuration',
                    target: undefined,
                },
                {
                    label: '$(gear) Edit Proxy Configuration File',
                    description: path.basename(store.file),
                    target: null,
                },
            ];
            const selected = await vscode.window.showQuickPick(choices, {
                placeHolder: 'Select a global VS Code proxy mode',
            });
            if (selected?.target === null) {
                await vscode.commands.executeCommand('project-atlas.configureGlobalProxy');
            } else if (selected !== undefined) {
                await setGlobalProxy(selected.target);
            }
        }),
        vscode.commands.registerCommand('project-atlas.configureGlobalProxy', async () => {
            await store.ensureFile();
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(store.file));
            await vscode.window.showTextDocument(document);
        }),
        vscode.commands.registerCommand('project-atlas.checkGlobalProxy', async () => {
            const proxy = currentProxy();
            if (proxy === undefined) {
                await vscode.window.showWarningMessage(
                    'VS Code is using Direct mode; no proxy is configured to check.',
                );
                return;
            }
            try {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Checking VS Code proxy' },
                    async () => {
                        await verifyProxyEndpoint(proxy);
                        await verifyGoogleAccess(proxy);
                    },
                );
                await vscode.window.showInformationMessage(`VS Code proxy is available: ${proxy}`);
            } catch (error) {
                await vscode.window.showErrorMessage(
                    `VS Code proxy is unavailable: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('http.proxy')) {
                refresh();
            }
        }),
    );

    async function setGlobalProxy(target: string | undefined): Promise<void> {
        await vscode.workspace.getConfiguration('http').update('proxy', target, vscode.ConfigurationTarget.Global);
        const actual = currentProxy();
        if (actual !== target) {
            throw new Error('VS Code did not apply the global proxy setting. The status bar was not changed.');
        }
        refresh();
    }
}

interface ProxyChoice extends vscode.QuickPickItem {
    target: string | undefined | null;
}

function currentProxy(): string | undefined {
    const value = vscode.workspace.getConfiguration('http').get<unknown>('proxy');
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function verifyProxyEndpoint(proxy: string): Promise<void> {
    const url = new URL(proxy);
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: url.hostname, port });
        const fail = (error: Error) => {
            socket.destroy();
            reject(error);
        };
        socket.once('connect', () => {
            socket.end();
            resolve();
        });
        socket.once('error', fail);
        socket.setTimeout(5_000, () => fail(new Error('Connection timed out.')));
    });
}

function verifyGoogleAccess(proxy: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = https.get(
            'https://www.google.com/generate_204',
            { agent: new HttpsProxyAgent(proxy) },
            (response) => {
                response.resume();
                const status = response.statusCode ?? 0;
                if (status >= 200 && status < 400) {
                    resolve();
                } else {
                    reject(new Error(`Google returned HTTP ${status}.`));
                }
            },
        );
        request.once('error', reject);
        request.setTimeout(5_000, () => request.destroy(new Error('Google request timed out.')));
    });
}
