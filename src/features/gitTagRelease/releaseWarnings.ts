import { ReleaseState } from './types';

export function releaseWarnings(state: ReleaseState, targetRemote: string): string[] {
    const warnings: string[] = [];
    if (!state.branch) {
        warnings.push('HEAD is detached; the tag is not associated with a local branch.');
    }
    if (state.hasUncommittedChanges) {
        warnings.push('The working tree contains uncommitted or untracked changes.');
    }
    if (state.branch && !state.trackedBranch) {
        warnings.push('The current branch has no tracking branch.');
    }
    if (state.trackedBranch && state.trackingRemote && state.trackingRemote !== targetRemote) {
        warnings.push(`The tracking branch belongs to a different remote: ${state.trackedBranch}.`);
    }
    if (state.ahead > 0) {
        warnings.push(
            `The current branch is ${state.ahead} commit(s) ahead of ${state.trackedBranch}; those commits may not be pushed.`,
        );
    }
    if (state.behind > 0) {
        warnings.push(`The current branch is ${state.behind} commit(s) behind ${state.trackedBranch}.`);
    }
    return warnings;
}
