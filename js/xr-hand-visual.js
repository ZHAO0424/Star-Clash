// 半透明手模型:WebXR Input Profiles 的 generic-hand(MIT,见 assets/hands/LICENSE.md)+ 菲涅尔边缘光
// 材质参数参照 VITURE SDK 的 M_VitureHands:白底、边缘色 (0.5, 0.72, 1)、基础不透明度 ≈0.35、不写深度。
// 状态:idle 常态 / pinch 捏合时边缘光变亮 / grab 抓着牌时边缘换成势力色
//
//   const visual = createHandVisual(xrHand);  // xrHand = renderer.xr.getHand(i)
//   xrHand.add(visual.object);
//   每帧 visual.update();按需 visual.setState('pinch') / visual.setOpacity(0.35)

import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const HAND_PATH = 'assets/hands/';   // 本地文件,不从 jsDelivr 在线拉(国内网络不稳、眼镜可能断网)
const RENDER_ORDER = 40;             // 在 XR 面板(20,写深度)之后画、读深度:被面板挡住的部分不画,在面板前面的盖上去
const RIM = new THREE.Color(0.5, 0.72, 1);
const RIM_STRENGTH = { idle: 1, pinch: 1.8, grab: 1.6 };

const factory = new XRHandModelFactory().setPath(HAND_PATH);

const vertexShader = /* glsl */`
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vNormal = normalize(normalMatrix * objectNormal);
    vView = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform float uRimStrength;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float fresnel = pow(1.0 - facing, 3.0);
    vec3 color = uBase * 0.55 + uRim * fresnel * uRimStrength;
    float alpha = clamp(uOpacity * (0.55 + fresnel * 1.6 * uRimStrength), 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

function makeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(1, 1, 1) },
      uRim: { value: RIM.clone() },
      uRimStrength: { value: RIM_STRENGTH.idle },
      uOpacity: { value: 0.35 },
    },
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false,
  });
}

export function createHandVisual(xrHand) {
  const object = factory.createHandModel(xrHand, 'mesh');
  const material = makeMaterial();
  let styled = false;
  let state = 'idle', tint = null;

  // XRHandMeshModel 没有加载完成回调:每帧看一眼,glb 到了就换材质
  function update() {
    if (styled) return;
    const mesh = object.getObjectByProperty('type', 'SkinnedMesh');
    if (!mesh) return;
    styled = true;
    mesh.material = material;
    mesh.renderOrder = RENDER_ORDER;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }

  // s:'idle' | 'pinch' | 'grab';color:grab 时的势力色(十六进制)
  function setState(s, color = null) {
    if (s === state && color === tint) return;
    state = s; tint = color;
    material.uniforms.uRimStrength.value = RIM_STRENGTH[s] ?? RIM_STRENGTH.idle;
    if (s === 'grab' && color !== null) material.uniforms.uRim.value.setHex(color);
    else material.uniforms.uRim.value.copy(RIM);
  }

  function setOpacity(opacity) {
    material.uniforms.uOpacity.value = opacity;
  }

  return { object, update, setState, setOpacity };
}
