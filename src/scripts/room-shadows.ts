import { Box3, Frustum, Matrix4, Mesh, SpotLight, type DirectionalLight, type Material, type Scene } from 'three';

type ShadowLight = DirectionalLight | SpotLight;
type Entry = { matrix: Matrix4; box: Box3 | null; visible: boolean; geometry: unknown; version: number; signature: string };

/** Keep a conservative dirty set per light, including changes made while a light is off. */
export function roomShadows(scene: Scene, lights: ShadowLight[]) {
  const entries = new Map<Mesh, Entry>();
  const pending = new Set<ShadowLight>(lights);
  const lightState = new Map<ShadowLight, string>();
  const frustums = new Map<ShadowLight, Frustum>();
  const projection = new Matrix4();
  const shown = (object: Mesh) => {
    for (let p: typeof object | null = object; p; p = p.parent as typeof object | null) if (!p.visible) return false;
    return object.castShadow;
  };
  const materialSignature = (object: Mesh) => {
    const raw = (object.userData.ghost ?? object.material) as Material | Material[];
    return (Array.isArray(raw) ? raw : [raw]).map(m => `${m.visible}:${m.side}:${m.shadowSide}:${m.alphaTest}:${(m as Material & { map?: { uuid: string } | null }).map?.uuid ?? ''}`).join('|');
  };
  const signature = (light: ShadowLight) => {
    const camera = light.shadow.camera;
    const shape = light instanceof SpotLight
      ? [light.angle, light.distance, light.shadow.focus]
      : [light.shadow.camera.left, light.shadow.camera.right, light.shadow.camera.top, light.shadow.camera.bottom];
    return [...light.matrixWorld.elements, ...light.target.matrixWorld.elements, camera.near, camera.far,
      light.shadow.mapSize.x, light.shadow.mapSize.y, ...shape].join(',');
  };
  const updateFrustum = (light: ShadowLight) => {
    const camera = light.shadow.camera;
    camera.updateMatrixWorld();
    const frustum = frustums.get(light) ?? new Frustum();
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    frustums.set(light, frustum);
  };
  const observe = () => {
    scene.updateMatrixWorld(true);
    const boxes: Box3[] = [], seen = new Set<Mesh>();
    for (const light of lights) {
      const next = signature(light), previous = lightState.get(light);
      if (previous !== next) pending.add(light);
      lightState.set(light, next);
      if (!frustums.has(light)) updateFrustum(light);
    }
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      seen.add(object);
      const geometry = object.geometry, position = geometry.getAttribute('position');
      const version = (position?.version ?? 0) + (geometry.index?.version ?? 0);
      const visible = shown(object), sig = materialSignature(object), previous = entries.get(object);
      if (previous && previous.visible === visible && previous.geometry === geometry && previous.version === version && previous.signature === sig && previous.matrix.equals(object.matrixWorld)) return;
      if (previous?.box) boxes.push(previous.box);
      let box: Box3 | null = null;
      if (visible && position) {
        if (!geometry.boundingBox || previous?.geometry !== geometry || previous?.version !== version) geometry.computeBoundingBox();
        if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) box = geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      }
      if (box) boxes.push(box);
      entries.set(object, { matrix: object.matrixWorld.clone(), box, visible, geometry, version, signature: sig });
    });
    for (const [mesh, entry] of entries) if (!seen.has(mesh)) {
      if (entry.box) boxes.push(entry.box);
      entries.delete(mesh);
    }
    for (const light of lights) {
      if (pending.has(light)) continue;
      const frustum = frustums.get(light)!;
      if (boxes.some(box => frustum.intersectsBox(box))) pending.add(light);
    }
  };
  const invalidateAll = () => lights.forEach(light => pending.add(light));
  const needs = (light: ShadowLight) => pending.has(light) || !light.shadow.map;
  const rendered = (light: ShadowLight) => { pending.delete(light); updateFrustum(light); };
  return { observe, invalidateAll, needs, rendered };
}
