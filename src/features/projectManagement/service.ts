import * as path from 'path';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { cleanTags, ProjectItem, SortBy } from './model';
import { ProjectStore } from './store';

export class ProjectService {
    private mutationQueue: Promise<void> = Promise.resolve();

    constructor(readonly store: ProjectStore) {}

    async projects(force = false): Promise<ProjectItem[]> {
        return this.store.projects(force);
    }

    async findById(id: string): Promise<ProjectItem | undefined> {
        return (await this.projects()).find((project) => project.id === id);
    }

    async findByPath(value: string): Promise<ProjectItem | undefined> {
        const key = await pathIdentity(value);
        const projects = await this.projects();
        const identities = await Promise.all(projects.map((project) => pathIdentity(project.path)));
        return projects.find((_project, index) => identities[index] === key);
    }

    async save(name: string, projectPath: string, tags: Iterable<string>, favorite: boolean): Promise<ProjectItem> {
        return this.mutate(async () => {
            return this.saveProject(name, projectPath, tags, favorite);
        });
    }

    private async saveProject(
        name: string,
        projectPath: string,
        tags: Iterable<string>,
        favorite: boolean,
    ): Promise<ProjectItem> {
        const normalized = normalizePath(projectPath);
        const projects = await this.projects();
        const key = await pathIdentity(normalized);
        const identities = await Promise.all(projects.map((project) => pathIdentity(project.path)));
        const existing = projects.find((_project, index) => identities[index] === key);
        const project: ProjectItem = existing
            ? { ...existing }
            : {
                  id: randomUUID(),
                  name: '',
                  path: normalized,
                  tags: [],
                  favorite: false,
                  lastOpenedAt: null,
              };
        if (!name.trim()) {
            throw new Error('Project name must not be empty.');
        }
        project.name = name.trim();
        project.tags = cleanTags(tags);
        project.favorite = favorite;
        if (existing) {
            projects[projects.indexOf(existing)] = project;
        } else {
            projects.push(project);
        }
        await this.store.replaceProjects(projects);
        return project;
    }

    async update(project: ProjectItem): Promise<void> {
        await this.mutate(() => this.updateProject(project));
    }

    private async updateProject(project: ProjectItem): Promise<void> {
        if (!project.name.trim()) {
            throw new Error('Project name must not be empty.');
        }
        const projects = await this.projects();
        const index = projects.findIndex((item) => item.id === project.id);
        if (index < 0) {
            throw new Error(`Unknown project: ${project.id}`);
        }
        const normalized = normalizePath(project.path);
        const key = await pathIdentity(normalized);
        const duplicateChecks = await Promise.all(
            projects.map(async (item) => item.id !== project.id && (await pathIdentity(item.path)) === key),
        );
        if (duplicateChecks.some(Boolean)) {
            throw new Error(`Project already exists: ${normalized}`);
        }
        projects[index] = { ...project, name: project.name.trim(), path: normalized, tags: cleanTags(project.tags) };
        await this.store.replaceProjects(projects);
    }

    async remove(id: string): Promise<boolean> {
        return this.mutate(() => this.removeProject(id));
    }

    private async removeProject(id: string): Promise<boolean> {
        const projects = await this.projects();
        const remaining = projects.filter((project) => project.id !== id);
        if (remaining.length === projects.length) {
            return false;
        }
        await this.store.replaceProjects(remaining);
        return true;
    }

    async markOpened(project: ProjectItem): Promise<void> {
        await this.update({ ...project, lastOpenedAt: Date.now() });
    }

    search(items: ProjectItem[], query: string, requiredTags: string[] = []): ProjectItem[] {
        const needles = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        return items.filter((project) => {
            const values = [project.name, project.path, ...project.tags].map((value) => value.toLocaleLowerCase());
            return (
                requiredTags.every((tag) => project.tags.includes(tag)) &&
                needles.every((needle) => values.some((value) => value.includes(needle)))
            );
        });
    }

