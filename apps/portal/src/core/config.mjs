import fs from 'node:fs';
import { z } from 'zod';

const textLine = z.string().trim().min(1);
export const portalConfigSchema = z.strictObject({
  name: textLine,
  copyright: textLine.optional(),
  license: textLine.optional(),
});

/** @param {unknown} value */
export function validatePortalConfig(value) {
  const result = portalConfigSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid Portal configuration: ${result.error.message}`);
  }
  return result.data;
}

/** @param {string} configPath */
export function readPortalConfig(configPath) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read Portal configuration ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validatePortalConfig(value);
}
