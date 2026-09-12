import * as path from 'path';
import * as vscode from 'vscode';
import { AICodeConfig } from './model';

const languages: Record<string, string> = {
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    xml: 'xml',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    properties: 'properties',
    gradle: 'gradle',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    scala: 'scala',
    groovy: 'groovy',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    html: 'html',
    css: 'css',
    scss: 'scss',
    md: 'markdown',
    txt: 'text',
};

export async function buildMarkdown(folder: vscode.WorkspaceFolder, config: AICodeConfig): Promise<string> {
    const entries = config.groups[config.activeGroup] ?? [];
    const blocks: string[] = [
        `> Workspace: ${folder.name}  `,
        `> Context Group: ${config.activeGroup}  `,
        `> File Count: ${entries.length}  `,
        '',
        '---',
    ];
    for (const relativePath of entries) {
        blocks.push('', `## 📄 ${safeTitle(relativePath)}`, '');
        try {
            const bytes = await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(folder.uri, ...relativePath.split('/')),
            );
            if (bytes.subarray(0, 8192).includes(0)) {
                blocks.push('⚠️ **Binary File — content omitted**', '', '---');
                continue;
            }
            const content = Buffer.from(bytes).toString('utf8').replace(/\r\n?/gu, '\n');
            const fence = chooseFence(content);
            const extension = path.posix.extname(relativePath).slice(1).toLowerCase();
            blocks.push(
                `${fence}${languages[extension] ?? ''}`,
                content.endsWith('\n') ? content.slice(0, -1) : content,
                fence,
                '',
                '---',
            );
        } catch (error) {
            const missing = error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
            blocks.push(missing ? '⚠️ **Missing File**' : '⚠️ **Unable to read file**', '', '---');
        }
    }
    return `${blocks.join('\n')}\n`;
}

function chooseFence(content: string): string {
    const ticks = Math.max(3, ...[...content.matchAll(/`+/gu)].map((match) => (match[0]?.length ?? 0) + 1));
    const tildes = Math.max(3, ...[...content.matchAll(/~+/gu)].map((match) => (match[0]?.length ?? 0) + 1));
    return ticks <= tildes ? '`'.repeat(ticks) : '~'.repeat(tildes);
}

function safeTitle(value: string): string {
    return value.replace(/[\r\n]/gu, ' ');
}
