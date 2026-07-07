/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher) over a
 * binary grid. Shared by the offline world-texture bake (coast distance
 * field) and the runtime territory rasterizer (frontier-glow SDF).
 */

const INF = 1e20;

/** 1D squared-distance transform via the lower envelope of parabolas. */
function edt1d(
  f: Float64Array,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
  n: number,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Euclidean distance (in pixels) from every cell to the nearest cell where
 * `inside(i)` is true. Cells where `inside` is true get distance 0. If no
 * cell is inside, every distance is effectively infinite (~1e10).
 */
export function distanceTransform(
  width: number,
  height: number,
  inside: (index: number) => boolean,
): Float32Array {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = inside(i) ? 0 : INF;

  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  // Columns first, then rows.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x];
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) grid[row + x] = d[x];
  }

  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/**
 * Signed distance to the boundary of a binary mask: positive inside,
 * negative outside, ~±0.5 px straddling the boundary.
 */
export function signedDistanceField(
  width: number,
  height: number,
  mask: { readonly length: number; [index: number]: number },
  threshold = 0.5,
): Float32Array {
  const distToInside = distanceTransform(width, height, (i) => mask[i] > threshold);
  const distToOutside = distanceTransform(width, height, (i) => mask[i] <= threshold);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    // Each transform measures to the nearest cell *center* of the other set,
    // so subtract half a pixel to put zero on the boundary between them.
    out[i] =
      mask[i] > threshold ? distToOutside[i] - 0.5 : -(distToInside[i] - 0.5);
  }
  return out;
}
