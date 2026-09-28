import { startPortal } from '../../portal/src/server.mjs';

export const startEditor = (root, options = {}) => startPortal(root, { ...options, editable: true });
