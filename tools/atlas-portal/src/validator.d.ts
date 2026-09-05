declare module 'atlas-reference-validator' {
  export const RESOLVED_PROFILE: string;
  export function validateAtlas(path: string, options: { profile: string; specificationRevision: string }): {
    complete: boolean;
    valid: boolean;
    normalized: import('./core/types').NormalizedAtlas | null;
    diagnostics: { code: string; message: string }[];
  };
}
