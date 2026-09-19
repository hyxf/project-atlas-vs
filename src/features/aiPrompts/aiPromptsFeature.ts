import { pickRepositoryTags } from '../repositoryManagement/tagPicker';
import * as path from 'path';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { AiPrompt, aiPromptsFile, changeAiPrompt, ensureAiPromptsFile, readAiPromptSnapshot } from './aiPromptStore';
import { TemplateSnapshot } from '../templates/templateStore';
import { expandTreeView, TemplateItem, TemplateDragAndDropController } from '../templates/templatesFeature';
import { assertSaved } from '../templates/templateCommands';
import { showTemplateForm, TemplateForm } from '../templates/templateForm';

export class PromptTagGroup extends vscode.TreeItem {
    readonly children: TemplateItem<AiPrompt>[] = [];
    constructor(
        readonly tag: string,
        collapsed = false,
    ) {
        super(
            tag || 'Untagged',
            collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
        );
        this.id = JSON.stringify(['aiPromptTagGroup', tag]);
        this.contextValue = 'aiPromptTagGroup';
        this.iconPath = new vscode.ThemeIcon('tag');
    }
}

export function buildPromptItems(
    snapshot: TemplateSnapshot<AiPrompt>,
    mode: 'LIST' | 'GROUP',
    file = aiPromptsFile,
    collapsed: string[] = [],
): vscode.TreeItem[] {
    const items: TemplateItem<AiPrompt>[] = [];
    const groups = new Map<string, PromptTagGroup>();
    for (const [index, prompt] of snapshot.entries.entries()) {
        const tags = [...new Set(prompt.tags ?? [])];
        const createItem = (tag?: string) => {
            const item = new TemplateItem(prompt.title, snapshot, index, file, 'aiPrompt');
            item.id = tag === undefined ? prompt.id : JSON.stringify(['aiPrompt', tag, prompt.id]);
            item.description = prompt.description ?? '';
            item.tooltip = [
                prompt.title,
                tags.join(', ') || 'Untagged',
                prompt.description,
                prompt.content.slice(0, 600),
            ]
                .filter(Boolean)
                .join('\n\n');
            item.iconPath = new vscode.ThemeIcon('note');
            item.command = { command: 'project-atlas.previewAiPrompt', title: 'Preview AI Prompt', arguments: [item] };
            return item;
        };
        items.push(createItem());
        for (const tag of tags.length ? tags : ['']) {
            let group = groups.get(tag);
            if (!group) {
                group = new PromptTagGroup(tag, collapsed.includes(tag));
                groups.set(tag, group);
            }
            group.children.push(createItem(tag));
            group.description = String(group.children.length);
        }
    }
    if (mode === 'LIST') {
        return items;
    }
    const untagged = groups.get('');
    groups.delete('');
    return [...groups.values(), ...(untagged ? [untagged] : [])];
}

export async function editAiPrompt(
    snapshot: TemplateSnapshot<AiPrompt>,
    id?: string,
    tags: string[] = [],
    file = aiPromptsFile,
    form: TemplateForm = showTemplateForm,
): Promise<void> {
    const value = id
        ? snapshot.entries.find((entry) => entry.id === id)
        : { title: '', description: '', content: '', tags };
    if (!value) {
        throw new Error('This prompt no longer exists.');
    }
    await form({
        title: id ? 'Edit AI Prompt' : 'Add AI Prompt',
        confirmDiscard: true,
        description: 'Keep a local prompt ready to copy and reuse.',
        fields: [
            { name: 'title', label: 'Title', value: value.title, required: true },
            { name: 'description', label: 'Description', value: value.description ?? '' },
            {
                name: 'tags',
                label: 'Tags',
                value: (value.tags ?? []).join('\n'),
                multiline: true,
                placeholder: 'Development\nCode Review',
                hint: 'One tag per line. Leave empty for no tags.',
            },
            {
                name: 'content',
                label: 'Prompt',
                value: value.content,
                required: true,
                multiline: true,
                monospace: true,
                rows: 12,
                hint: 'Plain text or Markdown. Indentation and line breaks are preserved.',
            },
        ],
        save: async (values) => {
            assertSaved(file);
            await changeAiPrompt(
                snapshot,
                {
                    type: 'save',
                    id,
                    value: {
                        title: values.title!,
                        description: values.description,
                        tags: values.tags!.split(/\r\n|[\r\n]/),
                        content: values.content!,
                    },
                },
                file,
            );
        },
    });
}

