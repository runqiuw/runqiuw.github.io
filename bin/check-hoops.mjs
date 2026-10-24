// Exercise the real hoops state machine and cannon-es world without a GPU or real-time waits.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { Box3, Matrix4, PerspectiveCamera, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const temp = mkdtempSync(join(tmpdir(), "check-hoops-"));
const random = Math.random,
  performanceDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "performance",
  );
const documentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
let now = 0,
  seed = 1;
class Element {
  children = [];
  dataset = {};
  style = {};
  events = new Map();
  hidden = false;
  textContent = "";
  className = "";
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
  }
  append(...children) {
    this.children.push(...children);
  }
  setAttribute() {}
  animate() {
    return { cancel() {} };
  }
  addEventListener(type, handler) {
    this.events.set(type, handler);
  }
  setPointerCapture() {}
  getBoundingClientRect() {
    return { width: 1440, height: 840 };
  }
}

try {
  const compile = (name, replacements = {}) => {
    let source = readFileSync(
      new URL(`../src/scripts/${name}.ts`, import.meta.url),
      "utf8",
    );
    for (const [from, to] of Object.entries(replacements))
      source = source.replaceAll(
        `from '${from}'`,
        `from ${JSON.stringify(to)}`,
      );
    const file = join(temp, `${name}.mjs`);
    writeFileSync(
      file,
      ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    );
    return pathToFileURL(file).href;
  };
  const configURL = compile("room.config");
  const { HOOPS, PLACEMENTS } = await import(configURL);
  const { createHoops, hoopsView } = await import(
    compile("room-hoops", {
      "./room.config": configURL,
      three: import.meta.resolve("three"),
      "cannon-es": import.meta.resolve("cannon-es"),
    })
  );
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const models = {};
  for (const name of ["ball_paper", "bottle", "ball_bouncy"]) {
    const bytes = readFileSync(
      new URL(`../public/room/assets/${name}.glb`, import.meta.url),
    );
    models[name] = (
      await loader.parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      )
    ).scene;
  }
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/room/assets/manifest.json", import.meta.url),
    ),
  );
  assert.equal(
    manifest.assets.court.three_radius,
    HOOPS.threeRadius,
    "Rug and scoring arc disagree",
  );
  const placedBox = (id) => {
    const p = PLACEMENTS.find((p) => p.id === id),
      [w, d, h] = manifest.assets[p.asset].size;
    const transform = new Matrix4()
      .makeRotationY(((p.yaw ?? 0) * Math.PI) / 180)
      .setPosition(p.at[0], p.z ?? 0, -p.at[1]);
    return new Box3(
      new Vector3(-w / 2, 0, -d / 2),
      new Vector3(w / 2, h, d / 2),
    ).applyMatrix4(transform);
  };
  const binBox = placedBox("bin"),
    courtBox = placedBox("court");
  const bedBox = placedBox("bed");
  bedBox.max.y = manifest.assets.bed_single.mattress_top;
  assert(!PLACEMENTS.some((p) => p.id === "cart"), "Cart is still placed");
  assert(
    -binBox.max.z > 0 && -binBox.max.z < 0.02,
    "Gap behind the bin can swallow a projectile",
  );
  assert.equal(binBox.min.y, courtBox.max.y, "Bin is sunk into the rug");
  assert(
    manifest.assets.court.size[0] <= 1.4 &&
      manifest.assets.court.size[1] <= 1.68,
    "Court was not reduced",
  );
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => now },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: (tag) => new Element(tag) },
  });
  Math.random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;

  const spots = [...HOOPS.spots];
  const furnitureBoxes = HOOPS.obstacles.map(placedBox);
  const fixture = async (reduceMotion = false, spot = null, kindIndex = 0) => {
    HOOPS.spots = spot ? [spot] : spots;
    now = 0;
    seed = 27;
    const scene = new Scene(),
      canvas = new Element(),
      frame = new Element(),
      bar = new Element(),
      views = [];
    const game = createHoops({
      scene,
      canvas,
      frame,
      bar,
      reduceMotion,
      bin: binBox,
      binR: manifest.assets.hoopbin.opening.r_inner,
      backboard: new Box3(
        new Vector3(2.58, binBox.max.y - 0.058, -0.002),
        new Vector3(3.42, binBox.max.y + 0.482, -0.002),
      ),
      room: { x0: 0, x1: 4.13, z0: -3.7, z1: 0 },
      boxes: [bedBox, courtBox, ...furnitureBoxes],
      load: async (name) => models[name].clone(true),
      dress: () => {},
      redraw: () => {},
      view: (from, target, spot) =>
        views.push({
          from: from.clone(),
          target: target.clone(),
          eye: spot.eye,
        }),
    });
    await Promise.resolve();
    const turn = bar.children.find((c) => c.className === "hoops-turn");
    const badge = frame.children.find((c) => c.className === "hoops-score");
    const toast = frame.children.find((c) => c.className === "hoops-basket");
    const powerMeter = frame.children.find(
      (c) => c.className === "hoops-power",
    );
    const tick = (seconds) => {
      let moving = false;
      for (let i = 0; i < Math.ceil(seconds * 120); i++) {
        now += 1000 / 120;
        moving = game.step(1 / 120);
      }
      return moving;
    };
    const pull = (dy, dx = 0, release = "pointerup") => {
      const event = {
        target: canvas,
        pointerId: 1,
        clientX: 720,
        clientY: 300,
        stopPropagation() {},
      };
      frame.events.get("pointerdown")({ ...event, type: "pointerdown" });
      frame.events.get("pointermove")({
        ...event,
        type: "pointermove",
        clientX: 720 + dx,
        clientY: 300 + dy,
      });
      const guide = scene.children.find((c) => c.isInstancedMesh);
      assert(
        guide.count > 0 && guide.count <= 16,
        "Guide is too short or reveals too many dots",
      );
      const hand = scene.children.find((c) => c.isGroup),
        matrix = new Matrix4(),
        point = new Vector3();
      const path = [];
      for (let i = 0; i < guide.count; i++) {
        guide.getMatrixAt(i, matrix);
        path.push(point.setFromMatrixPosition(matrix).clone());
      }
      const alpha = guide.geometry.getAttribute("aimOpacity");
      assert(
        alpha.getX(0) >= alpha.getX(guide.count - 1) &&
          alpha.getX(guide.count - 1) < 0.1,
        "Guide does not fade",
      );
      const powerText = powerMeter.children[0].textContent,
        origin = hand.position.clone();
      frame.events.get(release)({ ...event, type: release });
      return { path, powerText, origin };
    };
    game.enter();
    tick(0.8);
    for (let i = 0; i < kindIndex; i++) {
      pull(184, 250);
      tick(12);
    }
    assert.equal(turn.dataset.phase, "ready");
    const hand = scene.getObjectByName("hoops-hand");
    assert(
      hand.getObjectByName("held-outline"),
      "Held projectile has no outline",
    );
    const heldBounds = new Box3().setFromObject(hand);
    for (const box of furnitureBoxes)
      assert(
        !heldBounds.intersectsBox(box),
        "Held projectile intersects furniture",
      );
    return { game, scene, bar, views, turn, badge, toast, tick, pull };
  };
  // Every authored angle must be playable with all three actual projectile shapes, at a pull
  // reachable from the fixed on-screen hand. Also compare the displayed arc to the live flight.
  const makes = [],
    bankStyles = new Set(),
    calls = new Set();
  for (const spot of spots)
    for (let kindIndex = 0; kindIndex < 3; kindIndex++) {
      let successful;
      for (let power = 14; power <= 184; power += 2) {
        const f = await fixture(false, spot, kindIndex);
        const before = Number(f.badge.dataset.made),
          totalBefore = Number(f.badge.dataset.total);
        const pts = Number(f.turn.dataset.points);
        const { path, origin } = f.pull(power);
        const projectile = f.scene.children.filter((c) => c.isGroup).at(-1),
          actual = [origin];
        for (
          let i = 0;
          i < 240 && Number(f.badge.dataset.made) === before;
          i++
        ) {
          f.tick(1 / 120);
          actual.push(projectile.position.clone());
        }
        if (Number(f.badge.dataset.made) === before) continue;
        for (const point of path) {
          let error = Infinity;
          for (let j = 1; j < actual.length; j++) {
            const a = actual[j - 1],
              delta = actual[j].clone().sub(a);
            const t = Math.max(
              0,
              Math.min(
                1,
                point.clone().sub(a).dot(delta) /
                  Math.max(delta.lengthSq(), 1e-12),
              ),
            );
            error = Math.min(
              error,
              a.clone().addScaledVector(delta, t).distanceTo(point),
            );
          }
          assert(
            error < 0.004,
            `Preview differs from actual flight by ${error} m`,
          );
        }
        assert.equal(Number(f.badge.dataset.total) - totalBefore, pts);
        assert.equal(f.toast.dataset.points, String(pts));
        assert.match(f.toast.textContent, new RegExp("\\+" + pts + "$"));
        calls.add(f.toast.textContent);
        if (f.toast.dataset.style === "bank") {
          bankStyles.add(pts);
          assert.match(f.toast.textContent, /BANK|GLASS/);
        }
        const burst = f.scene.children.findLast((c) =>
          c.children?.some((m) => m.geometry?.type === "TorusGeometry"),
        );
        assert.equal(
          burst.children.filter((m) => m.geometry?.type === "TorusGeometry")
            .length,
          pts === 3 ? 2 : 1,
        );
        assert(
          !projectile.getObjectByName("held-outline"),
          "Released projectile kept its aiming outline",
        );
        const made = f.badge.dataset.made;
        f.tick(12);
        assert.equal(f.badge.dataset.made, made, "A basket counted twice");
        assert.equal(
          f.turn.dataset.kind,
          ["bottle", "bouncy", "paper"][kindIndex],
        );
        assert.equal(f.turn.dataset.phase, "ready");
        assert.equal(f.tick(1), false, "Settled game still requests rendering");
        successful = {
          spot: spot.id,
          kind: ["paper", "bottle", "bouncy"][kindIndex],
          pts,
          power,
          style: f.toast.dataset.style,
        };
        makes.push(successful);
        break;
      }
      assert(successful, `No make possible: ${spot.id} / ${kindIndex}`);
      console.log("Made basket:", successful);
    }
  // A bank can need a little more power than the first clean make. Find real glass entries,
  // rather than calling the celebration directly or counting a generic wall collision as a bank.
  for (const pts of [2, 3]) {
    bankSearch: for (const make of makes.filter((m) => m.pts === pts)) {
      if (bankStyles.has(pts)) break;
      const spot = spots.find((s) => s.id === make.spot),
        kindIndex = ["paper", "bottle", "bouncy"].indexOf(make.kind);
      for (
        let power = Math.max(14, make.power - 4);
        power <= Math.min(184, make.power + 32);
        power += 2
      ) {
        const f = await fixture(false, spot, kindIndex),
          before = Number(f.badge.dataset.made);
        f.pull(power);
        f.tick(2);
        if (
          Number(f.badge.dataset.made) > before &&
          f.toast.dataset.style === "bank"
        ) {
          bankStyles.add(pts);
          assert.match(f.toast.textContent, /BANK|GLASS/);
          console.log("Bank basket:", {
            spot: spot.id,
            kind: make.kind,
            pts,
            power,
          });
          break bankSearch;
        }
      }
    }
  }
  assert.deepEqual(
    [...bankStyles].sort(),
    [2, 3],
    "Bank shots not detected for both point values",
  );
  assert(calls.size >= 6, "Scoring callouts did not vary");
  // Fix the real 3D release point in the frame, including baseline and bed cameras; enough drag
  // travel remains below it even on a small phone, with no special screen-edge auto-aim.
  for (const spot of spots)
    for (const aspect of [1440 / 840, 390 / 784, 844 / 330]) {
      const from = new Vector3(3 + spot.at[0], spot.at[2], -0.15 - spot.at[1]);
      const q = hoopsView(
        from,
        new Vector3(3, binBox.max.y, -0.15),
        aspect,
        spot.eye,
        furnitureBoxes,
      );
      const camera = new PerspectiveCamera(q.fov, aspect, 0.05, 80);
      camera.position.copy(q.p);
      camera.lookAt(q.t);
      camera.updateMatrixWorld(true);
      const target = new Vector3(3, binBox.max.y, -0.15).project(camera);
      assert(
        Math.abs(target.x) < 0.85 && Math.abs(target.y) < 0.85,
        "Rim left the frame",
      );
      for (const box of furnitureBoxes)
        assert(
          !box.clone().expandByScalar(0.07).containsPoint(q.p),
          "Camera clips furniture",
        );
      const ndc = from.clone().project(camera);
      assert(
        Math.abs(ndc.x) < 1e-6 && Math.abs(ndc.y + 0.24) < 1e-6,
        "Hand position moves between views",
      );
      assert(
        0.62 + HOOPS.pullSpan < 0.9,
        "Not enough screen space for full power",
      );
      assert(
        q.p.y < 2.7 && q.p.x > 0 && q.p.x < 4.13 && q.p.z < 0 && q.p.z > -3.7,
        "Camera left the room",
      );
      assert(q.p.z >= -1.65 || q.p.x <= 3.25, "Camera clips the closet wall");
    }
  const f = await fixture();
  f.pull(100, 0, "pointercancel");
  assert.equal(f.badge.dataset.attempts, "0", "Cancel counted as a shot");
  const straight = f.pull(100, 0, "pointercancel"),
    steered = f.pull(100, 80, "pointercancel");
  assert.equal(straight.powerText, steered.powerText, "Steering changes power");
  f.pull(0, 100);
  assert.equal(f.badge.dataset.attempts, "0");
  // Resolve a throw on real contact, then keep that view throughout its result animation.
  const played = new Set();
  for (let i = 0; i < spots.length; i++) {
    played.add(f.turn.dataset.spot);
    const round = f.turn.dataset.round,
      beforeViews = f.views.length;
    f.pull(184, 200);
    assert.equal(f.turn.dataset.phase, "flight");
    assert.equal(f.views.length, beforeViews, "Camera changed at release");
    let contact = false;
    for (let t = 0; t < 1100; t++) {
      f.tick(1 / 120);
      if (f.turn.dataset.phase === "result") {
        contact = true;
        break;
      }
    }
    assert(contact, "No scene contact ever completed the shot");
    assert.notEqual(
      f.turn.dataset.outcome,
      "timeout",
      "An authored shot relied on the watchdog",
    );
    assert.equal(f.turn.dataset.round, round, "View changed before the result");
    // The next view must not start halfway through the visible result.
    f.tick(0.7);
    assert.equal(
      f.turn.dataset.round,
      round,
      "Result view disappeared too early",
    );
    for (let t = 0; t < 1300 && f.turn.dataset.phase !== "ready"; t++)
      f.tick(1 / 120);
    assert.equal(
      f.turn.dataset.phase,
      "ready",
      "Next angle never became ready",
    );
  }
  assert.equal(
    played.size,
    spots.length,
    "Shot deck repeated or omitted an angle",
  );
  f.game.leave();
  f.tick(20);
  assert.equal(f.tick(1), false);
  const chairShot = await fixture(false, {
    id: "chair-contact-regression",
    at: [-1.8, 3, 1.16],
  });
  chairShot.pull(14);
  for (let i = 0; i < 1000 && chairShot.turn.dataset.phase === "flight"; i++)
    chairShot.tick(1 / 120);
  assert.equal(
    chairShot.turn.dataset.outcome,
    "contact",
    "Furniture contact did not finish the shot",
  );
  const chairProjectile = chairShot.scene.children
    .filter((c) => c.isGroup)
    .at(-1);
  assert(
    chairProjectile.position.y > 0.8,
    "Shot waited for the floor instead of the chair",
  );
  chairShot.game.leave();
  chairShot.tick(20);
  // A successful shot stays in its original view until the complete celebration has played.
  const watch = await fixture(false, spots[0]);
  watch.pull(makes[0].power);
  for (let t = 0; t < 250 && watch.badge.dataset.made === "0"; t++)
    watch.tick(1 / 120);
  assert.equal(watch.badge.dataset.made, "1");
  const round = watch.turn.dataset.round;
  watch.tick(1.3);
  assert.equal(
    watch.turn.dataset.round,
    round,
    "Scoring animation was cut short",
  );
  watch.tick(0.2);
  assert.notEqual(
    watch.turn.dataset.round,
    round,
    "View did not follow the result",
  );
  watch.tick(12);
  assert.equal(watch.tick(1), false);
  const reduced = await fixture(true, spots[0]);
  reduced.pull(makes[0].power);
  reduced.tick(3);
  assert.equal(reduced.badge.dataset.made, "1");
  assert(
    !reduced.scene.children.some((c) =>
      c.children?.some((m) => m.geometry?.type === "TorusGeometry"),
    ),
    "Reduced motion emitted particles",
  );
  reduced.game.leave();
  reduced.tick(20);
  assert.equal(reduced.tick(1), false);
  console.log(
    "PASS: all authored shots playable, furniture collisions, held outline, contact/result timing, fixed screen origin and idle",
  );
} finally {
  Math.random = random;
  Object.defineProperty(globalThis, "performance", performanceDescriptor);
  if (documentDescriptor)
    Object.defineProperty(globalThis, "document", documentDescriptor);
  else delete globalThis.document;
  rmSync(temp, { recursive: true, force: true });
}
