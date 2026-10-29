# Room performance and visual regression tools

Build with `npm run build` and serve the build with `npm run preview` before running these tools. The tools reach the room through `window.__roomTestHook`: they define it before the page loads, and `room.ts` calls it once before the first frame with the scene, camera, renderer, controls, openers, pop animations and a `draw(forceShadows = true)` function. Keep that function marking every shadow map for refresh when the shadow code changes, since the capture's stale-shadow check relies on it. They use a disposable Chrome profile. `URL` and `CHROME` select the preview and browser; `DPR=2`, `CPU_RATE=4` and `SOFTWARE=1` select other measurement configurations. Compare results on the same device, browser and settings. Instrumentation and tracing add overhead, so do not mix these measurements with an uninstrumented baseline.

## Performance

`PROFILE_OUT=/tmp/room-profile PROFILE_TRACE=1 npm run profile:room` saves `profile.json` and a Chrome trace. Every step reports draw totals and per-render medians for the canvas, shadow maps, mirror and other targets, plus shader links, texture uploads, long tasks, JS heap, process RSS and estimated WebGL allocations. Target classification starts at the first main room render; earlier offscreen draws are reported as other. The trace has step marks and renderer, worker and GPU-process events, but does not measure GPU execution time. The default trace includes top-level tasks and can be large; `PROFILE_TRACE_LIGHT=1` omits them. `PROFILE_QUICK=1` runs only the initial steps. `PROFILE_CALIBRATE=1` checks cached versus forced shadow rendering after the measured steps.

`PROFILE_THEME=dark` opens the page in the dark theme; `PROFILE_EARLY_SWITCH=1` switches theme as soon as the room is ready, before background preparation of the other theme can finish. Together with the default run (switch after the room has been open for a while) these cover the three theme-switch cases in `PERFORMANCE.md`. Every step also records pending WebGL errors, which is how earlier missing-material bugs showed up.

`PROFILE_FOOTPRINT=1` additionally runs macOS `footprint` for the disposable browser's renderer and GPU processes. Values are null if a process exits or permission is unavailable. Those calls can perturb timing; run memory and timing profiles separately when comparing performance.

The allocation ledger counts WebGL texture levels, buffers and renderbuffers using logical formats, sizes and sample counts. It reports unsupported allocations separately. When the default framebuffer is bound it reads `SAMPLES` and estimates multisampled color and depth/stencil plus one resolved color buffer. Driver padding, compression, extra copies, compositor allocations and physical GPU memory remain unknown; do not present the estimate as measured VRAM. `npm run check:room-memory` exercises the ledger.

## Visual comparison

Record the public OpenFreeMap resources once, using a fixed test location:

```sh
CAPTURE_MAP_CACHE=/tmp/room-map-cache CAPTURE_MAP_RECORD=1 CAPTURE_OUT=/tmp/room-before npm run capture:room
```

For the comparison run, reuse the same cache and omit `CAPTURE_MAP_RECORD`:

```sh
CAPTURE_MAP_CACHE=/tmp/room-map-cache CAPTURE_OUT=/tmp/room-after npm run capture:room
npm run compare:room-images -- /tmp/room-before /tmp/room-after /tmp/room-comparison.json
```

A missing cached map resource fails the replay. Without `CAPTURE_MAP_CACHE`, the quick fixture substitutes a fixed background and does not test map tiles or labels. `CAPTURE_SMOKE=1` runs a smaller set; `CAPTURE_HOOPS_ONLY=1` exercises three shot positions. Run full captures serially, since simultaneous GPU-heavy browsers can time out.

The fixture captures the entire room WebGL canvas in light and dark themes: page views, full room, board/desk/hoops, three shot positions, project hover, open cabinet/drawer, and close views of packages, graphics card, keyboard, monitor text, wall art and gun. It stores named detail crops and two 16-frame camera turns per theme, including a mirror view. The graphics-card label also has an explicitly rotated test-only view. It freezes the clock, video frame and random seed, waits for the camera, tracked objects and shader springs to settle, then normalizes settled sway and pop animations to their endpoints and refreshes the shadow maps. Previously thrown objects are hidden after settling to avoid nondeterministic physics residues; real shots and settling must still be checked with `check:room` and `check:hoops`. Controlled camera sequences are not a substitute for inspecting actual drag and spring motion.

Before each image the fixture also renders the frozen state twice, once with the room's own shadow caching and once with every shadow map refreshed, and records the differing pixels in `shadow-checks.json`. After the night views it drags the pillow off the bed with real mouse events and repeats the check. The pillow state is not part of the image comparison, because its physics ends in a slightly different place each run. Any stale shadow makes the capture exit nonzero.

Each capture has a manifest containing the device/browser settings, scene list, crop rectangles and map-cache digest. The comparator rejects different manifests and checks every RGBA channel of each full image, crop and motion frame. It exits nonzero on any difference. A passing comparison confirms equality for the captured states only; it cannot establish coverage of other devices, pixel densities or poses.
