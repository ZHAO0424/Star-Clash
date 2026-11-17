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

// 顶点 alpha 渐隐:沿某个轴从 from(不透明)到 to(全透明)平滑过渡(three r151+ 支持 4 分量顶点色的 alpha)
function fadeAlong(geometry, axis, from, to) {
  const pos = geometry.attributes.position, n = pos.count, col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = pos.getComponent(i, axis), k = THREE.MathUtils.clamp((v - from) / (to - from), 0, 1);
    col.set([1, 1, 1, 1 - k * k * (3 - 2 * k)], i * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geometry;
}
function gradientSkin(color) {
  const m = skin(color);
  m.vertexColors = true;
  m.transparent = true;
  m.depthWrite = false;          // 渐隐的部分不能挡住后面的东西
  m.userData.gradient = true;
  return m;
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
      // 腕带:包住掌根的椭圆筒(原来是方盒,硬边插进圆掌根看起来像穿模);后面接一截往肘部渐隐的前臂
      const cuff = part(group, new THREE.CylinderGeometry(1, 1, 0.026, 16, 1), strap, 0, 0, 0.012);
      cuff.rotation.x = Math.PI / 2;
      cuff.scale.set(0.033, 1, 0.022);
      const arm = new THREE.CylinderGeometry(0.03, 0.026, 0.16, 14, 6, true).rotateX(Math.PI / 2).translate(0, 0, 0.1);
      const forearm = part(group, fadeAlong(arm, 2, 0.03, 0.18), gradientSkin(0x54415c), 0, 0, 0);
      forearm.scale.set(1, 0.72, 1);
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
    // 身体:挂在头下方,只跟头的偏航转(低头 / 歪头不带动身体),往下渐渐隐去;不单独同步,由头的姿态推出来
    const body = new THREE.Group();
    body.name = 'opponent body';
    const torsoGeo = fadeAlong(new THREE.CapsuleGeometry(0.11, 0.2, 6, 18).translate(0, -0.35, 0), 1, -0.22, -0.52);   // 肩顶约在头心下 0.14,胸口往下渐隐
    part(body, torsoGeo, gradientSkin(0x6a5776), 0, 0, 0).scale.set(1.75, 1, 0.62);
    const collarGeo = fadeAlong(new THREE.TorusGeometry(0.075, 0.018, 8, 20).rotateX(Math.PI / 2).translate(0, -0.135, 0), 1, -0.2, -0.3);
    part(body, collarGeo, gradientSkin(0xbfb1aa), 0, 0, 0).scale.set(1, 1, 0.75);
    part(body, new THREE.CylinderGeometry(0.036, 0.042, 0.08, 12), skin(0xb58372), 0, -0.105, 0);   // 脖子
    this.body = body;
    this.bodyYaw = 0;

    this.parts = [head, makeHand(-1), makeHand(1), body];
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
      if (part === this.body) return;
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
        mat.depthWrite = fade >= .99 && !mat.userData.gradient;
      }
    });
    // 身体跟着头:位置 = 头,朝向只取头的偏航(平滑),透明度跟头
    const head = this.parts[0], body = this.body;
    if (head.visible) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion);
      let yaw = Math.atan2(fwd.x, fwd.z), d = yaw - this.bodyYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.bodyYaw += body.visible ? d * (1 - Math.exp(-Math.max(0, dt) * 6)) : d;
      body.position.copy(head.position);
      body.rotation.set(0, this.bodyYaw, 0);
    }
    body.visible = head.visible;
    for (const mat of body.userData.fadeMaterials) {
      mat.opacity = head.userData.fade;
      mat.depthWrite = head.userData.fade >= .99 && !mat.userData.gradient;
    }
    this.root.visible = this.parts.some(part => part.visible);
  }
}
