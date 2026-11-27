// Lazy TF.js loader. TF.js is a heavy dependency, so it is only imported when
// the plugin actually starts training — keeping it out of the initial bundle.

export type TF = typeof import('@tensorflow/tfjs');
export type LayersModel = ReturnType<TF['sequential']>;
export type Tensor = ReturnType<TF['tensor']>;

let cached: TF | null = null;

export async function loadTf(): Promise<TF> {
  if (!cached) {
    cached = await import('@tensorflow/tfjs');
    // Prefer the WebGL backend (GPU-accelerated in the browser); fall back to
    // CPU when WebGL is unavailable. Never let a backend failure crash startup.
    try {
      await cached.setBackend('webgl');
    } catch {
      try {
        await cached.setBackend('cpu');
      } catch {
        /* leave default */
      }
    }
    await cached.ready();
  }
  return cached;
}
