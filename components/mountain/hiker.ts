import * as THREE from "three";

/**
 * A small low-poly hiker built from primitives, with a procedural walk cycle,
 * jump pose and a paraglider canopy that unfolds while gliding.
 */
export type Hiker = {
  group: THREE.Group;
  /** Advance the animation. `speed` in world units/s, `state` drives the pose. */
  animate: (dt: number, speed: number, state: "ground" | "air" | "glide" | "swim") => void;
  setAccent: (hex: string) => void;
  dispose: () => void;
};

export const HIKER_HEIGHT = 1.75;

export function createHiker(accentHex: string): Hiker {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const mat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
    const m = new THREE.MeshLambertMaterial({ color, ...extra });
    disposables.push(m);
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T) => { disposables.push(g); return g; };

  const jacket = mat(accentHex);
  const pants = mat("#3b4250");
  const skin = mat("#e2b48f");
  const pack = mat("#6b5a3e");
  const boots = mat("#2b2522");
  const hat = mat("#2f3a2e");

  const body = new THREE.Group();
  group.add(body);

  // Torso
  const torso = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.24, 0.42, 4, 10)), jacket);
  torso.position.y = 1.12;
  body.add(torso);
  // Head + hat
  const head = new THREE.Mesh(geo(new THREE.SphereGeometry(0.17, 14, 10)), skin);
  head.position.y = 1.58;
  body.add(head);
  const brim = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 16)), hat);
  brim.position.y = 1.66;
  body.add(brim);
  const crown = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.13, 0.16, 0.13, 14)), hat);
  crown.position.y = 1.73;
  body.add(crown);
  // Backpack with bedroll
  const backpack = new THREE.Mesh(geo(new THREE.BoxGeometry(0.4, 0.5, 0.22)), pack);
  backpack.position.set(0, 1.15, -0.26);
  body.add(backpack);
  const roll = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.08, 0.08, 0.46, 10)), mat("#a1442f"));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 1.45, -0.27);
  body.add(roll);

  // Limbs pivot at the hip / shoulder
  const limb = (len: number, r: number, m: THREE.Material) => {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(geo(new THREE.CapsuleGeometry(r, len, 3, 8)), m);
    mesh.position.y = -len / 2 - r * 0.5;
    pivot.add(mesh);
    return pivot;
  };
  const legL = limb(0.55, 0.09, pants), legR = limb(0.55, 0.09, pants);
  legL.position.set(0.11, 0.84, 0); legR.position.set(-0.11, 0.84, 0);
  for (const leg of [legL, legR]) {
    const boot = new THREE.Mesh(geo(new THREE.BoxGeometry(0.14, 0.1, 0.24)), boots);
    boot.position.set(0, -0.78, 0.04);
    leg.add(boot);
    body.add(leg);
  }
  const armL = limb(0.42, 0.07, jacket), armR = limb(0.42, 0.07, jacket);
  armL.position.set(0.3, 1.38, 0); armR.position.set(-0.3, 1.38, 0);
  body.add(armL, armR);
  // Trekking pole in the right hand
  const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.015, 0.015, 1.15, 6)), mat("#9aa3ad"));
  pole.position.set(0, -0.55, 0.12);
  pole.rotation.x = 0.25;
  armR.add(pole);

  // Paraglider canopy (hidden unless gliding): an arc over the hiker, lines down to the harness
  const canopy = new THREE.Group();
  const wingMat = mat(accentHex, { side: THREE.DoubleSide, emissive: new THREE.Color(accentHex).multiplyScalar(0.35) });
  {
    const R = 3.2;
    const shape = new THREE.CylinderGeometry(R, R, 1.4, 28, 1, true, -Math.PI * 0.4, Math.PI * 0.8);
    shape.rotateX(-Math.PI / 2);            // arc spans left↔right, curving upward
    const wing = new THREE.Mesh(geo(shape), wingMat);
    wing.position.y = 1.5;
    canopy.add(wing);
    const lineMat = new THREE.LineBasicMaterial({ color: "#e6e6e6", transparent: true, opacity: 0.55 });
    disposables.push(lineMat);
    const pts: number[] = [];
    for (let k = -3; k <= 3; k++) {
      const a = (k / 3) * Math.PI * 0.38;
      pts.push(0, 0, 0, Math.sin(a) * R, 1.5 + Math.cos(a) * R, 0);
    }
    const lg = geo(new THREE.BufferGeometry());
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    canopy.add(new THREE.LineSegments(lg, lineMat));
    canopy.position.y = 1.45;
    canopy.scale.setScalar(0.001);
    canopy.visible = false;
    group.add(canopy);
  }

  group.traverse((o) => { o.castShadow = false; });

  let phase = 0;
  let canopyK = 0;
  let airK = 0;

  return {
    group,
    animate(dt, speed, state) {
      const moving = Math.min(1, speed / 6);
      phase += dt * (3 + speed * 0.85);
      const swing = Math.sin(phase) * 0.75 * moving;
      airK += ((state === "air" || state === "glide" ? 1 : 0) - airK) * Math.min(1, dt * 10);
      canopyK += ((state === "glide" ? 1 : 0) - canopyK) * Math.min(1, dt * 5);

      legL.rotation.x = swing * (1 - airK) + airK * -0.5;
      legR.rotation.x = -swing * (1 - airK) + airK * 0.3;
      armL.rotation.x = -swing * 0.8 * (1 - airK) + (state === "glide" ? -2.6 : airK * -0.9) * airK;
      armR.rotation.x = swing * 0.8 * (1 - airK) + (state === "glide" ? -2.6 : airK * -0.4) * airK;
      armL.rotation.z = 0.08 + airK * 0.3;
      armR.rotation.z = -0.08 - airK * 0.3;
      body.position.y = Math.abs(Math.sin(phase)) * 0.06 * moving * (1 - airK) + (state === "swim" ? -0.95 : 0);
      body.rotation.x = moving * 0.12 * (1 - airK) + (state === "swim" ? 0.9 : 0);

      const s = Math.max(0.001, canopyK);
      canopy.scale.setScalar(s);
      canopy.visible = canopyK > 0.01;
      canopy.rotation.z = Math.sin(phase * 0.15) * 0.06;
    },
    setAccent(hex) {
      jacket.color.set(hex);
      wingMat.color.set(hex);
      wingMat.emissive.set(hex).multiplyScalar(0.35);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