export async function editAiPromptTags(
    snapshot: TemplateSnapshot<AiPrompt>,
    id: string,
    file = aiPromptsFile,
    picker: typeof pickRepositoryTags = pickRepositoryTags,
): Promise<void> {
    assertSaved(file);
    const prompt = snapshot.entries.find((entry) => entry.id === id);
    if (!prompt) {
        throw new Error('This prompt no longer exists.');
    }
    const tags = await picker(
        snapshot.entries.flatMap((entry) => entry.tags ?? []),
        prompt.tags ?? [],
        `Edit Tags: ${prompt.title}`,
    );
    if (tags === undefined) {
        return;
    }
    assertSaved(file);
    await changeAiPrompt(snapshot, { type: 'tags', id, tags }, file);
}

export function matchesPrompt(prompt: AiPrompt, query: string): boolean {
    const text = [prompt.title, prompt.description, ...(prompt.tags ?? []), prompt.content]
        .join('\n')
        .toLocaleLowerCase();
    return query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .every((word) => text.includes(word));
}

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
}

export function renderPromptPreview(prompt: AiPrompt): string {
    const nonce = randomBytes(16).toString('hex');
    const tags = (prompt.tags ?? []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
    const lines = prompt.content.split(/\r\n|[\r\n]/).length;
    const copyIcon =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
    const editIcon =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-5-5L4 14z"/></svg>';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>${escapeHtml(prompt.title)}</title>
<style nonce="${nonce}">
* { box-sizing: border-box; }
body { margin: 0; padding: 36px 28px 48px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family, sans-serif); font-size: var(--vscode-font-size, 13px); line-height: 1.6; }
main { max-width: 920px; margin: 0 auto; }
.eyebrow { margin: 0 0 14px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; letter-spacing: 1.4px; text-transform: uppercase; }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.heading-text { min-width: 0; flex: 1; }
h1 { margin: 0; font-size: 28px; line-height: 1.3; font-weight: 600; letter-spacing: -.4px; overflow-wrap: anywhere; }
.description { margin: 12px 0 0; color: var(--vscode-descriptionForeground); font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.tag { padding: 3px 10px; border-radius: 5px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; max-width: 100%; }
.untagged { font-size: 12px; color: var(--vscode-descriptionForeground); }
.actions { display: flex; flex-shrink: 0; gap: 8px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 13px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 5px; font: inherit; font-size: 12px; font-weight: 500; line-height: 1.5; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 3px; }
button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.prompt-card { margin-top: 28px; border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder, #808080)); border-radius: 8px; overflow: hidden; }
.card-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 13px 20px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder, #808080)); }
.card-header h2 { margin: 0; font-size: 12px; font-weight: 600; }
.metadata { color: var(--vscode-descriptionForeground); font-size: 11px; }
pre { margin: 0; padding: 24px; color: var(--vscode-editor-foreground, var(--vscode-foreground)); background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 13px); line-height: 1.85; tab-size: 4; white-space: pre-wrap; overflow-wrap: anywhere; }
.footer { margin: 12px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px; }
#status { margin: 16px 0 0; padding: 9px 12px; border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder, transparent); }
#status:empty { display: none; }
@media (max-width: 620px) { body { padding: 24px 16px; } .heading { flex-direction: column; gap: 18px; } h1 { font-size: 23px; } .tags { margin-top: 16px; } .prompt-card { margin-top: 22px; } pre { padding: 18px; } .card-header { padding: 12px 18px; } }
</style></head><body><main>
<header><p class="eyebrow">Project Atlas / AI Prompts</p><div class="heading"><div class="heading-text"><h1>${escapeHtml(prompt.title)}</h1>${prompt.description ? `<p class="description">${escapeHtml(prompt.description)}</p>` : ''}</div>
<div class="actions"><button data-action="copy">${copyIcon}<span id="copy-label">Copy Prompt</span></button><button class="secondary" data-action="edit">${editIcon}Edit</button></div></div>
<div class="tags" aria-label="Tags">${tags || '<span class="untagged">No tags</span>'}</div></header>
<p id="status" role="status" aria-live="polite"></p>
<section class="prompt-card" aria-labelledby="prompt-heading"><div class="card-header"><h2 id="prompt-heading">Prompt</h2><span class="metadata">${Array.from(prompt.content).length.toLocaleString('en-US')} characters · ${lines} ${lines === 1 ? 'line' : 'lines'}</span></div><pre><span>${escapeHtml(prompt.content)}</span></pre></section>
<p class="footer">Copies the full prompt, preserving indentation and line breaks.</p>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let copyTimer;
document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    document.getElementById('status').textContent = '';
    vscode.postMessage({ action: button.dataset.action });
}));
window.addEventListener('message', ({data}) => {
    if (data.type === 'copied') {
        const label = document.getElementById('copy-label');
        label.textContent = 'Copied!';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { label.textContent = 'Copy Prompt'; }, 2000);
    } else { document.getElementById('status').textContent = data.message; }
});
</script></body></html>`;
}

export function activateAiPrompts(context: vscode.ExtensionContext): void {
    let mode: 'LIST' | 'GROUP' = context.globalState.get('projectAtlas.aiPromptsMode') === 'LIST' ? 'LIST' : 'GROUP';
    const collapsed = new Set(context.globalState.get<string[]>('projectAtlas.aiPromptsCollapsed', []));
    const parents = new Map<vscode.TreeItem, vscode.TreeItem | undefined>();
    const changed = new vscode.EventEmitter<void>();
    let view: vscode.TreeView<vscode.TreeItem>;
    let viewEvents: vscode.Disposable[] = [];
    let switching = Promise.resolve();
    const refresh = () => changed.fire();
    const canSort = () => mode === 'LIST';
    const provider: vscode.TreeDataProvider<vscode.TreeItem> = {
        onDidChangeTreeData: changed.event,
        getTreeItem: (item) => item,
        getChildren: async (item) => {
            if (item instanceof PromptTagGroup) {
                return item.children;
            }
            if (item) {
                return [];
            }
            try {
                await ensureAiPromptsFile();
                const snapshot = await readAiPromptSnapshot();
                const items = buildPromptItems(snapshot, mode, aiPromptsFile, [...collapsed]);
                parents.clear();
                for (const item of items) {
                    if (item instanceof PromptTagGroup) {
                        for (const child of item.children) {
                            parents.set(child, item);
                        }
                    }
                }
                view.message = '';
                return items;
            } catch (error) {
                view.message = 'Unable to load AI Prompts. Edit JSON to repair the file, then refresh.';
                const warning = new vscode.TreeItem('Unable to load AI Prompts');
                warning.description = error instanceof Error ? error.message : String(error);
                warning.tooltip = warning.description;
                warning.iconPath = new vscode.ThemeIcon('warning');
                warning.command = { command: 'project-atlas.editAiPromptsFile', title: 'Edit JSON' };
                return [warning];
            }
        },
        getParent: (item) => parents.get(item),
    };
    const createView = () => {
        view = vscode.window.createTreeView('projectAtlas.aiPrompts', {
            treeDataProvider: provider,
            ...(canSort()
                ? {
                      dragAndDropController: new TemplateDragAndDropController(
                          'projectAtlas.aiPrompts',
                          aiPromptsFile,
                          refresh,
                          canSort,
                      ),
                  }
                : {}),
        });
        view.description = 'aiprompts.json';
        const remember = (element: vscode.TreeItem, isCollapsed: boolean) => {
            if (!(element instanceof PromptTagGroup)) {
                return;
            }
            if (isCollapsed) {
                collapsed.add(element.tag);
            } else {
                collapsed.delete(element.tag);
            }
            void context.globalState.update('projectAtlas.aiPromptsCollapsed', [...collapsed]);
        };
        viewEvents = [
            view.onDidCollapseElement(({ element }) => remember(element, true)),
            view.onDidExpandElement(({ element }) => remember(element, false)),
            view.onDidChangeVisibility(({ visible }) => {
                if (visible) {
                    refresh();
                }
            }),
        ];
    };
    createView();
    const updateContext = async () => {
        await vscode.commands.executeCommand('setContext', 'projectAtlas.aiPromptsMode', mode);
    };
    void updateContext();
    const register = (name: string, handler: (item?: unknown) => unknown) =>
        context.subscriptions.push(
            vscode.commands.registerCommand(`project-atlas.${name}`, async (item?: unknown) => {
                try {
                    return await handler(item);
                } catch (error) {
                    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                    return undefined;
                } finally {
                    refresh();
                }
            }),
        );
    register('collapseAiPrompts', async () => {
        await vscode.commands.executeCommand('projectAtlas.aiPrompts.focus');
        await vscode.commands.executeCommand('workbench.actions.treeView.projectAtlas.aiPrompts.collapseAll');
        await vscode.commands.executeCommand('setContext', 'projectAtlas.aiPromptsCollapsed', true);
    });
    register('expandAiPrompts', async () => {
        await vscode.commands.executeCommand('projectAtlas.aiPrompts.focus');
        await expandTreeView(view, provider);
        await vscode.commands.executeCommand('setContext', 'projectAtlas.aiPromptsCollapsed', false);
    });
    void vscode.commands.executeCommand('setContext', 'projectAtlas.aiPromptsCollapsed', false);
    const copy = async (prompt: AiPrompt) => {
        await vscode.env.clipboard.writeText(prompt.content);
        void vscode.window.showInformationMessage(`Copied prompt "${prompt.title}"`);
    };
    const preview = (initial: TemplateItem<AiPrompt>) => {
        let snapshot = initial.snapshot;
        const id = snapshot.entries[initial.index]!.id;
        const panel = vscode.window.createWebviewPanel(
            'projectAtlas.aiPromptPreview',
            snapshot.entries[initial.index]!.title,
            vscode.ViewColumn.Active,
            { enableScripts: true, localResourceRoots: [] },
        );
        const render = () => {
            const prompt = snapshot.entries.find((entry) => entry.id === id);
            if (!prompt) {
                panel.dispose();
                return;
            }
            panel.title = prompt.title;
            panel.webview.html = renderPromptPreview(prompt);
        };
        let busy = false;
        const receiver = panel.webview.onDidReceiveMessage(async (message: unknown) => {
            if (!message || typeof message !== 'object' || busy) {
                return;
            }
            const action = (message as { action?: unknown }).action;
            if (!['copy', 'edit'].includes(String(action))) {
                return;
            }
            busy = true;
            try {
                const prompt = snapshot.entries.find((entry) => entry.id === id)!;
                if (action === 'copy') {
                    await copy(prompt);
                    await panel.webview.postMessage({ type: 'copied' });
                } else {
                    assertSaved(aiPromptsFile);
                    await editAiPrompt(snapshot, id);
                    snapshot = await readAiPromptSnapshot();
                    render();
                    refresh();
                }
            } catch (error) {
                await panel.webview.postMessage({ message: error instanceof Error ? error.message : String(error) });
            } finally {
                busy = false;
            }
        });
        const disposed = panel.onDidDispose(() => {
            receiver.dispose();
            disposed.dispose();
        });
        context.subscriptions.push(panel);
        render();
    };
    register('refreshAiPrompts', refresh);
    register('editAiPromptsFile', async () => {
        await ensureAiPromptsFile();
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(aiPromptsFile)));
    });
    register('addAiPrompt', async (item) => {
        assertSaved(aiPromptsFile);
        await ensureAiPromptsFile();
        await editAiPrompt(
            await readAiPromptSnapshot(),
            undefined,
            item instanceof PromptTagGroup && item.tag ? [item.tag] : [],
        );
    });
    register('editAiPromptTags', async (item) => {
        if (!(item instanceof TemplateItem) || item.contextValue !== 'aiPrompt' || item.file !== aiPromptsFile) {
            return;
        }
        const prompt = (item.snapshot as TemplateSnapshot<AiPrompt>).entries[item.index];
        if (prompt) {
            await editAiPromptTags(item.snapshot, prompt.id);
        }
    });
    for (const action of ['preview', 'copy', 'edit', 'delete', 'duplicate'] as const) {
        register(`${action}AiPrompt`, async (item) => {
            if (!(item instanceof TemplateItem) || item.contextValue !== 'aiPrompt' || item.file !== aiPromptsFile) {
                return;
            }
            const prompt = (item.snapshot as TemplateSnapshot<AiPrompt>).entries[item.index];
            if (!prompt) {
                return;
            }
            if (action === 'preview') {
                return preview(item);
            }
            if (action === 'copy') {
                return copy(prompt);
            }
            assertSaved(aiPromptsFile);
            if (action === 'edit') {
                return editAiPrompt(item.snapshot, prompt.id);
            }
            if (
                action === 'delete' &&
                (await vscode.window.showWarningMessage(
                    `Delete “${prompt.title}”?`,
                    { modal: true, detail: 'Only this prompt record will be removed.' },
                    'Delete',
                )) !== 'Delete'
            ) {
                return;
            }
            assertSaved(aiPromptsFile);
            await changeAiPrompt(item.snapshot, { type: action, id: prompt.id });
        });
    }
    for (const name of ['aiPromptsListView', 'aiPromptsGroupView']) {
        register(name, () => {
            switching = switching
                .catch(() => undefined)
                .then(async () => {
                    if (name === 'aiPromptsListView') {
                        mode = 'LIST';
                    } else if (name === 'aiPromptsGroupView') {
                        mode = 'GROUP';
                    }
                    viewEvents.forEach((event) => event.dispose());
                    view.dispose();
                    createView();
                    await updateContext();
                    await context.globalState.update('projectAtlas.aiPromptsMode', mode);
                });
            return switching;
        });
    }
    register('searchAiPrompts', async () => {
        await ensureAiPromptsFile();
        const snapshot = await readAiPromptSnapshot();
        const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { index: number }>();
        picker.placeholder = 'Search title, description, tags or prompt text';
        const update = () => {
            picker.items = snapshot.entries.flatMap((prompt, index) =>
                matchesPrompt(prompt, picker.value)
                    ? [
                          {
                              label: prompt.title,
                              description: `· ${prompt.tags?.join(' · ') || 'Untagged'}`,
                              detail: prompt.description ?? '',
                              index,
                              alwaysShow: true,
                          },
                      ]
                    : [],
            );
        };
        update();
        await new Promise<void>((resolve) => {
            const events = [
                picker.onDidChangeValue(update),
                picker.onDidAccept(() => {
                    const selected = picker.selectedItems[0];
                    if (selected) {
                        preview(
                            new TemplateItem(
                                snapshot.entries[selected.index]!.title,
                                snapshot,
                                selected.index,
                                aiPromptsFile,
                                'aiPrompt',
                            ),
                        );
                    }
                    picker.hide();
                }),
                picker.onDidHide(() => {
                    events.forEach((event) => event.dispose());
                    picker.dispose();
                    resolve();
                }),
            ];
            picker.show();
        });
    });
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(aiPromptsFile)), path.basename(aiPromptsFile)),
    );
    context.subscriptions.push(
        changed,
        watcher,
        watcher.onDidCreate(refresh),
        watcher.onDidChange(refresh),
        watcher.onDidDelete(refresh),
        {
            dispose: () => {
                viewEvents.forEach((event) => event.dispose());
                view.dispose();
            },
        },
    );
}
