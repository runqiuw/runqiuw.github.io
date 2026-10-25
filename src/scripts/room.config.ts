// The room scene: shell, where every Blender asset sits, colors, and the camera shot for each page
// section. Everything is in plan coordinates of the measured room, in meters:
//   x → right on the floor plan, y → "up" on the plan (the desk wall is y = 3.70), z → height.
// `yaw` turns an asset around the vertical axis in degrees. Assets face −y at yaw 0 (toward the
// room from the desk wall); 90 faces +x (away from the left wall), −90 faces −x, 180 faces +y.
// Assets come from public/room/assets/<asset>.glb (exported by bin/room-assets).

export type Plan = [x: number, y: number];
export type Role = 'frame' | 'fabric' | 'wood' | 'metal' | 'screen' | 'glass' | 'glow' | 'accent' | 'leaf' | 'digit' | 'print';

export interface Placement {
  /** Unique name, used by shots, lights and screens. */
  id: string;
  /** File name in public/room/assets/, without .glb. */
  asset: string;
  at: Plan;
  /** Height of the asset's bottom above the floor (desk top = 0.74). */
  z?: number;
  yaw?: number;
  /** Turn slightly in the asset's front plane (e.g. a casually hung paper poster). */
  tilt?: number;
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
  /** Lie it on its back (logo face up) instead of standing it up; `at` is then its middle. */
  lie?: boolean;
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
  /** Cap on the camera's distance, for shots inside the room: on a tall portrait screen the fit
   * would otherwise back the camera through the furniture behind it. */
  far?: number;
  /** Fit this horizontal half-width; widen the lens at `far` on portrait screens. */
  fitWidth?: boolean;
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
  // Light bars stay on the original panel top edges, 54.3 cm above the desk.
  { id: 'barL', asset: 'screenbar', at: [1.18, 3.528], z: 1.2826, on: 'monitorL' },
  { id: 'barR', asset: 'screenbar', at: [1.82, 3.528], z: 1.2826, on: 'monitorR' },
  // Fully on the desktop; monitor base plates sit behind the mat, under their uprights.
  { id: 'deskmat', asset: 'deskmat', at: [1.505, 3.235], z: 0.74, yaw: 180, bounce: false },
  { id: 'keyboard', asset: 'keyboard_v2', at: [1.5, 3.19], z: 0.742 },
  { id: 'mouse', asset: 'mouse_superlight', at: [1.76, 3.19], z: 0.742, yaw: 180 },
  { id: 'speaker', asset: 'jbl_flip6', at: [1.5, 3.47], z: 0.74 },
  { id: 'charger', asset: 'phone_charger', at: [0.94, 3.405], z: 0.74, colors: { screen: '#080b10' } },
  { id: 'tissues', asset: 'tissue_pack', at: [0.79, 3.16], z: 0.74, yaw: 4 },
  { id: 'tablet', asset: 'tablet', at: [2.005, 3.2], z: 0.74, yaw: -6, colors: { screen: '#080b10' } },
  { id: 'coffee', asset: 'coffee_mug', at: [1.05, 3.18], z: 0.74 },
  { id: 'chair', asset: 'chair', at: [1.506, 2.7], yaw: 180, colors: { fabric: '#ff6b5e', frame: NAVY } },
  // Fractal Design Era ITX on the desk's left end, front toward the room, rear ~3.8 cm off the wall.
  { id: 'pc', asset: 'pc_era', at: [0.745, 3.5], z: 0.74 },
  // Nixie clock (Madison time) on the back-right corner, clear of the right monitor.
  { id: 'clock', asset: 'nixie', at: [2.07, 3.51], z: 0.74 },
  { id: 'pinboard', asset: 'pinboard', at: [1.42, 3.7], z: 1.4, colors: { wood: '#c4925e' }, section: 'playground' },
  { id: 'tvstand', bounce: false, asset: 'tvstand', at: [2.86, 3.477], section: 'games' },
  { id: 'tv', asset: 'tv', at: [2.86, 3.55], z: 0.5, colors: { frame: BEZEL }, section: 'games' },
  { id: 'console', asset: 'console', at: [2.86, 3.355], z: 0.5, section: 'games' },
  { id: 'tvGamepad', asset: 'xbox_controller', at: [3.15, 3.365], z: 0.5, yaw: 10, section: 'games' },
  // On the floor of the stand's open middle cubby (its top is at 0.103 m).
  { id: 'gameA', asset: 'gamebox', at: [2.76, 3.52], z: 0.104, section: 'games' },
  { id: 'gameB', asset: 'gamebox', at: [2.86, 3.52], z: 0.104, section: 'games' },
  { id: 'gameC', asset: 'gamebox', at: [2.96, 3.52], z: 0.104, section: 'games' },
  // Rug instead of a beanbag: marks the game corner without blocking the closet door (it swings over it).
  { id: 'rug', bounce: false, asset: 'rug', at: [2.78, 2.6], section: 'games' },

