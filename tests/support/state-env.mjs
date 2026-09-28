import path from 'node:path';
import { fileURLToPath } from 'node:url';

const temporary = fileURLToPath(new URL('../../tmp/', import.meta.url));
const selected = process.env.ATLAS_STATE_HOME && path.resolve(process.env.ATLAS_STATE_HOME);
if (!selected?.startsWith(temporary)) process.env.ATLAS_STATE_HOME = path.join(temporary, 'test-state');
