export function stateHome(): string;
export function isPrivateStatePath(target: string): Promise<boolean>;
export interface StateLocation { root: string; directory: string; exists: boolean; owner: { format: 'atlas.state/1'; root: string } | null }
export function resolveState(root: string, options?: { create?: boolean }): Promise<StateLocation>;
/**
 * Whether the private state of an Atlas can be used, as far as that is known without creating anything; it creates
 * nothing. Resolves as `resolveState(root)` does, also when the Atlas's folder is there, empty, without `owner.json`
 * (the first write adopts it). Refuses `INVALID_STATE_HOME` when `ATLAS_STATE_HOME` is set and not absolute;
 * `UNSAFE_STATE` when the part of the state path that exists holds a symbolic link or a regular file, or when the state
 * lies inside the Atlas; `STATE_OWNER` when `owner.json` is not valid UTF-8 JSON naming this Atlas, or the folder holds
 * other files without it. A root that does not exist is refused as reading it refuses (`ENOENT`), and one that is not a
 * directory with `UNSAFE_PATH`.
 */
export function checkStateLocation(root: string): Promise<StateLocation>;
