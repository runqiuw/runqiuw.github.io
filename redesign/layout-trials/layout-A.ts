// @ts-nocheck: reference copy, not part of the build (NAVY/BLUE live in room.config.ts).
// Layout A (tried 2026-10-21, not used): game corner on the left wall where the side table was,
// bookshelf right of the desk. To try it, replace PLACEMENTS in src/scripts/room.config.ts with the
// block below and use these two shots in SHOTS:
//   projects: { frame: ['shelf'], dir: [0.3, -1, 0.35], pad: 1.1 },
//   games: { frame: ['tv', 'tvstand'], dir: [1, -0.3, 0.5], pad: 1.1 },

export const PLACEMENTS_A = [
  // Layout A — desk wall: floor lamp, desk (measured position), bookshelf up to the closet wall.
  { id: 'lamp', asset: 'lamp', at: [0.317, 3.3925], yaw: 90, colors: { frame: '#ffc93c', accent: '#ffc93c' } },
  { id: 'desk', asset: 'desk', at: [1.42, 3.354], colors: { wood: NAVY, frame: NAVY, metal: NAVY }, section: 'research' },
  { id: 'monitorL', asset: 'monitor', at: [1.18, 3.441], z: 0.74, colors: { frame: NAVY }, section: 'research' },
  { id: 'monitorR', asset: 'monitor', at: [1.82, 3.441], z: 0.74, colors: { frame: NAVY }, section: 'research' },
  { id: 'keyboard', asset: 'keyboard', at: [1.5, 3.19], z: 0.74, colors: { metal: '#c8cdf0' } },
  { id: 'chair', asset: 'chair', at: [1.506, 2.7], yaw: 180, colors: { fabric: '#ff6b5e', frame: NAVY } },
  { id: 'pinboard', asset: 'pinboard', at: [1.42, 3.7], z: 1.4, colors: { wood: BLUE }, section: 'playground' },
  { id: 'shelf', asset: 'shelf', at: [2.86, 3.55], colors: { wood: '#ffb36b' }, section: 'projects' },

  // Left wall: single bed, nightstand, game corner where the side table was (TV faces the room).
  { id: 'windowA', asset: 'window', at: [-0.064, 1.235], z: 0.61, yaw: 90, wall: 'W', colors: { frame: BLUE, fabric: '#e2e4ff' } },
  { id: 'windowB', asset: 'window', at: [-0.064, 2.385], z: 0.61, yaw: 90, wall: 'W', colors: { frame: BLUE, fabric: '#e2e4ff' } },
  // Single bed for now; the queen (`bed`) stays in the asset library for later.
  { id: 'bed', asset: 'bed_single', at: [1.044, 0.553], yaw: 90, colors: { frame: BLUE, wood: '#ff9a72' } },
  { id: 'nightstand', asset: 'nightstand', at: [0.188, 1.315], yaw: 90, colors: { frame: '#1fbf93', wood: '#1fbf93' } },
  { id: 'bedLamp', asset: 'desklamp', at: [0.2, 1.315], z: 0.7188, yaw: 60, colors: { frame: '#ffc93c', metal: '#ffc93c' } },
  { id: 'tvstand', asset: 'tvstand', at: [0.219, 2.3], yaw: 90, section: 'games' },
  { id: 'tv', asset: 'tv', at: [0.15, 2.3], z: 0.5, yaw: 90, colors: { frame: NAVY }, section: 'games' },
  { id: 'console', asset: 'console', at: [0.345, 2.3], z: 0.5, yaw: 90, section: 'games' },
  { id: 'gameA', asset: 'gamebox', at: [0.18, 2.2], z: 0.05, yaw: 90, section: 'games' },
  { id: 'gameB', asset: 'gamebox', at: [0.18, 2.3], z: 0.05, yaw: 90, section: 'games' },
  { id: 'gameC', asset: 'gamebox', at: [0.18, 2.4], z: 0.05, yaw: 90, section: 'games' },
  { id: 'beanbag', asset: 'beanbag', at: [0.95, 1.95], yaw: 70, section: 'games' },

  // Open floor and the door side: cart against the closet front, mirror by the entry door.
  { id: 'glasstable', asset: 'glasstable', at: [2.48, 0.67], yaw: -90, colors: { frame: NAVY } },
  { id: 'cart', asset: 'cart', at: [3.62, 1.6] },
  { id: 'mirror', asset: 'mirror', at: [4.057, 1.4], z: 0.0105, yaw: -90, wall: 'E', colors: { frame: NAVY } },
  { id: 'door', asset: 'door', at: [4.1, 0.505], yaw: -90, wall: 'E', section: 'contact' },
  { id: 'closetDoor', asset: 'door', at: [3.43, 2.485], yaw: -90, wall: 'E' },
];
