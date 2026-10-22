// The room scene: shell, where every Blender asset sits, colors, and the camera shot for each page
// section. Everything is in plan coordinates of the measured room, in meters:
//   x → right on the floor plan, y → "up" on the plan (the desk wall is y = 3.70), z → height.
// `yaw` turns an asset around the vertical axis in degrees. Assets face −y at yaw 0 (toward the
// room from the desk wall); 90 faces +x (away from the left wall), −90 faces −x, 180 faces +y.
// Assets come from public/room/assets/<asset>.glb (exported by bin/room-assets).

export type Plan = [x: number, y: number];
export type Role = 'frame' | 'fabric' | 'wood' | 'metal' | 'screen' | 'glass' | 'glow' | 'accent' | 'leaf' | 'digit';

export interface Placement {
  /** Unique name, used by shots, lights and screens. */
  id: string;
  /** File name in public/room/assets/, without .glb. */
  asset: string;
  at: Plan;
  /** Height of the asset's bottom above the floor (desk top = 0.74). */
  z?: number;
  yaw?: number;
  scale?: number;
  /** Recolor every part with this material role. Parts without an entry keep their Blender colors. */
  colors?: Partial<Record<Role, string>>;
  /** Clicking this object in the full-screen room jumps to that page section. */
  section?: string;
  /** `false`: big furniture that neither bounces on hover nor takes a click (it's scenery). */
  bounce?: boolean;
  /** Rides on another placement (moves when it bounces), e.g. a light bar on its monitor. */
  on?: string;
  /** Set for things in or against a wall (doors, windows): they hide with that wall in the dollhouse view. */
  wall?: Wall['side'];
  /** `false` turns the baked ambient occlusion off (the blinds sit in a niche and bake too dark). */
  ao?: boolean;
}

export interface Wall {
  /** Which way the room is, seen from the wall: the wall hides when the camera is behind it. */
  side: 'N' | 'S' | 'E' | 'W';
  from: Plan;
  to: Plan;
  /** Holes for windows and doors: `span` along the wall's own axis (x for N/S, y for E/W), `z` from–to. */
  openings?: { span: [number, number]; z: [number, number] }[];
  /** Also hide whenever walls of this side hide (for walls in the middle of the view, like the closet front). */
  hideWith?: Wall['side'];
}

/** A camera shot frames the listed placements, looking from `dir` (plan x, plan y, up). */
export interface Shot {
  frame?: string[];
  /** Instead of `frame`: a fixed point and radius. */
  center?: [x: number, y: number, z: number];
  r?: number;
  dir: [x: number, y: number, up: number];
  /** Extra room around the framed objects (1 = tight). */
  pad?: number;
  /** Raise (or lower) the look-at point, in meters. */
  lift?: number;
}

export const SHELL = {
  height: 2.7,
  thickness: 0.15,
  floor: '#ffd2a0',
  wall: '#f4f2ff',
  wallW: '#ebe8ff',
  // Floor outline (the closet takes the top-right corner).
  outline: [[0, 0], [4.13, 0], [4.13, 1.8], [3.46, 1.8], [3.46, 3.7], [0, 3.7]] as Plan[],
  walls: [
    { side: 'S', from: [0, 0], to: [4.13, 0] },
    { side: 'E', from: [4.13, 0], to: [4.13, 1.8], openings: [{ span: [0.01, 1.0], z: [0, 2.1] }] }, // entry door
    { side: 'N', from: [4.13, 1.8], to: [3.46, 1.8], hideWith: 'E' }, // closet front
    { side: 'E', from: [3.46, 1.8], to: [3.46, 3.7], openings: [{ span: [1.99, 2.98], z: [0, 2.1] }] }, // closet door
    { side: 'N', from: [3.46, 3.7], to: [0, 3.7] },
    {
      side: 'W',
      from: [0, 3.7],
      to: [0, 0],
      openings: [
        // The cut sits inside the window frame (frame: z 0.61–2.43, sill top 0.64, jambs ±0.39–0.47
        // around the centre) so no wall face lines up with a frame face; coinciding faces flicker.
        { span: [0.8, 1.67], z: [0.62, 2.42] },
        { span: [1.95, 2.82], z: [0.62, 2.42] },
      ],
    },
  ] as Wall[],
};

