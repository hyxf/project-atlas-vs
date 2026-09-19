export interface BranchOption {
    ref: string;
    label: string;
    type: 'Local' | 'Remote';
}

export function parseBranchOptions(output: string, current: string): BranchOption[] {
    const currentRef = `refs/heads/${current}`;
    return output
        .split('\n')
        .flatMap((line): BranchOption[] => {
            const [ref, label, symbolicTarget] = line.split('\0');
            if (!ref || !label || ref === currentRef || symbolicTarget !== '') {
                return [];
            }
            return [{ ref, label, type: ref.startsWith('refs/remotes/') ? 'Remote' : 'Local' }];
        })
        .sort((left, right) => left.type.localeCompare(right.type) || left.label.localeCompare(right.label));
}

export function classifyChangedPaths(paths: string[], ...outputs: string[]): Set<string> {
    const changedFiles = outputs.flatMap((output) => output.split('\n')).filter(Boolean);
    return new Set(
        paths.filter((entry) => changedFiles.some((file) => file === entry || file.startsWith(`${entry}/`))),
    );
}
