import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VISUAL_THEME, isVisualTheme, storedVisualTheme, VISUAL_THEMES } from '../../src/lib/visual-theme.mjs';

test('visual themes accept the supported values and default invalid storage', () => {
  assert.deepEqual(VISUAL_THEMES, ['ocean', 'classic']);
  assert.equal(DEFAULT_VISUAL_THEME, 'ocean');
  assert.equal(isVisualTheme('ocean'), true);
  assert.equal(isVisualTheme('classic'), true);
  assert.equal(isVisualTheme('dark'), false);
  assert.equal(storedVisualTheme('classic'), 'classic');
  assert.equal(storedVisualTheme('ocean'), 'ocean');
  assert.equal(storedVisualTheme(null), 'ocean');
  assert.equal(storedVisualTheme(undefined), 'ocean');
  assert.equal(storedVisualTheme(''), 'ocean');
});