const NAVY = '#2b3170';
/** Screens' bezels: near-black, so the monitors and TV read apart from the navy desk. */
const BEZEL = '#15172a';
const BLUE = '#3d5afe';

export const PLACEMENTS: Placement[] = [
  // Layout B — desk wall: floor lamp, desk (measured position), game corner up to the closet wall.
  // Floor lamp: base near the back wall next to the desk's left leg (far enough out that the head
  // clears the pinboard); the head arches over the desk.
  { id: 'lamp', asset: 'lamp', at: [0.55, 3.45], yaw: 90, colors: { frame: '#ffc93c', accent: '#ffc93c' } },
  { id: 'desk', bounce: false, asset: 'desk', at: [1.42, 3.354], colors: { wood: NAVY, frame: NAVY, metal: NAVY }, section: 'research' },
  { id: 'monitorL', asset: 'monitor', at: [1.18, 3.441], z: 0.74, colors: { frame: BEZEL }, section: 'research' },
  { id: 'monitorR', asset: 'monitor', at: [1.82, 3.441], z: 0.74, colors: { frame: BEZEL }, section: 'research' },
  // Light bars on the monitors' top edges (panel 54.3 cm up, its middle 8.7 cm behind the stand).
  { id: 'barL', asset: 'screenbar', at: [1.18, 3.528], z: 1.2826, on: 'monitorL' },
  { id: 'barR', asset: 'screenbar', at: [1.82, 3.528], z: 1.2826, on: 'monitorR' },
  { id: 'keyboard', asset: 'keyboard', at: [1.5, 3.19], z: 0.74, colors: { metal: '#c8cdf0' } },
  { id: 'chair', asset: 'chair', at: [1.506, 2.7], yaw: 180, colors: { fabric: '#ff6b5e', frame: NAVY } },
  // Nixie clock (Madison time): the monitors leave no gap between them, so it stands right of the keyboard.
  { id: 'clock', asset: 'nixie', at: [1.98, 3.22], z: 0.74 },
  { id: 'pinboard', asset: 'pinboard', at: [1.42, 3.7], z: 1.4, colors: { wood: '#c4925e' }, section: 'playground' },
  { id: 'tvstand', bounce: false, asset: 'tvstand', at: [2.86, 3.481], section: 'games' },
  { id: 'tv', asset: 'tv', at: [2.86, 3.55], z: 0.5, colors: { frame: BEZEL }, section: 'games' },
  { id: 'console', asset: 'console', at: [2.86, 3.355], z: 0.5, section: 'games' },
  { id: 'gameA', asset: 'gamebox', at: [2.76, 3.52], z: 0.05, section: 'games' },
  { id: 'gameB', asset: 'gamebox', at: [2.86, 3.52], z: 0.05, section: 'games' },
  { id: 'gameC', asset: 'gamebox', at: [2.96, 3.52], z: 0.05, section: 'games' },
  // Rug instead of a beanbag: marks the game corner without blocking the closet door (it swings over it).
  { id: 'rug', bounce: false, asset: 'rug', at: [2.78, 2.6], section: 'games' },

  // Left wall: single bed, nightstand, bookshelf where the side table was.
  { id: 'shelf', asset: 'shelf', at: [0.15, 3.28], yaw: 90, colors: { wood: '#ffb36b' }, section: 'projects' },
  { id: 'windowA', asset: 'window', at: [-0.064, 1.235], z: 0.61, yaw: 90, wall: 'W', ao: false, colors: { frame: BLUE, fabric: '#e2e4ff' } },
  { id: 'windowB', asset: 'window', at: [-0.064, 2.385], z: 0.61, yaw: 90, wall: 'W', ao: false, colors: { frame: BLUE, fabric: '#e2e4ff' } },
  // Single bed for now; the queen (`bed`) stays in the asset library for later.
  { id: 'bed', asset: 'bed_single', at: [1.044, 0.553], yaw: 90, colors: { frame: BLUE, wood: '#ff9a72' } },
  { id: 'nightstand', asset: 'nightstand', at: [0.188, 1.315], yaw: 90, colors: { frame: '#1fbf93', wood: '#1fbf93' } },
  // Floor plant against the left wall between the two windows; its leaves sway when the view turns.
  { id: 'plant', asset: 'plant', at: [0.3, 1.81], yaw: 90 },
  { id: 'bedLamp', asset: 'desklamp', at: [0.2, 1.315], z: 0.7188, yaw: -70, colors: { frame: '#ffc93c', metal: '#ffc93c' } },

  // Open floor and the door side: cart by the entry door (clear of its swing).
  { id: 'cart', asset: 'cart', at: [2.9, 0.35] },
  { id: 'door', bounce: false, asset: 'door', at: [4.1, 0.505], yaw: -90, wall: 'E', section: 'contact' },
  { id: 'closetDoor', asset: 'door', at: [3.43, 2.485], yaw: -90, wall: 'E' },
];

