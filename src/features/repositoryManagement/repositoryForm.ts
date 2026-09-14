import * as vscode from 'vscode';
import { showTemplateForm, TemplateForm } from '../templates/templateForm';
import { RepositoryItem } from './model';
import { parseRepositoryIdentity } from './repositoryUrl';
import { RepositoryStore } from './store';
import { cleanRepositoryTags } from './tagPicker';

export async function editRepositoryForm(
    store: RepositoryStore,
    repository?: RepositoryItem,
    onSaved: () => void = () => {},
    form: TemplateForm = showTemplateForm,
): Promise<void> {
    const assertSaved = (): void => {
        if (vscode.workspace.textDocuments.some((document) => document.uri.fsPath === store.file && document.isDirty)) {
            throw new Error('Save or discard the JSON file’s unsaved changes, then refresh the view and try again.');
        }
    };
    assertSaved();
    const existingTags = cleanRepositoryTags((await store.repositories()).flatMap((item) => item.tags));
    await form({
        title: repository ? 'Edit Git Repository' : 'Add Git Repository',
        eyebrow: 'Project Atlas · Git Repositories',
        description: 'Keep a Git repository ready to find and clone.',
        fields: [
            {
                name: 'url',
                label: 'Repository URL',
                value: repository?.url ?? '',
                required: true,
                monospace: true,
                placeholder: 'git@github.com:owner/repository.git',
                hint: 'Enter an SSH Git repository URL. The group and name are derived from the URL.',
            },
            {
                name: 'description',
                label: 'Description',
                value: repository?.description ?? '',
                multiline: true,
                placeholder: 'A short note about this repository',
            },
            {
                name: 'tags',
                label: 'Tags',
                value: repository?.tags.join('\n') ?? '',
                multiline: true,
                placeholder: 'work\nfrontend',
                hint: `Enter one tag per line, or leave empty for no tags.${existingTags.length ? ` Existing tags: ${existingTags.join(', ')}.` : ''}`,
            },
        ],
        save: async (values) => {
            assertSaved();
            const url = values.url!.trim();
            const identity = parseRepositoryIdentity(url);
            if (!identity) {
                throw new Error('Enter a valid SSH Git repository URL.');
            }
            const description = values.description!.trim();
            const nextRepository = {
                ...identity,
                url,
                tags: cleanRepositoryTags(values.tags!.split(/\r?\n/)),
                ...(description ? { description } : {}),
            };
            const result = repository
                ? await store.updateRepository(repository.url, nextRepository)
                : await store.addIfMissing(nextRepository);
            if (result === 'existing') {
                throw new Error('Another saved repository uses that URL.');
            }
            if (result === 'missing') {
                throw new Error('This repository was removed. Refresh the view and try again.');
            }
            onSaved();
        },
    });
}
