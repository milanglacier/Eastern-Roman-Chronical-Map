/**
 * The hall around the clockwork model: an astrolabe sun hanging over the
 * world (emissive core + slowly turning brass rings, like the titles), and
 * the PMREM environment that gives every metal its warm reflections.
 */
import {
  BackSide,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';

export interface Astrolabe {
  group: Group;
  /** World position of the sun core (the hall's key light source). */
  readonly center: Vector3;
  setNight(night: number): void;
  update(timeSeconds: number): void;
  dispose(): void;
}

export function createAstrolabe(center: Vector3, scale = 7): Astrolabe {
  const group = new Group();
  group.position.copy(center);
  const coreMat = new MeshBasicMaterial({ color: new Color(1.0, 0.72, 0.38).multiplyScalar(7), fog: false });
  const core = new Mesh(new SphereGeometry(0.42 * scale, 40, 24), coreMat);
  group.add(core);
  const haloMat = new MeshBasicMaterial({ color: new Color(1.0, 0.6, 0.25).multiplyScalar(1.4), transparent: true, opacity: 0.35, fog: false, depthWrite: false });
  const halo = new Mesh(new SphereGeometry(0.62 * scale, 32, 16), haloMat);
  group.add(halo);

  const brass = new MeshStandardMaterial({ color: 0xc9a45c, metalness: 1, roughness: 0.28, fog: false });
  const bronze = new MeshStandardMaterial({ color: 0x8a6a3e, metalness: 1, roughness: 0.4, fog: false });
  const rings: Array<{ pivot: Group; axis: Vector3; speed: number }> = [];
  const ringSpec: Array<[number, number, Vector3, number, MeshStandardMaterial]> = [
    [1.25, 0.05, new Vector3(0.2, 1, 0.1).normalize(), 0.05, brass],
    [1.55, 0.04, new Vector3(1, 0.3, 0).normalize(), -0.035, bronze],
    [1.9, 0.055, new Vector3(0.1, 0.4, 1).normalize(), 0.025, brass],
    [2.2, 0.03, new Vector3(0.7, 0.2, -0.6).normalize(), -0.018, bronze],
  ];
  const geoms: Array<TorusGeometry | SphereGeometry> = [];
  for (const [r, tube, axis, speed, material] of ringSpec) {
    const pivot = new Group();
    const g = new TorusGeometry(r * scale, tube * scale, 10, 160);
    geoms.push(g);
    const ring = new Mesh(g, material);
    pivot.add(ring);
    // A small "planet" riding each ring.
    const pg = new SphereGeometry(0.09 * scale, 16, 10);
    geoms.push(pg);
    const planet = new Mesh(pg, material);
    planet.position.set(r * scale, 0, 0);
    pivot.add(planet);
    pivot.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), axis);
    group.add(pivot);
    rings.push({ pivot, axis: new Vector3(0, 0, 1), speed });
  }
  return {
    group,
    center: center.clone(),
    setNight(night) {
      coreMat.color.setRGB(1.0, 0.72 - 0.2 * night, 0.38 + 0.4 * night).multiplyScalar(7 - 3 * night);
    },
    update(t) {
      for (const [i, r] of rings.entries()) {
        r.pivot.children[0].rotation.z = t * r.speed * 2;
        r.pivot.children[1].position.set(
          Math.cos(t * r.speed * 3 + i) * ringSpec[i][0] * scale,
          Math.sin(t * r.speed * 3 + i) * ringSpec[i][0] * scale,
          0,
        );
      }
    },
    dispose() {
      core.geometry.dispose();
      halo.geometry.dispose();
      for (const g of geoms) g.dispose();
      coreMat.dispose();
      haloMat.dispose();
      brass.dispose();
      bronze.dispose();
    },
  };
}

/**
 * Warm hall environment for reflections: a dark room with a bright warm
 * source overhead (the astrolabe) and a dim warm band around the walls.
 */
export function createHallEnvironment(
  renderer: WebGLRenderer,
  variant: 'hall' | 'daylight' = 'hall',
): { texture: Texture; dispose(): void } {
  const envScene = new Scene();
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    defines: variant === 'daylight' ? { DAYLIGHT: '' } : {},
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // Warm lamplit hall: dim floor, glowing wall band, a big soft
        // overhead source (the astrolabe) and a few bright "windows" so
        // brass and gold always find a highlight.
        vec3 floorC = vec3(0.05, 0.035, 0.022);
        vec3 wall = vec3(0.42, 0.26, 0.12);
        vec3 ceil = vec3(0.12, 0.08, 0.05);
        vec3 c = mix(floorC, wall, smoothstep(-0.7, 0.0, d.y));
        c = mix(c, ceil, smoothstep(0.15, 0.85, d.y));
        vec3 sunDir = normalize(vec3(0.1, 1.0, 0.15));
        float cs = max(dot(d, sunDir), 0.0);
        c += vec3(5.0, 3.6, 2.0) * pow(cs, 40.0) + vec3(0.9, 0.62, 0.32) * pow(cs, 4.0);
        float az = atan(d.z, d.x);
        float band = exp(-pow(d.y * 5.0, 2.0));
        c += vec3(0.6, 0.38, 0.16) * band * (0.55 + 0.45 * sin(az * 6.0));
        float win = pow(max(0.0, cos(az * 3.0)), 30.0) * exp(-pow((d.y - 0.25) * 9.0, 2.0));
        c += vec3(2.4, 1.8, 1.1) * win;
        #ifdef DAYLIGHT
          // Open parchment daylight: warm paper horizon, pale sky, bright sun.
          c = mix(vec3(0.5, 0.42, 0.3), vec3(0.95, 0.86, 0.66), smoothstep(-0.4, 0.1, d.y));
          c = mix(c, vec3(0.55, 0.66, 0.78), smoothstep(0.2, 0.9, d.y));
          c += vec3(6.0, 5.0, 3.6) * pow(cs, 60.0);
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sphere = new Mesh(new SphereGeometry(10, 32, 16), mat);
  envScene.add(sphere);
  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  sphere.geometry.dispose();
  mat.dispose();
  return {
    texture: rt.texture,
    dispose() {
      rt.dispose();
    },
  };
}