  // Left wall: single bed, nightstand, bookshelf where the side table was.
  { id: 'shelf', asset: 'shelf', at: [0.15, 3.28], yaw: 90, colors: { wood: '#ffb36b' }, section: 'projects' },
  { id: 'windowA', asset: 'window', at: [-0.064, 1.235], z: 0.61, yaw: 90, wall: 'W', ao: false, colors: { frame: BLUE, fabric: '#e2e4ff' } },
  { id: 'windowB', asset: 'window', at: [-0.064, 2.385], z: 0.61, yaw: 90, wall: 'W', ao: false, colors: { frame: BLUE, fabric: '#e2e4ff' } },
  // Single bed for now; the queen (`bed`) stays in the asset library for later.
  // Bedding: a blue-grey fitted sheet and pillow (fabric).
  { id: 'bed', asset: 'bed_single', at: [1.044, 0.553], yaw: 90, colors: { frame: BLUE, wood: '#ff9a72', fabric: '#9aa5c8' } },
  // Bed-side south wall: loose gallery cluster, well clear of the hoop at x = 3 m.
  // All widths/heights are built into the Blender assets, in real metres.
  { id: 'bedTapestry', asset: 'wall_tapestry', at: [1.13, 0.005], z: 1.74, yaw: 180, wall: 'S', bounce: false },
  { id: 'posterMichigan', asset: 'poster_40x50', at: [2.09, 0.003], z: 1.79, yaw: 180, tilt: -1, wall: 'S', bounce: false },
  { id: 'posterSpurs', asset: 'poster_45x30', at: [2.17, 0.003], z: 1.365, yaw: 180, tilt: 1.3, wall: 'S', bounce: false },
  { id: 'posterGroupies', asset: 'poster_30x30', at: [1.24, 0.003], z: 1.30, yaw: 180, tilt: -1.5, wall: 'S', bounce: false },
  { id: 'posterLuo', asset: 'poster_30x30', at: [0.82, 0.003], z: 1.15, yaw: 180, tilt: 1, wall: 'S', bounce: false },
  { id: 'posterSun', asset: 'poster_30x30', at: [0.40, 0.003], z: 1.37, yaw: 180, tilt: -1.8, wall: 'S', bounce: false },
  { id: 'posterLipa', asset: 'poster_24x24', at: [0.265, 0.003], z: 1.96, yaw: 180, tilt: 1.5, wall: 'S', bounce: false },
  { id: 'posterCampus', asset: 'poster_a3', at: [1.78, 0.003], z: 1.01, yaw: 180, tilt: -1.2, wall: 'S', bounce: false },
  // School plushes lying on the bed below the pillow, tops toward the head (toys: physics in the room).
  { id: 'plushUmich', asset: 'plush_umich', at: [0.86, 0.3], z: 0.63, yaw: 98, lie: true },
  { id: 'plushUw', asset: 'plush_uw', at: [0.9, 0.8], z: 0.63, yaw: 84, lie: true },
  { id: 'plushSjtu', asset: 'plush_sjtu', at: [1.3, 0.55], z: 0.63, yaw: 95, lie: true },
  { id: 'nightstand', asset: 'nightstand', at: [0.188, 1.315], yaw: 90, colors: { frame: '#1fbf93', wood: '#1fbf93' } },
  // Floor plant against the left wall between the two windows; its leaves sway when the view turns.
  { id: 'plant', asset: 'plant', at: [0.3, 1.81], yaw: 90 },
  { id: 'bedLamp', asset: 'desklamp', at: [0.2, 1.315], z: 0.7188, yaw: -70, colors: { frame: '#ffc93c', metal: '#ffc93c' } },

