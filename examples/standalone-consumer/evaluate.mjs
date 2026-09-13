// SPDX-License-Identifier: CC0-1.0 OR 0BSD
import path from 'node:path';
import { openAtlas, createEvaluatorRegistry, evaluateChecks } from '@neutral/atlas';
import { registrations, CHECK_ID } from './registered-anchor-content.mjs';

const [atlasPath, actorId] = process.argv.slice(2);
if (!atlasPath || !path.isAbsolute(atlasPath) || !actorId) throw new Error('Usage: node evaluate.mjs ABS_ATLAS_PATH ACTOR_ID');
const view = openAtlas(atlasPath);
if (view.status === 'ready' && !view.validation.normalized.checks.some((check) => check.id === CHECK_ID)) {
  console.error(JSON.stringify({ code: 'example.check-not-adopted', message: 'The custom Check has not been adopted. Review its Requirement before deliberately selecting it.' }));
  process.exitCode = 2;
} else {
  const run = await evaluateChecks(view, { registry: createEvaluatorRegistry(registrations), actor: { kind: 'tool', id: actorId } });
  console.log(JSON.stringify(run, null, 2));
  process.exitCode = run.status !== 'evaluated' ? 2 : run.evaluations.some((item) => item.outcome === 'fail') ? 1
    : run.evaluations.some((item) => item.outcome === 'unable') ? 2 : run.wholeAtlasCompliant ? 0 : 2;
}
