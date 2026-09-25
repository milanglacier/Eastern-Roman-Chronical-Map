/**
 * Minimal full-screen pass helper (one oversized triangle). Local instead
 * of three/addons' FullScreenQuad: importing the addon made Vite bundle a
 * second copy of three ("Multiple instances of Three.js being imported").
 */
import { BufferGeometry, Float32BufferAttribute, Material, Mesh, OrthographicCamera, WebGLRenderer } from 'three';

const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const geometry = new BufferGeometry();
geometry.setAttribute('position', new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
geometry.setAttribute('uv', new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));

export class FullScreenQuad {
  private readonly mesh: Mesh;
  constructor(material?: Material) {
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }
  get material(): Material {
    return this.mesh.material as Material;
  }
  set material(value: Material) {
    this.mesh.material = value;
  }
  render(renderer: WebGLRenderer): void {
    renderer.render(this.mesh, camera);
  }
  dispose(): void {
    // Shared geometry lives for the page; nothing per-instance to free.
  }
}
