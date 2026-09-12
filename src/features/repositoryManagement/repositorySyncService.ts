import { ProjectItem } from '../projectManagement/model';
import { RepositoryStore } from './store';
import { parseRepositoryIdentity } from './repositoryUrl';

export interface RepositorySyncResult {
    added: number;
    existing: number;
    failed: number;
}

export async function syncProjectRepositories(
    projects: readonly ProjectItem[],
    store: RepositoryStore,
    remoteUrlForProject: (project: ProjectItem) => Promise<string | undefined>,
): Promise<RepositorySyncResult> {
    const result: RepositorySyncResult = { added: 0, existing: 0, failed: 0 };
    for (const project of projects) {
        try {
            const url = (await remoteUrlForProject(project))?.trim();
            const identity = url && parseRepositoryIdentity(url);
            if (!url || !identity) {
                result.failed++;
                continue;
            }
            const saved = await store.addIfMissing({ ...identity, url, tags: [] });
            if (saved === 'added') {
                result.added++;
            } else {
                result.existing++;
            }
        } catch {
            result.failed++;
        }
    }
    return result;
}
