import * as vscode from 'vscode';
import { AiPrompt, aiPromptsFile } from './aiPromptStore';
import { TemplateSnapshot } from '../templates/templateStore';
import { TemplateItem } from '../templates/templatesFeature';

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
            item.description = prompt.description ? `· ${prompt.description}` : '';
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
