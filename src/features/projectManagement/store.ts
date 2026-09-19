import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AtlasSettings, defaultSettings, ProjectItem } from './model';

interface StoredData extends Record<string, unknown> {
    schemaVersion?: unknown;
    projects?: unknown;
    settings?: unknown;
}

export class ProjectStore {
    readonly file: string;
    private source: StoredData = {};
    private validProjects: ProjectItem[] = [];
    private settingsValue: AtlasSettings = { ...defaultSettings };
    private loaded = false;
    private loadFailed = false;
    private modified = -1;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(file = path.join(os.homedir(), '.project-atlas', 'project.json')) {
        this.file = file;
    }

    async projects(force = false): Promise<ProjectItem[]> {
        await this.load(force);
        return this.validProjects.map((project) => ({ ...project, tags: [...project.tags] }));
    }

    async settings(force = false): Promise<AtlasSettings> {
        await this.load(force);
        return cloneSettings(this.settingsValue);
    }

    async replaceProjects(projects: ProjectItem[]): Promise<void> {
        const snapshot = cloneProjects(projects);
        await this.enqueueWrite(async () => {
            await this.load(true);
            await this.save(snapshot, cloneSettings(this.settingsValue));
        });
    }

    async replaceSettings(settings: AtlasSettings): Promise<void> {
        const snapshot = cloneSettings(settings);
        await this.enqueueWrite(async () => {
            await this.load(true);
            await this.save(cloneProjects(this.validProjects), snapshot);
        });
    }

    async ensureFile(): Promise<string> {
        await this.enqueueWrite(async () => {
            await this.load(true);
            if (!(await exists(this.file))) {
                await this.save(cloneProjects(this.validProjects), cloneSettings(this.settingsValue));
            }
        });
        return this.file;
    }

    private async load(force = false): Promise<void> {
        const stat = await fs.stat(this.file).catch(() => undefined);
        const modified = stat?.mtimeMs ?? -1;
        if (!force && this.loaded && modified === this.modified) {
            return;
        }
        if (!stat) {
            this.source = {};
            this.validProjects = [];
            this.settingsValue = { ...defaultSettings };
            this.loaded = true;
            this.loadFailed = false;
            this.modified = -1;
            return;
        }
        try {
            const source = JSON.parse(await fs.readFile(this.file, 'utf8')) as StoredData;
            if (!source || typeof source !== 'object' || Array.isArray(source)) {
                throw new Error('the root value must be an object');
            }
            this.source = source;
            this.validProjects = Array.isArray(source.projects)
                ? source.projects.map(parseProject).filter((item): item is ProjectItem => item !== undefined)
                : [];
            this.settingsValue = parseSettings(source.settings);
            this.loaded = true;
            this.loadFailed = false;
            this.modified = modified;
        } catch (error) {
            this.loadFailed = true;
            throw new Error(
                `Could not read ${this.file}; the last valid data is still in use. Fix the JSON and refresh.`,
                { cause: error },
            );
        }
    }

    private ensureWritable(): void {
        if (this.loadFailed) {
            throw new Error('project.json could not be read. Fix the file and refresh before making changes.');
        }
    }

    private async enqueueWrite(action: () => Promise<void>): Promise<void> {
        const write = this.writeQueue.then(action);
        this.writeQueue = write.catch(() => undefined);
        await write;
    }

    private async save(projectSnapshot: ProjectItem[], settingsSnapshot: AtlasSettings): Promise<void> {
        this.ensureWritable();
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const oldProjects = new Map<string, Record<string, unknown>>();
        if (Array.isArray(this.source.projects)) {
            for (const value of this.source.projects) {
                if (isRecord(value) && typeof value.id === 'string') {
                    oldProjects.set(value.id, value);
                }
            }
        }
        const projects: Record<string, unknown>[] = projectSnapshot.map((project) => ({
            ...(oldProjects.get(project.id) ?? {}),
            id: project.id,
            name: project.name,
            path: project.path,
            tags: project.tags,
            favorite: project.favorite,
            lastOpenedAt: project.lastOpenedAt ?? null,
        }));
        if (Array.isArray(this.source.projects)) {
            projects.push(
                ...(this.source.projects.filter((value) => parseProject(value) === undefined) as Record<
                    string,
                    unknown
                >[]),
            );
        }
        const oldSettings = isRecord(this.source.settings) ? this.source.settings : {};
        const settings: Record<string, unknown> = { ...oldSettings, ...settingsSnapshot };
        delete settings.selectedTagFilter;
        delete settings.selectedTagFilters;
        const output: StoredData = {
            ...this.source,
            schemaVersion: 4,
            projects,
            settings,
        };
        delete output.tags;
        const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
            await fs.rename(temporary, this.file);
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
        this.validProjects = cloneProjects(projectSnapshot);
        this.settingsValue = cloneSettings(settingsSnapshot);
        this.source = output;
        this.modified = (await fs.stat(this.file)).mtimeMs;
        this.loaded = true;
    }
}

function cloneProjects(projects: ProjectItem[]): ProjectItem[] {
    return projects.map((project) => ({ ...project, tags: [...project.tags] }));
}

function cloneSettings(settings: AtlasSettings): AtlasSettings {
    return { ...settings };
}

function parseProject(value: unknown): ProjectItem | undefined {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        !value.id ||
        typeof value.path !== 'string' ||
        !value.path
    ) {
        return undefined;
    }
    return {
        id: value.id,
        name: typeof value.name === 'string' ? value.name : '',
        path: path.resolve(value.path),
        tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        favorite: value.favorite === true,
        lastOpenedAt: typeof value.lastOpenedAt === 'number' ? value.lastOpenedAt : null,
    };
}

function parseSettings(value: unknown): AtlasSettings {
    const source = isRecord(value) ? value : {};
    return {
        defaultOpenMode: source.defaultOpenMode === 'NEW_WINDOW' ? 'NEW_WINDOW' : 'CURRENT_WINDOW',
        sortBy:
            source.sortBy === 'PATH' || source.sortBy === 'RECENT' || source.sortBy === 'RECENTLY_OPENED'
                ? source.sortBy === 'RECENTLY_OPENED'
                    ? 'RECENT'
                    : source.sortBy
                : 'NAME',
        selectedFilter: parseFilter(source.selectedFilter),
        selectedView: source.selectedView === 'TAGS' || source.selectedFilter === 'TAG' ? 'TAGS' : 'LIST',
        selectedListFilter: parseFilter(source.selectedListFilter ?? source.selectedFilter),
        tagProjectSpacing: clampNumber(source.tagProjectSpacing, 4),
        listProjectSpacing: clampNumber(source.listProjectSpacing, 4),
    };
}

function parseFilter(value: unknown): AtlasSettings['selectedFilter'] {
    return value === 'RECENT' || value === 'FAVORITES' ? value : 'ALL';
}

function clampNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' ? Math.max(0, Math.min(32, Math.round(value))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function exists(file: string): Promise<boolean> {
    return fs.stat(file).then(
        () => true,
        () => false,
    );
}
