import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mutateTemplate, readTemplateSnapshot, TemplateSnapshot } from '../templates/templateStore';

export interface AiPrompt {
    id: string;
    title: string;
    content: string;
    description?: string | undefined;
    tags?: string[] | undefined;
}

export const aiPromptsFile = path.join(os.homedir(), '.project-atlas', 'aiprompts.json');

export async function ensureAiPromptsFile(file = aiPromptsFile): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const prompts: AiPrompt[] = [
        {
            id: randomUUID(),
            title: 'Code Review',
            description: 'Check for potential bugs, edge cases, and maintainability issues',
            tags: ['Development'],
            content:
                'Review the following code for correctness, edge cases, security, and maintainability.\nList issues by severity, explaining their triggers, impact, and suggested fixes. Include example code where useful.\nDistinguish confirmed issues from concerns that need further verification. If you find no issues, say so explicitly.\n\nCode to review:\n',
        },
        {
            id: randomUUID(),
            title: 'Troubleshoot an Issue',
            description: 'Analyze errors and logs to identify root causes and verification steps',
            tags: ['Development'],
            content:
                'Help me troubleshoot the following symptoms, errors, logs, and related code.\nSummarize the known facts, then list possible causes in order of likelihood and provide verification steps for each.\nPrioritize fixes with minimal changes and explain how to check for regressions. Do not present guesses as conclusions. If information is missing, list the most critical details needed.\n\nIssue and related information:\n',
        },
        {
            id: randomUUID(),
            title: 'Write Unit Tests',
            description: 'Cover expected behavior, edge cases, and error paths',
            tags: ['Development'],
            content:
                'Write unit tests for the following code using the existing test framework and style in the project.\nCover the main expected flows, edge cases, and error paths. Use clear assertions to verify observable behavior rather than repeating implementation details.\nTests should run independently, avoid dependencies on live networks or personal environments, and clean up temporary resources. Explain the scenarios covered and how to run the tests.\n\nCode to test and project context:\n',
        },
        {
            id: randomUUID(),
            title: 'Refactor Code',
            description: 'Improve code structure while preserving external behavior',
            tags: ['Development'],
            content:
                'Refactor the following code to improve readability and maintainability while preserving existing external behavior and interface compatibility.\nPrioritize removing duplication, simplifying complex branches, improving names, and clarifying responsibilities. Avoid unnecessary abstractions or dependencies.\nProvide the updated code, explain key changes and their rationale, and describe how to verify that behavior is unchanged. Flag any potential bugs separately.\n\nCode to refactor:\n',
        },
        {
            id: randomUUID(),
            title: 'Polish Writing',
            description: 'Improve wording, structure, and tone while preserving the original meaning',
            tags: ['Writing'],
            content:
                'Polish the following text using natural, concise, easy-to-understand English while preserving its meaning, facts, and key details.\nRemove redundant wording and clarify the structure. Match the tone to the intended audience and purpose without adding unsupported facts or exaggerated claims.\nProvide a ready-to-use version first, then briefly explain the main edits. Flag ambiguous content separately.\n\nOriginal text:\n',
        },
        {
            id: randomUUID(),
            title: 'Summarize Content',
            description: 'Extract main conclusions, key points, and action items',
            tags: ['General'],
            content:
                'Summarize the following content. Start with a paragraph stating the main conclusions, then list key facts, decisions, and action items.\nPreserve important numbers, dates, and constraints. Include action item owners and deadlines only when explicitly stated in the source.\nDistinguish conclusions in the source from uncertain information and questions that need confirmation. Do not add facts absent from the source.\n\nContent to summarize:\n',
        },
    ];
    await fs
        .writeFile(file, `${JSON.stringify({ schemaVersion: 1, prompts }, null, 2)}\n`, { flag: 'wx' })
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        });
}

