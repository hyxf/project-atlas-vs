/** A reusable prompt entry persisted in `aiprompts.json`. */
export interface AiPrompt {
    id: string;
    title: string;
    content: string;
    description?: string | undefined;
    tags?: string[] | undefined;
}

/** Webview request that creates or updates a prompt. */
export interface SavePromptMutation {
    type: 'save';
    value: Omit<AiPrompt, 'id'>;
    id?: string | undefined;
}

export interface DeleteOrDuplicatePromptMutation {
    type: 'delete' | 'duplicate';
    id: string;
}

export interface ReorderPromptMutation {
    type: 'reorder';
    order: number[];
}

export interface UpdatePromptTagsMutation {
    type: 'tags';
    id: string;
    tags: string[];
}

/** Discriminated command accepted by prompt persistence. */
export type PromptMutation =
    SavePromptMutation | DeleteOrDuplicatePromptMutation | ReorderPromptMutation | UpdatePromptTagsMutation;

export interface AiPromptWebviewMessage {
    action?: unknown;
}

export interface PromptQuickPickItem {
    index: number;
}
