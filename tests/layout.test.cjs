'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLayout, dimensions, place, edgeAfterMove, publicLayout } = require('../desktop/layout.cjs');

test('defaults and normalization derive orientation from edge', () => {
  assert.deepEqual(publicLayout(normalizeLayout()), { orientation: 'horizontal', edge: 'top', scale: 0.72 });
  assert.equal(normalizeLayout({ edge: 'right', orientation: 'horizontal' }).orientation, 'vertical');
  assert.equal(normalizeLayout({ edge: 'free', orientation: 'vertical' }).orientation, 'horizontal');
  assert.equal(normalizeLayout({ edge: 'bad', scale: 3, x: NaN, y: Infinity }).edge, 'top');
  assert.equal(normalizeLayout({ scale: 3 }).scale, 0.72);
});

test('geometry uses each display dimension and requested ratio', () => {
  for (const [width, height] of [[800, 600], [1366, 768], [1920, 1080], [3840, 2160]]) {
    for (const scale of [0.6, 0.72, 0.84]) {
      for (const edge of ['top', 'left']) {
        const layout = normalizeLayout({ edge, scale });
        const size = dimensions({ width, height }, layout);
        const vertical = edge === 'left';
        const available = vertical ? height : width;
        const expected = Math.round(Math.min(available - 32, Math.max(vertical ? 320 : 480, available * scale)));
        assert.equal(vertical ? size.height : size.width, expected + 20);
        assert.equal(vertical ? size.width : size.height, 60);
      }
    }
  }
});

test('docking and free positions clamp inside negative-coordinate work areas', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1040 };
  for (const edge of ['top', 'left', 'right', 'bottom', 'free']) {
    for (const center of [{ x: -99999, y: -99999 }, { x: 99999, y: 99999 }, { x: -960, y: 320 }]) {
      const bounds = place(area, normalizeLayout({ edge }), center);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width);
      assert.ok(bounds.y + bounds.height <= area.y + area.height);
      if (edge === 'left') assert.equal(bounds.x, area.x);
      if (edge === 'right') assert.equal(bounds.x + bounds.width, area.x + area.width);
      if (edge === 'top') assert.equal(bounds.y, area.y);
      if (edge === 'bottom') assert.equal(bounds.y + bounds.height, area.y + area.height);
    }
  }
});

test('saved free coordinates are respected and constrained', () => {
  const area = { x: 100, y: 50, width: 1280, height: 720 };
  const result = place(area, normalizeLayout({ edge: 'free', x: 200, y: 180 }));
  assert.equal(result.x, 200); assert.equal(result.y, 180);
  const clamped = place(area, normalizeLayout({ edge: 'free', x: -9000, y: -9000 }));
  assert.equal(clamped.x, area.x); assert.equal(clamped.y, area.y);
});

test('snap threshold and orientation-specific corner priority', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1080 };
  const bounds = { x: area.x + 32, y: 200, width: 500, height: 60 };
  assert.equal(edgeAfterMove(bounds, area, 'horizontal'), 'left');
  assert.equal(edgeAfterMove({ ...bounds, x: area.x + 33 }, area, 'horizontal'), 'free');
  const corner = { ...bounds, x: area.x, y: area.y };
  assert.equal(edgeAfterMove(corner, area, 'horizontal'), 'left');
  assert.equal(edgeAfterMove(corner, area, 'vertical'), 'top');
  assert.equal(edgeAfterMove({ ...bounds, x: area.x + area.width - 500 }, area, 'horizontal'), 'right');
  assert.equal(edgeAfterMove({ ...bounds, x: area.x + 400, y: 1020 }, area, 'vertical'), 'bottom');
});

test('public layout excludes coordinates and display identifiers', () => {
  assert.deepEqual(publicLayout(normalizeLayout({ edge: 'left', x: -500, y: 20, displayId: 99, scale: 0.84 })), { orientation: 'vertical', edge: 'left', scale: 0.84 });
});