export function parseAiPrompts(data: unknown): AiPrompt[] {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('AI Prompts must be an object.');
    }
    const document = data as Record<string, unknown>;
    if (document.schemaVersion !== 1) {
        throw new Error('Unsupported AI Prompts schemaVersion. Expected 1.');
    }
    if (!Array.isArray(document.prompts)) {
        throw new Error('AI Prompts must contain a prompts array.');
    }
    const ids = new Set<string>();
    return document.prompts.map((entry: unknown, index: number) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`Prompt ${index + 1} must be an object.`);
        }
        const value = entry as Record<string, unknown>;
        for (const key of ['id', 'title', 'content']) {
            if (typeof value[key] !== 'string' || !value[key].trim()) {
                throw new Error(`Prompt ${index + 1}: ${key} is required.`);
            }
        }
        const id = value.id as string;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            throw new Error(`Prompt ${index + 1}: id must be a UUID.`);
        }
        if (ids.has(id.toLowerCase())) {
            throw new Error(`Prompt ${index + 1}: duplicate id ${id}.`);
        }
        ids.add(id.toLowerCase());
        for (const key of ['description']) {
            if (value[key] !== undefined && typeof value[key] !== 'string') {
                throw new Error(`Prompt ${index + 1}: invalid ${key}.`);
            }
        }
        if (
            value.tags !== undefined &&
            (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))
        ) {
            throw new Error(`Prompt ${index + 1}: tags must be an array of strings.`);
        }
        return {
            id,
            title: (value.title as string).trim(),
            content: value.content as string,
            description: (value.description as string | undefined)?.trim(),
            tags: normalizePromptTags((value.tags as string[] | undefined) ?? []),
        };
    });
}

export function normalizePromptTags(tags: readonly string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

export function readAiPromptSnapshot(file = aiPromptsFile): Promise<TemplateSnapshot<AiPrompt>> {
    return readTemplateSnapshot(file, parseAiPrompts);
}

export type PromptMutation =
    | { type: 'save'; value: Omit<AiPrompt, 'id'>; id?: string | undefined }
    | { type: 'delete' | 'duplicate'; id: string }
    | { type: 'reorder'; order: number[] }
    | { type: 'tags'; id: string; tags: string[] };

export async function changeAiPrompt(
    snapshot: TemplateSnapshot<AiPrompt>,
    action: PromptMutation,
    file = aiPromptsFile,
): Promise<void> {
    await mutateTemplate(file, snapshot, (document) => {
        const entries = parseAiPrompts(document);
        const records = document.prompts as Record<string, unknown>[];
        if (action.type === 'reorder') {
            if (
                action.order.length !== records.length ||
                new Set(action.order).size !== records.length ||
                action.order.some((index) => !Number.isInteger(index) || index < 0 || index >= records.length)
            ) {
                throw new Error('Invalid prompt order.');
            }
            document.prompts = action.order.map((index) => records[index]);
        } else {
            const index = action.id === undefined ? -1 : entries.findIndex((entry) => entry.id === action.id);
            if (action.id !== undefined && index < 0) {
                throw new Error('This prompt no longer exists. Refresh and try again.');
            }
            if (action.type === 'save') {
                const record = index < 0 ? ({ id: randomUUID() } as Record<string, unknown>) : records[index]!;
                record.title = action.value.title.trim();
                record.content = action.value.content;
                record.tags = normalizePromptTags(action.value.tags ?? []);
                for (const key of ['description'] as const) {
                    const value = action.value[key]?.trim();
                    if (value) {
                        record[key] = value;
                    } else {
                        delete record[key];
                    }
                }
                if (index < 0) {
                    records.push(record);
                }
            } else if (action.type === 'tags') {
                records[index]!.tags = normalizePromptTags(action.tags);
            } else if (action.type === 'delete') {
                records.splice(index, 1);
            } else {
                records.splice(index + 1, 0, {
                    ...records[index],
                    id: randomUUID(),
                    title: `${entries[index]!.title} Copy`,
                });
            }
        }
        parseAiPrompts(document);
    });
}
