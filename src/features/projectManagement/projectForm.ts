import { showTemplateForm, TemplateForm } from '../templates/templateForm';
import { cleanTags } from './model';
import type { ProjectFormValues, ProjectItem } from './types';

export type { ProjectFormValues } from './types';

export async function editProjectForm(
    project: ProjectItem,
    save: (values: ProjectFormValues) => Promise<void>,
    form: TemplateForm = showTemplateForm,
    availableTags: readonly string[] = [],
): Promise<void> {
    await form({
        title: project.id ? 'Edit Project' : 'Add Project',
        eyebrow: 'Project Atlas · Projects',
        description: 'Keep a project ready to open from your workspace.',
        fields: [
            {
                name: 'path',
                label: 'Project Path',
                value: project.path,
                readOnly: true,
                monospace: true,
            },
            {
                name: 'name',
                label: 'Project Name',
                value: project.name,
                required: true,
                placeholder: 'My project',
            },
            {
                name: 'tags',
                label: 'Tags',
                value: JSON.stringify(project.tags),
                tagPicker: true,
                tagOptions: [...new Set([...availableTags, ...project.tags])].sort((a, b) => a.localeCompare(b)),
                hint: 'Select existing tags or type to add a new one.',
            },
            {
                name: 'favorite',
                label: 'Favorites',
                value: String(project.favorite),
                checkbox: true,
            },
        ],
        save: async (values) => {
            await save({
                name: values.name!.trim(),
                tags: cleanTags(JSON.parse(values.tags!) as string[]),
                favorite: values.favorite === 'true',
            });
        },
    });
}
