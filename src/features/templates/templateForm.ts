import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

export interface TemplateFormField {
    name: string;
    label: string;
    value: string;
    required?: boolean;
    multiline?: boolean;
    options?: string[];
}

export interface TemplateFormOptions {
    title: string;
    fields: TemplateFormField[];
    save: (values: Record<string, string>) => Promise<void>;
}

export type TemplateForm = (options: TemplateFormOptions) => Promise<void>;
const panels = new Set<vscode.WebviewPanel>();

export function disposeTemplateForms(): void {
    for (const panel of panels) {
        panel.dispose();
    }
}

export function validateFormValues(fields: TemplateFormField[], input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object') {
        throw new Error('Invalid form data.');
    }
    const values: Record<string, string> = {};
    for (const field of fields) {
        const value = (input as Record<string, unknown>)[field.name];
        if (typeof value !== 'string') {
            throw new Error(`Invalid ${field.label}.`);
        }
        if (field.required && !value.trim()) {
            throw new Error(`${field.label} is required.`);
        }
        if (field.options && value && !field.options.includes(value)) {
            throw new Error(`Invalid ${field.label}.`);
        }
        values[field.name] = value;
    }
    return values;
}

export const showTemplateForm: TemplateForm = async (options) => {
    const panel = vscode.window.createWebviewPanel(
        'projectAtlas.templateEditor',
        options.title,
        vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
    );
    panels.add(panel);
    await new Promise<void>((resolve) => {
        let saving = false;
        let closed = false;
        const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
            if (!message || typeof message !== 'object' || saving || closed) {
                return;
            }
            const request = message as { type?: unknown; values?: unknown };
            if (request.type === 'cancel') {
                panel.dispose();
                return;
            }
            if (request.type !== 'save') {
                return;
            }
            saving = true;
            try {
                await options.save(validateFormValues(options.fields, request.values));
                panel.dispose();
            } catch (error) {
                if (!closed) {
                    await panel.webview.postMessage({
                        type: 'error',
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            } finally {
                saving = false;
                if (closed) {
                    resolve();
                }
            }
        });
        const disposed = panel.onDidDispose(() => {
            closed = true;
            panels.delete(panel);
            messages.dispose();
            disposed.dispose();
            if (!saving) {
                resolve();
            }
        });
        panel.webview.html = renderTemplateForm(options);
    });
};

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (character) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[character]!,
    );
}

export function renderTemplateForm(options: TemplateFormOptions): string {
    const nonce = randomBytes(16).toString('hex');
    const fields = options.fields
        .map((field) => {
            const attributes = `id="${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}`;
            const input = field.options
                ? `<select ${attributes}><option value="" disabled${field.value === '' ? ' selected' : ''}>Select ${escapeHtml(field.label)}</option>${field.options
                      .map(
                          (option) =>
                              `<option value="${escapeHtml(option)}"${option === field.value ? ' selected' : ''}>${escapeHtml(option)}</option>`,
                      )
                      .join('')}</select>`
                : field.multiline
                  ? `<textarea ${attributes} rows="3">${escapeHtml(field.value)}</textarea>`
                  : `<input ${attributes} value="${escapeHtml(field.value)}">`;
            return `<label for="${escapeHtml(field.name)}">${escapeHtml(field.label)}${field.required ? '' : ' (optional)'}</label>${input}`;
        })
        .join('\n');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${escapeHtml(options.title)}</title>
<style nonce="${nonce}">
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); padding: 24px; }
main { max-width: 640px; margin: 0 auto; } h1 { font-size: 20px; font-weight: 500; }
label { display: block; margin: 20px 0 8px; }
input, textarea, select { box-sizing: border-box; width: 100%; padding: 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); font: inherit; }
select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, transparent); }
textarea { resize: vertical; } :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.actions { display: flex; gap: 10px; margin-top: 24px; } button { cursor: pointer; padding: 7px 18px; border: 1px solid transparent; font: inherit; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button:hover { background: var(--vscode-button-hoverBackground); } button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button:disabled { opacity: .6; cursor: default; } #error { color: var(--vscode-errorForeground); white-space: pre-wrap; } .hint { color: var(--vscode-descriptionForeground); }
</style></head><body><main><h1>${escapeHtml(options.title)}</h1>
<form id="editor">${fields}<p id="error" role="alert" tabindex="-1" hidden></p>
<div class="actions"><button type="submit" id="save">Save</button><button type="button" id="cancel" class="secondary">Cancel</button></div>
<p class="hint">Ctrl/Cmd+Enter to save · Esc to cancel</p></form></main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const form = document.getElementById('editor');
const error = document.getElementById('error');
let saving = false;
function setSaving(value) {
    saving = value;
    for (const element of form.elements) { element.disabled = value; }
    document.getElementById('save').textContent = value ? 'Saving…' : 'Save';
}
form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving) return;
    const values = Object.fromEntries(new FormData(form));
    error.hidden = true;
    setSaving(true);
    vscode.postMessage({ type: 'save', values });
});
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
document.addEventListener('keydown', (event) => {
    if (saving) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
    if (event.key === 'Escape') { event.preventDefault(); vscode.postMessage({ type: 'cancel' }); }
});
window.addEventListener('message', ({ data }) => {
    if (data.type === 'error') { setSaving(false); error.textContent = data.message; error.hidden = false; error.focus(); }
});
form.querySelector('input, textarea, select').focus();
</script></body></html>`;
}
