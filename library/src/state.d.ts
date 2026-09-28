export function stateHome(): string;
export function isPrivateStatePath(target: string): Promise<boolean>;
export interface StateLocation { root: string; directory: string; exists: boolean; owner: { format: 'atlas.state/1'; root: string } | null }
export function resolveState(root: string, options?: { create?: boolean }): Promise<StateLocation>;
