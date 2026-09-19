import * as vscode from 'vscode';

interface TagItem extends vscode.QuickPickItem {
    tag: string;
    create?: boolean;
}

export function pickRepositoryTags(
    existingTags: readonly string[],
    initiallySelectedTags: readonly string[] = [],
    title = 'Add Git Repository: Select Tags',
): Promise<string[] | undefined> {
    const picker = vscode.window.createQuickPick<TagItem>();
    let tags = cleanRepositoryTags(existingTags);
    let settled = false;
    picker.title = title;
    picker.placeholder = 'Select existing tags or type a new tag; leave empty for no tags';
    picker.canSelectMany = true;
    picker.ignoreFocusOut = true;
    picker.matchOnDescription = true;

    const updateItems = (value: string, selectedTags: readonly string[]): void => {
        const query = value.trim();
        const selected = new Set(selectedTags.map(tagKey));
        const create = query && !tags.some((tag) => tagKey(tag) === tagKey(query));
        const items: TagItem[] = [
            ...(create
                ? [
                      {
                          label: `$(add) Create tag “${query}”`,
                          description: 'Add a new tag',
                          tag: query,
                          create: true,
                          alwaysShow: true,
                      },
                  ]
                : []),
            ...tags.map((tag) => ({ label: tag, tag, alwaysShow: true })),
        ];
        picker.items = items;
        picker.selectedItems = items.filter((item) => !item.create && selected.has(tagKey(item.tag)));
        if (create) {
            picker.activeItems = [items[0]!];
        }
    };

    updateItems('', initiallySelectedTags);
    return new Promise((resolve) => {
        const finish = (value: string[] | undefined): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
            picker.hide();
        };
        picker.onDidChangeValue((value) => {
            const selected = picker.selectedItems.filter((item) => !item.create).map((item) => item.tag);
            updateItems(value, selected);
        });
        picker.onDidAccept(() => {
            const createItem = picker.activeItems.find((item) => item.create);
            if (createItem) {
                const selected = picker.selectedItems.filter((item) => !item.create).map((item) => item.tag);
                tags = cleanRepositoryTags([...tags, createItem.tag]);
                picker.value = '';
                updateItems('', [...selected, createItem.tag]);
                return;
            }
            finish(cleanRepositoryTags(picker.selectedItems.map((item) => item.tag)));
        });
        picker.onDidHide(() => {
            if (!settled) {
                settled = true;
                resolve(undefined);
            }
            picker.dispose();
        });
        picker.show();
    });
}

export function cleanRepositoryTags(values: readonly string[]): string[] {
    const tags = new Map<string, string>();
    for (const value of values) {
        const tag = value.trim();
        if (tag && !tags.has(tagKey(tag))) {
            tags.set(tagKey(tag), tag);
        }
    }
    return [...tags.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function tagKey(value: string): string {
    return value.toLocaleLowerCase();
}
