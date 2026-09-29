import * as path from 'path';
import * as vscode from 'vscode';
import { CommonCommand, CommonCommandVariable } from './commonCommandStore';

const variableReference = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export async function resolveCommonCommand(
    command: CommonCommand,
    globalVariables: readonly CommonCommandVariable[],
    shell = vscode.env.shell,
): Promise<string | undefined> {
    const variables = new Map<string, CommonCommandVariable>();
    for (const variable of globalVariables) {
        variables.set(variable.name, variable);
    }
    for (const variable of command.variables ?? []) {
        if (variables.has(variable.name)) {
            throw new Error(`Command variable ${variable.name} conflicts with a global variable.`);
        }
        variables.set(variable.name, variable);
    }

    const names = [...command.command.matchAll(variableReference)]
        .map((match) => match[1]!)
        .filter((name) => variables.has(name));
    const values = new Map<string, string[]>();
    for (const name of [...new Set(names)]) {
        const value = await promptForVariable(variables.get(name)!);
        if (value === undefined) {
            return undefined;
        }
        values.set(name, value);
    }
    return command.command.replace(variableReference, (match, name: string) => {
        const value = values.get(name);
        return value ? value.map((entry) => quoteForShell(entry, shell)).join(' ') : match;
    });
}

async function promptForVariable(variable: CommonCommandVariable): Promise<string[] | undefined> {
    const title = variable.label ?? variable.name;
    const required = variable.required !== false;
    if (variable.type === 'text') {
        const value = await vscode.window.showInputBox({
            title: `Common Command: ${title}`,
            value: (variable.default as string | undefined) ?? '',
            prompt: required ? 'Required' : 'Optional',
            validateInput: (input) => (required && !input ? 'A value is required.' : undefined),
        });
        return value === undefined ? undefined : value || required ? [value] : [];
    }
    if (variable.type === 'path') {
        const defaultValue = typeof variable.default === 'string' ? variable.default : '';
        if (defaultValue || !required) {
            const picked = await vscode.window.showQuickPick(
                [
                    ...(defaultValue ? [{ label: `Use default: ${defaultValue}`, value: defaultValue }] : []),
                    { label: 'Choose a path…', value: undefined },
                    ...(!required ? [{ label: 'No value', value: '' }] : []),
                ],
                { title: `Common Command: ${title}` },
            );
            if (!picked) {
                return undefined;
            }
            if (picked.value !== undefined) {
                return picked.value ? [picked.value] : [];
            }
        }
        const defaultUri =
            typeof variable.default === 'string' && variable.default ? vscode.Uri.file(variable.default) : undefined;
        const selected = await vscode.window.showOpenDialog({
            title: `Common Command: ${title}`,
            canSelectFiles: variable.pathKind !== 'folder',
            canSelectFolders: variable.pathKind !== 'file',
            canSelectMany: false,
            ...(defaultUri ? { defaultUri } : {}),
        });
        return selected?.length ? [selected[0]!.fsPath] : undefined;
    }
    const options = variable.options ?? [];
    if (variable.type === 'select') {
        const defaultValue = (variable.default as string | undefined) ?? '';
        const picked = await vscode.window.showQuickPick(
            [
                ...(!required ? [{ label: 'No value', value: '', picked: defaultValue === '' }] : []),
                ...options.map((value) => ({ label: value, value, picked: value === defaultValue })),
            ],
            {
                title: `Common Command: ${title}`,
                placeHolder: required ? 'Select a value' : 'Select a value (optional)',
            },
        );
        return picked === undefined ? undefined : picked.value ? [picked.value] : [];
    }
    const defaults = new Set((variable.default as string[] | undefined) ?? []);
    const picked = await vscode.window.showQuickPick(
        options.map((label) => ({ label, picked: defaults.has(label) })),
        {
            title: `Common Command: ${title}`,
            placeHolder: required ? 'Select one or more values' : 'Select values (optional)',
            canPickMany: true,
        },
    );
    if (picked === undefined || (required && !picked.length)) {
        return undefined;
    }
    return picked.map((item) => item.label);
}

export function quoteForShell(value: string, shell: string): string {
    if (/\0|\r|\n/.test(value)) {
        throw new Error('Variable values cannot contain line breaks or NUL characters.');
    }
    const executable = path.basename(shell).toLowerCase();
    if (executable.includes('powershell') || executable === 'pwsh') {
        return `'${value.replace(/'/g, "''")}'`;
    }
    if (executable === 'cmd.exe' || executable === 'cmd') {
        return `"${value.replace(/["^&|<>()%!]/g, '^$&')}"`;
    }
    return `'${value.replace(/'/g, "'\\''")}'`;
}
