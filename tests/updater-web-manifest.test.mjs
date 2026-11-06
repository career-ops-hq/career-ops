/**
 * updater-web-manifest.test.mjs — apply must include the tracked web package.
 */
import { SYSTEM_PATHS } from '../lib/update-manifest.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\n🧪 Testing updater coverage for web/...');

const coversWebPackage = SYSTEM_PATHS.some((path) => (
  path === 'web/' || path === 'web/package.json'
));

if (coversWebPackage) {
  pass('SYSTEM_PATHS includes web/package.json');
} else {
  fail('SYSTEM_PATHS excludes web/, so apply cannot update web/package.json');
}
