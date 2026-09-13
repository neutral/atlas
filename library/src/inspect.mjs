import { openAtlas } from './view.mjs';

export function inspectPoint(atlasPath, pointId, options = {}) {
  if (typeof pointId !== 'string' || !pointId.trim()) {
    throw new Error('An exact Point id is required.');
  }
  return openAtlas(atlasPath, options).inspectPoint(pointId);
}
