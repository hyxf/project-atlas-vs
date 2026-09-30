import type { AICodeConfig } from './types';

export const CONFIG_FILE = '.aicode.json';
export const DEFAULT_GROUP = 'Default';

export type { AICodeConfig, ConfigLoadResult, ContextTarget } from './types';

export function defaultConfig(): AICodeConfig {
    return { activeGroup: DEFAULT_GROUP, groups: { [DEFAULT_GROUP]: [] } };
}

export function cloneConfig(config: AICodeConfig): AICodeConfig {
    return {
        activeGroup: config.activeGroup,
        groups: Object.fromEntries(Object.entries(config.groups).map(([name, paths]) => [name, [...paths]])),
    };
}
