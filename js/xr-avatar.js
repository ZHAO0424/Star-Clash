import * as THREE from 'three';

function skin(color, roughness = 0.59, emissive = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, emissive, emissiveIntensity: 0.46 });
}

function part(group, geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function capsule(group, radius, length, material, x, y, z, rx = Math.PI / 2) {
  const mesh = part(group, new THREE.CapsuleGeometry(radius, length, 3, 8), material, x, y, z);
  mesh.rotation.x = rx;
  return mesh;
}

export class XROpponentAvatar {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'xr:remote-player';
    this.root.visible = false;
    const shell = skin(0xbfb1aa);
    const strap = skin(0x36304a);
    const highlight = skin(0xf0bb92);
    const visor = skin(0x3a2551, 0.24);
    const light = skin(0xffa267, 0.35, 0xe5633f);

    const head = new THREE.Group();
    head.name = 'opponent headset';
    const face = part(head, new THREE.SphereGeometry(1, 16, 12), shell, 0, -0.018, 0.008);
    face.scale.set(0.084, 0.105, 0.084);
    const frame = capsule(head, 0.039, 0.112, strap, 0, 0.005, -0.061, 0);
    frame.rotation.z = Math.PI / 2;
    frame.scale.z = 0.73;
    const glass = capsule(head, 0.027, 0.117, visor, 0, 0.009, -0.086, 0);
    glass.rotation.z = Math.PI / 2;
    glass.scale.z = 0.70;
    part(head, new THREE.BoxGeometry(0.128, 0.006, 0.003), light, 0, 0.021, -0.106);
    for (const sign of [-1, 1]) {
      part(head, new THREE.BoxGeometry(0.021, 0.032, 0.119), strap, sign * 0.079, 0.009, 0.005);
      part(head, new THREE.SphereGeometry(0.011, 9, 6), highlight, sign * 0.071, -0.039, 0.009);
    }

    const glove = skin(0xb58372);
    const pad = skin(0x54415c);
    const makeHand = side => {
      const group = new THREE.Group();
      group.name = side < 0 ? 'opponent left glove' : 'opponent right glove';
      const palm = part(group, new THREE.SphereGeometry(1, 12, 8), glove, 0, 0, -0.039);
      palm.scale.set(0.043, 0.019, 0.057);
      part(group, new THREE.BoxGeometry(0.065, 0.031, 0.031), strap, 0, 0, 0.004);
      const plate = part(group, new THREE.SphereGeometry(1, 12, 8), pad, 0, 0.015, -0.043);
      plate.scale.set(0.032, 0.009, 0.036);
      const fingers = [];
      for (const [i, length] of [0.037, 0.047, 0.043, 0.034].entries()) {
        const finger = new THREE.Group();
        finger.position.set((i - 1.5) * 0.019, 0, -0.075);
        group.add(finger);
        const r = 0.0084;
        capsule(finger, r, length - 2 * r, glove, 0, 0, -length / 2);
        fingers.push(finger);
      }
      const thumb = new THREE.Group();
      thumb.position.set(side * 0.037, -0.002, -0.032);
      thumb.rotation.y = -side * 0.72;
      group.add(thumb);
      capsule(thumb, 0.012, 0.026, glove, 0, 0, -0.02);
      group.userData.fingers = fingers;
      group.userData.thumb = thumb;
      return group;
    };
    this.parts = [head, makeHand(-1), makeHand(1)];
    this.targets = this.parts.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }));
    for (const model of this.parts) {
      model.visible = false;
      model.userData.fade = 0;
      const instanceMaterials = new Map();
      model.traverse(object => {
        if (!object.isMesh) return;
        if (!instanceMaterials.has(object.material)) {
          const material = object.material.clone();
          material.transparent = true;
          instanceMaterials.set(object.material, material);
        }
        object.material = instanceMaterials.get(object.material);
      });
      model.userData.fadeMaterials = [...instanceMaterials.values()];
      this.root.add(model);
    }
  }

  hide() {
    this.root.visible = false;
    for (const part of this.parts) {
      part.visible = false;
      part.userData.fade = 0;
    }
  }

  update(pose, dt, planarScale = 1, seatOffset = 0, mayShow = () => true) {
    const blend = 1 - Math.exp(-Math.max(0, dt) * 19);
    this.parts.forEach((part, index) => {
      const data = pose?.[index];
      const { p, q } = this.targets[index];
      if (data) {
        p.fromArray(data);
        p.x *= planarScale;
        p.z = p.z * planarScale + seatOffset;
      }
      const showing = Boolean(data && mayShow(p, index));
      if (showing) {
        q.fromArray(data, 3).normalize();
        const amount = part.visible ? blend : 1;
        part.position.lerp(p, amount);
        part.quaternion.slerp(q, amount);
        if (index) {
          const curl = data[7] ? -1.02 : -0.10;
          for (const finger of part.userData.fingers) finger.rotation.x = THREE.MathUtils.lerp(finger.rotation.x, curl, amount);
          part.userData.thumb.rotation.x = THREE.MathUtils.lerp(part.userData.thumb.rotation.x, data[7] ? -.58 : -.08, amount);
        }
      }
      const fade = THREE.MathUtils.clamp(part.userData.fade + (showing ? 10 : -10) * dt, 0, 1);
      part.userData.fade = fade;
      part.visible = fade > 0;
      for (const mat of part.userData.fadeMaterials) {
        mat.opacity = fade;
        mat.depthWrite = fade >= .99;
      }
    });
    this.root.visible = this.parts.some(part => part.visible);
  }
}
