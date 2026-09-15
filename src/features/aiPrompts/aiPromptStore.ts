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
            title: '代码审查',
            description: '检查潜在缺陷、边界情况和可维护性',
            tags: ['开发'],
            content:
                '请审查以下代码，重点检查正确性、边界情况、安全性和可维护性。\n按严重程度列出问题，说明触发条件、影响和修改建议，必要时给出示例代码。\n区分确定的问题与需要进一步验证的疑点；如果没有发现问题，请明确说明。\n\n待审查代码：\n',
        },
        {
            id: randomUUID(),
            title: '排查问题',
            description: '结合报错和日志分析根因，给出验证步骤',
            tags: ['开发'],
            content:
                '请根据以下现象、报错、日志和相关代码帮助我排查问题。\n先总结已知事实，再按可能性列出原因，并为每个原因给出验证步骤。\n优先提供最小改动的修复方案和回归验证方法，不要把猜测当成结论。信息不足时，请列出最关键的补充信息。\n\n问题现象与相关信息：\n',
        },
        {
            id: randomUUID(),
            title: '编写单元测试',
            description: '覆盖正常流程、边界条件和异常路径',
            tags: ['开发'],
            content:
                '请为以下代码编写单元测试，沿用项目现有的测试框架和风格。\n覆盖主要正常流程、边界条件和异常路径，使用明确断言验证可观察的行为，避免仅重复实现细节。\n测试应可独立运行，避免依赖真实网络或个人环境，并清理临时资源。请说明测试覆盖的场景及运行方式。\n\n待测试代码与项目背景：\n',
        },
        {
            id: randomUUID(),
            title: '重构代码',
            description: '在保持对外行为的前提下改善代码结构',
            tags: ['开发'],
            content:
                '请重构以下代码，在保持现有对外行为和接口兼容的前提下，提高可读性与可维护性。\n优先消除重复、简化复杂分支、改善命名和职责划分，避免引入不必要的抽象或依赖。\n给出修改后的代码，解释关键改动及其理由，并说明如何验证行为没有变化。发现潜在缺陷时请单独指出。\n\n待重构代码：\n',
        },
        {
            id: randomUUID(),
            title: '润色文案',
            description: '保留原意，改善表达、结构和语气',
            tags: ['写作'],
            content:
                '请润色以下文案，保留原意、事实和关键细节，使用自然、简洁、易懂的中文。\n调整冗余表达和不清晰的结构，使语气适合原文的受众与用途，不添加未经提供的事实或夸张结论。\n先给出可直接使用的版本，再简要说明主要修改；有歧义的内容请单独标注。\n\n原文：\n',
        },
        {
            id: randomUUID(),
            title: '总结提炼',
            description: '提取核心结论、关键要点和待办事项',
            tags: ['通用'],
            content:
                '请总结以下内容，先用一段话概括核心结论，再分点列出关键事实、决定和待办事项。\n保留重要数字、时间和限制条件；待办事项的负责人和期限仅在原文明确给出时填写。\n区分原文结论、尚未确定的信息与需要进一步确认的问题，不补充原文没有的事实。\n\n待总结内容：\n',
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
                    title: `${entries[index]!.title} 副本`,
                });
            }
        }
        parseAiPrompts(document);
    });
}
