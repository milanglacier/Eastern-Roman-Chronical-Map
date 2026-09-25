/**
 * The PMREM environment that gives the gilding and the lead its daylight
 * reflections: open parchment daylight with a warm paper horizon, a pale
 * sky and a bright sun.
 */
import { BackSide, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, Texture, WebGLRenderer } from 'three';

export function createDaylightEnvironment(renderer: WebGLRenderer): { texture: Texture; dispose(): void } {
  const envScene = new Scene();
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 sunDir = normalize(vec3(0.1, 1.0, 0.15));
        float cs = max(dot(d, sunDir), 0.0);
        vec3 c = mix(vec3(0.5, 0.42, 0.3), vec3(0.95, 0.86, 0.66), smoothstep(-0.4, 0.1, d.y));
        c = mix(c, vec3(0.55, 0.66, 0.78), smoothstep(0.2, 0.9, d.y));
        c += vec3(6.0, 5.0, 3.6) * pow(cs, 60.0);
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