  // The cart asset stays in the library; its placement is hidden to clear the court.
  // Trash-can basketball: a bin against the front wall past the foot of the bed, a backboard taped
  // on the wall above it (drawn in room.ts). Clicking it opens the `hoops` close-up.
  { id: 'court', asset: 'court', at: [3, 0.85], bounce: false },
  // ~1.25 cm behind the rim, too narrow for a projectile to fall between bin and wall.
  { id: 'bin', asset: 'hoopbin', at: [3, 0.15], z: 0.014, colors: { frame: '#ff8a3d', accent: '#fff4e6' } },
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

/**
 * Close-ups: the third level of views (page → room → close-up). In the full-screen room, clicking
 * `object` (or its label) flies to `shot`; "Back" returns to the room and "See on page" goes to
 * `section`. Each one has its own URL (`#room/<id>`). Objects without a close-up still go straight
 * to their section. A close-up's own interaction (dragging cards on the board) lives in room.ts;
 * the hoops game lives in room-hoops.ts, loaded the first time its close-up opens.
 */
export interface CloseUp {
  object: string;
  /** Other placements that open the same close-up when clicked in the room. */
  targets?: string[];
  /** Its page section; without one (the hoops bin) there is no "on the page" button. */
  section?: string;
  shot: Shot;
}
export const CLOSEUPS: Record<string, CloseUp> = {
  desk: {
    object: 'desk', section: 'research',
    targets: ['monitorL', 'monitorR', 'barL', 'barR', 'deskmat', 'keyboard', 'mouse', 'speaker', 'charger', 'tissues', 'tablet', 'coffee', 'pc', 'clock'],
    shot: { center: [1.42, 3.35, 1.0], r: 0.94, dir: [0, -1, 0.6], far: 3.0, fitWidth: true },
  },
  board: { object: 'pinboard', section: 'playground', shot: { frame: ['pinboard'], dir: [0, -1, 0.04], pad: 0.95 } },
  // Low, behind the throwing spot and a little to its side (so the arc of a throw reads), looking at
  // the bin and the taped backboard on the front wall.
  hoops: { object: 'bin', shot: { center: [3, 0.86, 0.48], r: 0.68, dir: [0, 1, 0.38], far: 2.5 } },
};

/** Mini court distances are in meters, scaled for this room; the asset's arc uses the same radius. */
export interface HoopsSpot {
  id: string;
  at: readonly [number, number, number];
  eye?: number;
  elevation?: number;
}
export const HOOPS = {
  bin: 'bin', threeRadius: 1.32, resultMs: 1400, cameraMs: 650, pullSpan: 0.22,
  obstacles: ['chair', 'desk', 'tvstand', 'tv', 'shelf', 'nightstand', 'plant'],
  // Offsets from the rim in plan coordinates, plus release height. Cycle through a shuffled deck
  // so baseline, close shots and the far side of the room all get played, without repeats.
  spots: [
    { id: 'inside', at: [0, 0.62, 0.66] },
    { id: 'door-baseline', at: [0.55, 0.25, 0.66] },
    { id: 'over-bed', at: [-1.5, 0.32, 1] },
    { id: 'rug', at: [0, 1.85, 0.66] },
    { id: 'elbow', at: [-0.75, 1.05, 0.7] },
    { id: 'chair', at: [-0.85, 2.3, 0.9] },
    { id: 'door-wing', at: [0.55, 0.75, 0.7] },
    { id: 'bed-wing', at: [-1.65, 1.2, 0.95] },
    { id: 'deep', at: [0.15, 2.5, 0.66] },
    { id: 'short-corner', at: [0.28, 0.52, 0.66] },
    { id: 'left-wing', at: [-0.9, 1.65, 0.8] },
    { id: 'short-wing', at: [-0.52, 0.68, 0.75] },
    { id: 'deep-desk', at: [-2, 2.7, 1.5], elevation: 40 },
    { id: 'deep-shelf', at: [-2.3, 2.7, 1.2], elevation: 40 },
    { id: 'deep-corner', at: [-1.95, 2.85, 1.35], elevation: 40 },
    { id: 'deep-tv', at: [-0.2, 2.95, 1.3], elevation: 42 },
    { id: 'bed-pillow', at: [-2.3, 0.28, 1.12] },
    { id: 'bed-middle', at: [-1.9, 0.6, 1.12] },
    { id: 'bed-foot', at: [-1.25, 0.65, 1.05] },
    { id: 'bed-low', at: [-1.65, 0.45, 1.1], eye: 1.4 },
    { id: 'floor-line', at: [-0.4, 1.1, 0.5], eye: 0.78 },
    { id: 'door-low', at: [0.7, 0.6, 0.52], eye: 0.82 },
    { id: 'rug-low', at: [0, 1.65, 0.6], eye: 1 },
    { id: 'bank-level', at: [-0.25, 0.9, 0.46], eye: 0.68 },
  ] satisfies HoopsSpot[],
};

/** Labels in the full-screen room: [section, title, placement the label sits on]. A close-up without
 * a page section is labeled by its close-up id instead. */
export const LABELS: [section: string, title: string, anchor: string][] = [
  ['desk', 'Desk', 'desk'],
  ['research', 'Research', 'monitorR'],
  ['projects', 'Projects', 'shelf'],
  ['games', 'Games', 'tv'],
  ['playground', 'Playground', 'pinboard'],
  ['hoops', 'Hoops', 'bin'],
];

/** Night lights sit at these placements (the lamp heads, the monitor light bars, the TV); the TV
 * also has an ambilight behind it. The lamps, the ambilight and the clock switch on and off with a
 * click; the light bars just follow the theme. */
export const LIGHTS = { lamp: 'lamp', bedside: 'bedLamp', screen: ['barL', 'barR'], tv: 'tv', ambilight: 'tv', clock: 'clock' };

/** Things that move: the plant's leaves sway and the tapestry ripples when the view turns; the
 * bed's pillow and the plushes on it (`toys`) can be picked up and thrown, and knock into each other. */
export const DECOR = { plant: 'plant', bed: 'bed', toys: ['plushUmich', 'plushUw', 'plushSjtu'], tapestry: 'bedTapestry' };

/** How far a cabinet door (an asset's `doors`) swings open, in degrees, per placement and door node.
 * The TV stand's right door stops at 70°: from 75° it runs into the closet door's frame. */
export const DOOR_OPEN: Record<string, Record<string, number>> = { tvstand: { door_L: 100, door_R: 70 } };

/** Pictures printed on an asset's `print` planes (the SJTU plush carries the emblem's inner field). */
export const PRINTS: Record<string, string | Record<string, string>> = {
  bedTapestry: '/room/prints/horse-tapestry.webp',
  posterMichigan: '/room/prints/michigan-poster.webp',
  posterSpurs: '/room/prints/spurs-poster.webp',
  posterGroupies: '/room/prints/groupies-poster.webp',
  posterLuo: '/room/prints/luo-poster.webp',
  posterSun: '/room/prints/sun-poster.webp',
  posterLipa: '/room/prints/lipa-poster.webp',
  posterCampus: '/room/prints/campus-poster.webp',
  tvGamepad: '/room/prints/xbox-controller.webp',
  deskmat: '/room/prints/logitech-deskmat.webp',
  keyboard: '/room/prints/keychron-v2.jpg',
  plushSjtu: '/room/prints/sjtu.webp',
  // The PC case's side perforation and bottom slits (planes `vents_*`, `slits_*`).
  pc: { vents: '/room/prints/era-vents.webp', slits: '/room/prints/era-slits.webp' },
};

/** Printed fabric keeps its image but has a matte, finely woven surface. */
export const FABRIC_PRINTS = ['bedTapestry'];

/** Steam starts just above the liquid inside the 95 mm mug. Distances are metres. */
export const COFFEE = { object: 'coffee', mouth: 0.084, width: 0.105, height: 0.18, fps: 24, minPixels: 9 };

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

/** Shelf miniatures keyed by the page's project id; other projects keep their framed cover. */
export const PROJECT_MODELS: Record<string, { asset: string; yaw?: number; lifeSize?: boolean }> = {
  'imu-localization': { asset: 'imu_devices', yaw: 5, lifeSize: true },
  sketchgenie: { asset: 'quest3', yaw: -10, lifeSize: true },
  'robotics-vehicle': { asset: 'robotics_vehicle', yaw: 5 },
  'robotic-arm': { asset: 'robotic_arm' },
  'transformable-rover': { asset: 'rover' },
  'telegram-chatbot': { asset: 'chatbot_robot', yaw: -8 },
};

/** Which placements show page content. */
export const SCREENS = {
  /** Research: left monitor shows the paper's figure or clip, right monitor its title. */
  paper: 'monitorL',
  paperInfo: 'monitorR',
  /** Games: the TV shows the game in view; one game case per game, in page order. */
  tv: 'tv',
  gameBoxes: ['gameA', 'gameB', 'gameC'],
  /** Projects: miniatures and framed covers stand on these shelf tiers. */
  shelf: 'shelf',
  shelfTiers: [1, 2, 3],
  /** Playground: cards pinned to the board. */
  pinboard: 'pinboard',
};
