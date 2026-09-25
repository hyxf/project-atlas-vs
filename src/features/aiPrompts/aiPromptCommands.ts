import { pickRepositoryTags } from '../repositoryManagement/tagPicker';
import { assertSaved } from '../templates/templateCommands';
import { showTemplateForm, TemplateForm } from '../templates/templateForm';
import { TemplateSnapshot } from '../templates/templateStore';
import { AiPrompt, aiPromptsFile, changeAiPrompt } from './aiPromptStore';

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
