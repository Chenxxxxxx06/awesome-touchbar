'use strict';
const PADDING = 10;
const THICKNESS = 40;
const SNAP_DISTANCE = 32;
const SCALES = [0.6, 0.72, 0.84];
const EDGES = ['top', 'left', 'right', 'bottom', 'free'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeLayout(value = {}) {
  const edge = EDGES.includes(value.edge) ? value.edge : 'top';
  return {
    orientation: edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal',
    edge,
    scale: SCALES.includes(value.scale) ? value.scale : 0.72,
    displayId: Number.isInteger(value.displayId) ? value.displayId : null,
    x: Number.isFinite(value.x) ? value.x : null,
    y: Number.isFinite(value.y) ? value.y : null,
  };
}

function dimensions(area, layout) {
  const vertical = layout.orientation === 'vertical';
  const available = vertical ? area.height : area.width;
  const minimum = vertical ? 320 : 480;
  const length = Math.round(clamp(available * layout.scale, minimum, Math.max(40, available - 32)));
  return vertical
    ? { width: THICKNESS + PADDING * 2, height: length + PADDING * 2 }
    : { width: length + PADDING * 2, height: THICKNESS + PADDING * 2 };
}

function place(area, layout, center) {
  const size = dimensions(area, layout);
  let x = center ? center.x - size.width / 2 : (layout.x ?? area.x + (area.width - size.width) / 2);
  let y = center ? center.y - size.height / 2 : (layout.y ?? area.y + (area.height - size.height) / 2);
  if (layout.edge === 'top') y = area.y;
  if (layout.edge === 'bottom') y = area.y + area.height - size.height;
  if (layout.edge === 'left') x = area.x;
  if (layout.edge === 'right') x = area.x + area.width - size.width;
  return {
    x: Math.round(clamp(x, area.x, area.x + Math.max(0, area.width - size.width))),
    y: Math.round(clamp(y, area.y, area.y + Math.max(0, area.height - size.height))),
    ...size,
  };
}

function edgeAfterMove(bounds, area, orientation) {
  const distance = {
    left: bounds.x - area.x,
    right: area.x + area.width - bounds.x - bounds.width,
    top: bounds.y - area.y,
    bottom: area.y + area.height - bounds.y - bounds.height,
  };
  // Side edges take priority when dragging a horizontal bar into a corner;
  // top/bottom take priority when pulling a vertical bar out of that corner.
  const groups = orientation === 'vertical'
    ? [['top', 'bottom'], ['left', 'right']]
    : [['left', 'right'], ['top', 'bottom']];
  for (const group of groups) {
    const nearby = group.filter(edge => distance[edge] <= SNAP_DISTANCE)
      .sort((a, b) => Math.abs(distance[a]) - Math.abs(distance[b]));
    if (nearby.length) return nearby[0];
  }
  return 'free';
}

function publicLayout(layout) {
  return { orientation: layout.orientation, edge: layout.edge, scale: layout.scale };
}

module.exports = { normalizeLayout, dimensions, place, edgeAfterMove, publicLayout };
