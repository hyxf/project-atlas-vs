import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

export interface TemplateFormField {
    name: string;
    label: string;
    value: string;
    required?: boolean;
    multiline?: boolean;
    checkbox?: boolean;
    readOnly?: boolean;
    options?: string[];
    suggestions?: string[];
    rows?: number;
    placeholder?: string;
    hint?: string;
    halfWidth?: boolean;
    monospace?: boolean;
}

export interface TemplateFormOptions {
    title: string;
    description?: string;
    eyebrow?: string;
    confirmDiscard?: boolean;
    originalValues?: Record<string, string>;
    fields: TemplateFormField[];
    save: (values: Record<string, string>) => Promise<void>;
}

export type TemplateForm = (options: TemplateFormOptions) => Promise<void>;
const panels = new Set<vscode.WebviewPanel>();
let disposingForms = false;

export function disposeTemplateForms(): void {
    disposingForms = true;
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
        const value = field.readOnly ? field.value : (input as Record<string, unknown>)[field.name];
        if (typeof value !== 'string') {
            throw new Error(`Invalid ${field.label}.`);
        }
        if (field.checkbox && value !== 'true' && value !== 'false') {
            throw new Error(`Invalid ${field.label}.`);
        }
        if (field.required && !value.trim()) {
            throw new Error(`${field.label} is required.`);
        }
        if (field.options && value && !field.options.includes(value)) {
            throw new Error(`Invalid ${field.label}.`);
        }
        values[field.name] = field.multiline && value === field.value.replace(/\r\n?/g, '\n') ? field.value : value;
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
        let accepted = false;
        const draft = Object.fromEntries(options.fields.map((field) => [field.name, field.value]));
        const dirty = () =>
            options.fields.some((field) => draft[field.name] !== (options.originalValues?.[field.name] ?? field.value));
        const discard = async () =>
            !options.confirmDiscard ||
            !dirty() ||
            (await vscode.window.showWarningMessage('Discard unsaved prompt changes?', { modal: true }, 'Discard')) ===
                'Discard';
        const recoverDraft = async () => {
            if (!accepted && !disposingForms && options.confirmDiscard && dirty() && !(await discard())) {
                await showTemplateForm({
                    ...options,
                    originalValues:
                        options.originalValues ??
                        Object.fromEntries(options.fields.map((field) => [field.name, field.value])),
                    fields: options.fields.map((field) => ({ ...field, value: draft[field.name]! })),
                });
            }
        };
        const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
            if (!message || typeof message !== 'object' || closed) {
                return;
            }
            const request = message as { type?: unknown; values?: unknown };
            if (request.type === 'change' && request.values && typeof request.values === 'object') {
                const values = request.values as Record<string, unknown>;
                for (const field of options.fields) {
                    if (typeof values[field.name] === 'string') {
                        draft[field.name] = values[field.name] as string;
                    }
                }
                return;
            }
            if (request.type === 'cancel') {
                if ((saving && options.confirmDiscard) || !(await discard())) {
                    return;
                }
                accepted = true;
                panel.dispose();
                return;
            }
            if (request.type !== 'save' || saving) {
                return;
            }
            saving = true;
            try {
                await options.save(validateFormValues(options.fields, request.values));
                accepted = true;
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
                    await recoverDraft();
                    resolve();
                }
            }
        });
        const disposed = panel.onDidDispose(async () => {
            closed = true;
            panels.delete(panel);
            messages.dispose();
            disposed.dispose();
            if (!saving) {
                await recoverDraft();
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
            const attributes = `id="${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${field.required ? 'required' : ''}${field.readOnly ? ' readonly' : ''}${field.hint ? ` aria-describedby="${escapeHtml(field.name)}-hint"` : ''}${field.monospace ? ' class="code-input" spellcheck="false"' : ''}`;
            if (field.checkbox) {
                return `<div class="field"><label class="checkbox-field" for="${escapeHtml(field.name)}"><input type="checkbox" ${attributes} value="true"${field.value === 'true' ? ' checked' : ''}>${escapeHtml(field.label)}</label>${field.hint ? `<p class="field-hint" id="${escapeHtml(field.name)}-hint">${escapeHtml(field.hint)}</p>` : ''}</div>`;
            }
            const input = field.options
                ? `<select ${attributes}><option value="" disabled${field.value === '' ? ' selected' : ''}>Select ${escapeHtml(field.label)}</option>${field.options
                      .map(
                          (option) =>
                              `<option value="${escapeHtml(option)}"${option === field.value ? ' selected' : ''}>${escapeHtml(option)}</option>`,
                      )
                      .join('')}</select>`
                : field.multiline
                  ? `<textarea ${attributes} rows="${field.rows ?? (field.monospace ? 5 : 3)}">${'\n'}${escapeHtml(field.value)}</textarea>`
                  : `<input ${attributes} value="${escapeHtml(field.value)}"${field.suggestions ? ` list="${escapeHtml(field.name)}-options"` : ''}>${field.suggestions ? `<datalist id="${escapeHtml(field.name)}-options">${field.suggestions.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('')}</datalist>` : ''}`;
            return `<div class="field${field.halfWidth ? ' half-width' : ''}"><label for="${escapeHtml(field.name)}">${escapeHtml(field.label)}<span class="field-status">${field.readOnly ? 'Read only' : field.required ? 'Required' : 'Optional'}</span></label>${input}${field.hint ? `<p class="field-hint" id="${escapeHtml(field.name)}-hint">${escapeHtml(field.hint)}</p>` : ''}</div>`;
        })
        .join('\n');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${escapeHtml(options.title)}</title>
<style nonce="${nonce}">
* { box-sizing: border-box; }
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); line-height: 1.5; padding: 40px 24px; }
main { max-width: 680px; margin: 0 auto; }
header { margin-bottom: 24px; }
.eyebrow { margin: 0 0 8px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; }
h1 { margin: 0; font-size: 24px; line-height: 1.3; font-weight: 600; }
.subtitle { margin: 10px 0 0; color: var(--vscode-descriptionForeground); }
form { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent)); border-radius: 8px; overflow: hidden; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 20px; padding: 28px; }
.field { grid-column: 1 / -1; min-width: 0; }
.half-width { grid-column: span 1; }
label { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; font-weight: 600; }
.field-status { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; }
.field-hint { margin: 7px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
input, textarea, select { width: 100%; min-height: 36px; padding: 8px 10px; border-radius: 4px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder, var(--vscode-descriptionForeground, #808080))); font: inherit; }
input::placeholder, textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
.checkbox-field { align-items: center; margin: 0; cursor: pointer; }
input[type="checkbox"] { width: 16px; height: 16px; min-height: 0; margin: 0; padding: 0; accent-color: var(--vscode-button-background); cursor: pointer; }
.code-input { font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 13px); line-height: 1.6; }
select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-contrastBorder, var(--vscode-descriptionForeground, #808080)))); }
textarea { display: block; resize: vertical; min-height: 90px; } :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding: 18px 28px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent)); }
.actions { display: flex; gap: 8px; margin-left: auto; } button { cursor: pointer; min-width: 76px; padding: 7px 18px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); font: inherit; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button:hover { background: var(--vscode-button-hoverBackground); } button.secondary { background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border-color: var(--vscode-button-border, var(--vscode-contrastBorder, var(--vscode-descriptionForeground, #808080))); }
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-editor-background))); border-color: currentColor; }
button:disabled { opacity: .6; cursor: default; } #error { margin: 0 28px 24px; padding: 10px 12px; border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); border-radius: 4px; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); white-space: pre-wrap; overflow-wrap: anywhere; }
.hint { margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
@media (max-width: 480px) { body { padding: 24px 16px; } .fields { padding: 20px; gap: 20px; } .half-width { grid-column: 1 / -1; } .footer { padding: 16px 20px; } #error { margin: 0 20px 20px; } }
</style></head><body><main><header><p class="eyebrow">${escapeHtml(options.eyebrow ?? 'Project Atlas · Templates')}</p><h1>${escapeHtml(options.title)}</h1>${options.description ? `<p class="subtitle">${escapeHtml(options.description)}</p>` : ''}</header>
<form id="editor"><div class="fields">${fields}</div><p id="error" role="alert" tabindex="-1" hidden></p>
<div class="footer"><p class="hint">Ctrl/Cmd+Enter to save · Esc to cancel</p><div class="actions"><button type="button" id="cancel" class="secondary">Cancel</button><button type="submit" id="save">Save</button></div></div>
</form></main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const form = document.getElementById('editor');
const error = document.getElementById('error');
let saving = false;
function setSaving(value) {
    saving = value;
    for (const element of form.elements) { element.disabled = value && element.id !== 'cancel'; }
    document.getElementById('save').textContent = value ? 'Saving…' : 'Save';
    document.getElementById('cancel').textContent = value ? 'Close' : 'Cancel';
}
function readValues() {
    const values = Object.fromEntries(new FormData(form));
    for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) values[checkbox.name] = String(checkbox.checked);
    return values;
}
form.addEventListener('input', () => vscode.postMessage({ type: 'change', values: readValues() }));
form.addEventListener('keydown', event => {
    if (event.key === 'Tab' && event.target instanceof HTMLTextAreaElement && !event.shiftKey) {
        event.preventDefault();
        event.target.setRangeText('    ', event.target.selectionStart, event.target.selectionEnd, 'end');
        event.target.dispatchEvent(new Event('input', { bubbles: true }));
    }
});
form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving) return;
    const values = Object.fromEntries(new FormData(form));
    for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
        values[checkbox.name] = String(checkbox.checked);
    }
    error.hidden = true;
    setSaving(true);
    vscode.postMessage({ type: 'save', values });
});
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); vscode.postMessage({ type: 'cancel' }); return; }
    if (saving) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
});
window.addEventListener('message', ({ data }) => {
    if (data.type === 'error') { setSaving(false); error.textContent = data.message; error.hidden = false; error.focus(); }
});
form.querySelector('input, textarea, select').focus();
</script></body></html>`;
}