    sort(items: ProjectItem[], sortBy: SortBy, query = ''): ProjectItem[] {
        const copy = [...items];
        if (query.trim()) {
            return copy.sort(
                (a, b) =>
                    score(b, query) - score(a, query) ||
                    Number(b.favorite) - Number(a.favorite) ||
                    (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) ||
                    compare(a.name, b.name),
            );
        }
        if (sortBy === 'PATH') {
            return copy.sort((a, b) => compare(a.path, b.path));
        }
        if (sortBy === 'RECENT') {
            return copy.sort((a, b) => (b.lastOpenedAt ?? -1) - (a.lastOpenedAt ?? -1) || compare(a.name, b.name));
        }
        return copy.sort((a, b) => compare(a.name, b.name) || compare(a.path, b.path));
    }

    async import(
        projectsToImport: Array<Omit<ProjectItem, 'id' | 'lastOpenedAt'>>,
        updateExisting: boolean,
    ): Promise<{ added: number; updated: number; skipped: number; failed: number }> {
        return this.mutate(() => this.importProjects(projectsToImport, updateExisting));
    }

    private async importProjects(
        projectsToImport: Array<Omit<ProjectItem, 'id' | 'lastOpenedAt'>>,
        updateExisting: boolean,
    ): Promise<{ added: number; updated: number; skipped: number; failed: number }> {
        const projects = await this.projects();
        const result = { added: 0, updated: 0, skipped: 0, failed: 0 };
        const seen = new Set<string>();
        for (const request of projectsToImport) {
            const normalized = normalizePath(request.path);
            if (seen.has(normalized)) {
                result.skipped++;
                continue;
            }
            seen.add(normalized);
            if (
                !(await fs.stat(normalized).then(
                    (value) => value.isDirectory(),
                    () => false,
                )) ||
                !request.name.trim()
            ) {
                result.failed++;
                continue;
            }
            const existing = projects.find((project) => normalizePath(project.path) === normalized);
            if (existing && !updateExisting) {
                result.skipped++;
                continue;
            }
            if (existing) {
                projects[projects.indexOf(existing)] = {
                    ...existing,
                    name: request.name.trim(),
                    tags: cleanTags(request.tags),
                    favorite: request.favorite,
                };
                result.updated++;
            } else {
                projects.push({
                    ...request,
                    id: randomUUID(),
                    path: normalized,
                    name: request.name.trim(),
                    tags: cleanTags(request.tags),
                    lastOpenedAt: null,
                });
                result.added++;
            }
        }
        if (result.added || result.updated) {
            await this.store.replaceProjects(projects);
        }
        return result;
    }

    private async mutate<T>(action: () => Promise<T>): Promise<T> {
        const mutation = this.mutationQueue.then(action);
        this.mutationQueue = mutation.then(
            () => undefined,
            () => undefined,
        );
        return mutation;
    }
}

export function normalizePath(value: string): string {
    return path.resolve(value);
}

async function pathIdentity(value: string): Promise<string> {
    const normalized = normalizePath(value);
    const real = await fs.realpath(normalized).catch(() => normalized);
    return process.platform === 'win32' ? real.toLocaleLowerCase() : real;
}

export function containsPath(parent: string, candidate: string): boolean {
    const relative = path.relative(normalizePath(parent), normalizePath(candidate));
    return (
        relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

export async function duplicateDirectory(source: string): Promise<string> {
    let suffix = 1;
    let target: string;
    do {
        target = `${source}-${suffix++}`;
    } while (
        await fs.stat(target).then(
            () => true,
            () => false,
        )
    );
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
    return target;
}

function score(project: ProjectItem, query: string): number {
    return query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .reduce((total, needle) => {
            const name = project.name.toLocaleLowerCase();
            if (name.startsWith(needle)) {
                return total + 100;
            }
            if (name.includes(needle)) {
                return total + 70;
            }
            if (project.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))) {
                return total + 45;
            }
            if (project.path.toLocaleLowerCase().includes(needle)) {
                return total + 25;
            }
            return total;
        }, 0);
}

function compare(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
}
