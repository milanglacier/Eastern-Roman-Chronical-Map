/**
 * The clockwork model's material palette: polished brass and dark bronze
 * for mechanisms, carved stone for masonry, verdigris copper and gilding
 * for domes and statues, lacquer for water set into the models. All
 * standard PBR (reflections come from the hall's PMREM environment) and
 * bent by the curved world so models sit on the terrain they belong to.
 */
import { Color, DoubleSide, MeshStandardMaterial } from 'three';
import { applyCurvature } from '../curvature';

export interface ClockworkMaterials {
  brass: MeshStandardMaterial;
  bronze: MeshStandardMaterial;
  iron: MeshStandardMaterial;
  gold: MeshStandardMaterial;
  verdigris: MeshStandardMaterial;
  copper: MeshStandardMaterial;
  stone: MeshStandardMaterial;
  stoneWarm: MeshStandardMaterial;
  stoneDark: MeshStandardMaterial;
  porphyry: MeshStandardMaterial;
  roof: MeshStandardMaterial;
  lacquer: MeshStandardMaterial;
  linen: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  all(): MeshStandardMaterial[];
  dispose(): void;
}

function mat(name: string, params: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial {
  const m = new MeshStandardMaterial(params);
  m.name = name;
  return applyCurvature(m, 'clockwork-std');
}

export function createClockworkMaterials(): ClockworkMaterials {
  const m = {
    brass: mat('brass', { color: 0xd8b56a, metalness: 1, roughness: 0.26, envMapIntensity: 1.8 }),
    bronze: mat('bronze', { color: 0x9a7448, metalness: 1, roughness: 0.36, envMapIntensity: 1.6 }),
    iron: mat('iron', { color: 0x5a5652, metalness: 0.85, roughness: 0.45, envMapIntensity: 1.4 }),
    gold: mat('gold', { color: 0xf0c868, metalness: 1, roughness: 0.18, envMapIntensity: 2, emissive: new Color(0x3a2808) }),
    verdigris: mat('verdigris', { color: 0x6aa596, metalness: 0.55, roughness: 0.48 }),
    copper: mat('copper', { color: 0xc27a4e, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.6 }),
    stone: mat('stone', { color: 0xc4b699, metalness: 0, roughness: 0.84 }),
    stoneWarm: mat('stoneWarm', { color: 0xb39a78, metalness: 0, roughness: 0.86 }),
    stoneDark: mat('stoneDark', { color: 0x8a7f6d, metalness: 0, roughness: 0.9 }),
    porphyry: mat('porphyry', { color: 0x6f3a4a, metalness: 0.1, roughness: 0.35 }),
    roof: mat('roof', { color: 0x9a6a50, metalness: 0.35, roughness: 0.55 }),
    lacquer: mat('lacquer', { color: 0x1d3038, metalness: 0.4, roughness: 0.3, envMapIntensity: 1.4 }),
    linen: mat('linen', { color: 0xe8dcc0, metalness: 0, roughness: 0.9, side: DoubleSide }),
    wood: mat('wood', { color: 0x5a3e28, metalness: 0, roughness: 0.75 }),
  };
  const list = Object.values(m);
  return {
    ...m,
    all: () => list,
    dispose() {
      for (const x of list) x.dispose();
    },
  };
}
