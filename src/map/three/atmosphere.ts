/**
 * Sky + aerial perspective: a camera-centred gradient dome (warm haze at
 * the horizon deepening to blue overhead) and distance fog in the horizon
 * haze colour, so the far world and the ocean apron dissolve into the same
 * air the sky starts from instead of ending at a hard edge.
 */
import {
  BackSide,
  Color,
  Fog,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { SKY_COLOR, SKY_ZENITH_COLOR } from './palette';
import { SUN_DIRECTION } from './lights';

export interface Atmosphere {
  /** Rescale fog and re-centre the sky on the camera (call on view changes). */
  update(cameraDistance: number, cameraPosition: Vector3): void;
  dispose(): void;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to the far plane
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // Warm forward-scatter glow around the sun's azimuth, near the horizon.
  float sunGlow = pow(max(dot(dir, uSunDir), 0.0), 6.0) * (1.0 - up);
  col += vec3(0.32, 0.22, 0.10) * sunGlow;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createAtmosphere(scene: Scene): Atmosphere {
  const haze = new Color(SKY_COLOR);
  scene.background = haze;
  const fog = new Fog(haze, 100, 500);
  scene.fog = fog;

  const geometry = new SphereGeometry(1, 32, 16);
  const material = new ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uHorizon: { value: new Color(SKY_COLOR) },
      uZenith: { value: new Color(SKY_ZENITH_COLOR) },
      uSunDir: { value: SUN_DIRECTION.clone() },
    },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new Mesh(geometry, material);
  sky.scale.setScalar(1000);
  sky.renderOrder = -1000; // first: everything else draws over it
  sky.frustumCulled = false;
  scene.add(sky);

  return {
    update(cameraDistance: number, cameraPosition: Vector3) {
      // Keep the near field crisp; let haze build toward the horizon.
      fog.near = cameraDistance * 1.35;
      fog.far = cameraDistance * 5.0;
      sky.position.copy(cameraPosition);
      sky.updateMatrixWorld();
    },
    dispose() {
      scene.remove(sky);
      geometry.dispose();
      material.dispose();
    },
  };
}