/** One shot per page section; `top` is the overview. */
export const SHOTS: Record<string, Shot> = {
  top: { center: [2.05, 1.85, 0.85], r: 3.35, dir: [1, -1, 0.9] },
  research: { frame: ['monitorL', 'monitorR'], dir: [0.2, -1, 0.55], pad: 1.2, lift: -0.04 },
  projects: { frame: ['shelf'], dir: [1, -0.45, 0.75], pad: 1.1 },
  games: { frame: ['tv', 'tvstand', 'rug'], dir: [0.3, -1, 0.7], pad: 1.05 },
  playground: { frame: ['pinboard'], dir: [0.12, -1, 0.08], pad: 1.2 },
  // No shot for `contact` for now: turning to the door at the end of the page was too big a jump,
  // so the camera stays on the previous section.
};

/** Labels in the full-screen room: [section, section title, placement the label sits on]. */
export const LABELS: [section: string, title: string, anchor: string][] = [
  ['research', 'Research', 'monitorR'],
  ['projects', 'Projects', 'shelf'],
  ['games', 'Games', 'tv'],
  ['playground', 'Playground', 'pinboard'],
];

/** Night lights sit at these placements (the lamp heads, the monitor light bars, the TV); the TV
 * also has an ambilight behind it. The lamps, the ambilight and the clock switch on and off with a
 * click; the light bars just follow the theme. */
export const LIGHTS = { lamp: 'lamp', bedside: 'bedLamp', screen: ['barL', 'barR'], tv: 'tv', ambilight: 'tv', clock: 'clock' };

/** Things that move on their own: the plant's leaves sway when the view turns. */
export const DECOR = { plant: 'plant' };

/**
 * Which way each lamp asset's head shines, in the asset's own Blender axes (x right, y back, z up;
 * the front is −y). The spot starts at the asset's `glow` part. Measured from the models:
 * the floor lamp's disc faces forward and 24° down; the desk lamp's cone opens to +x and ~37° down.
 * Lamps not listed shine straight down.
 */
export const LAMP_AIM: Record<string, [x: number, y: number, z: number]> = {
  lamp: [0, -0.914, -0.406],
  desklamp: [0.8, 0, -0.6],
  // The light bar's strip lights the desk in front of the monitor.
  screenbar: [0, -0.32, -0.95],
};

/** Windows get a sky outside (day/night) and a blind you can click to roll up or down. */
export const WINDOWS = ['windowA', 'windowB'];

/** Which placements show page content. */
export const SCREENS = {
  /** Research: left monitor shows the paper's figure or clip, right monitor its title. */
  paper: 'monitorL',
  paperInfo: 'monitorR',
  /** Games: the TV shows the game in view; one game case per game, in page order. */
  tv: 'tv',
  gameBoxes: ['gameA', 'gameB', 'gameC'],
  /** Projects: framed covers stand on these shelf tiers (heights from the shelf asset). */
  shelf: 'shelf',
  shelfTiers: [1, 2, 3],
  /** Playground: cards pinned to the board. */
  pinboard: 'pinboard',
};
