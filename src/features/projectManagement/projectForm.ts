import { showTemplateForm, TemplateForm } from '../templates/templateForm';
import { cleanTags, ProjectItem } from './model';

export type ProjectFormValues = Pick<ProjectItem, 'name' | 'tags' | 'favorite'>;

export async function editProjectForm(
    project: ProjectItem,
    save: (values: ProjectFormValues) => Promise<void>,
    form: TemplateForm = showTemplateForm,
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
                value: project.tags.join(', '),
                multiline: true,
                placeholder: 'work, frontend',
                hint: 'Separate tags with commas or new lines. Leave empty for no tags.',
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
                tags: cleanTags(values.tags!.split(/[,\r\n]/)),
                favorite: values.favorite === 'true',
            });
        },
    });
}
