// ==========================================================================
// CPU capability probe.
//
// The GPU path reports its adapter name, but when the app degrades to CPU
// compute (WebGPU unavailable or forced fallback) there was no equivalent —
// the status bar just showed "Unknown · CPU". The browser has no single
// "CPU model" API, so combine what it does expose:
//   - logical core count via navigator.hardwareConcurrency (universal)
//   - architecture + bitness via Chromium's high-entropy user-agent data,
//     with a plain UA-string fallback for Firefox / Safari
// ==========================================================================

export interface CpuInfo {
  /** Normalized like "x86-64" / "arm64" — null when the platform hides it. */
  arch: string | null;
  /** Logical core count — null when unavailable. */
  cores: number | null;
}

let cached: Promise<CpuInfo> | null = null;

async function probe(): Promise<CpuInfo> {
  const nav = navigator as Navigator & {
    userAgentData?: {
      architecture?: string;
      bitness?: string;
      getHighEntropyValues?(hints: string[]): Promise<{ architecture?: string; bitness?: string }>;
    };
  };

  const cores =
    nav.hardwareConcurrency && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null;

  let arch: string | null = null;
  const uad = nav.userAgentData;
  if (uad?.getHighEntropyValues) {
    try {
      const hints = await uad.getHighEntropyValues(['architecture', 'bitness']);
      if (hints.architecture) {
        // "x86" + "64" reads better as the conventional "x86-64".
        arch = hints.bitness === '64' || hints.bitness === '32'
          ? `${hints.architecture}-${hints.bitness}`
          : hints.architecture;
      }
    } catch {
      /* high-entropy values are best-effort; fall through to the UA string */
    }
  }
  if (!arch) {
    const ua = nav.userAgent;
    if (/aarch64|arm64|arm_64/i.test(ua)) arch = 'arm-64';
    else if (/\bx64\b|\bwin64\b|\bamd64\b|\bx86_64\b/i.test(ua)) arch = 'x86-64';
    else if (/\bi[3686]86\b|\bx86\b|\bwin32\b/i.test(ua)) arch = 'x86-32';
  }

  return { arch, cores };
}

/** Probe once per session; every caller shares the same promise. */
export function getCpuInfo(): Promise<CpuInfo> {
  cached ??= probe();
  return cached;
}

/** Short chip label: "x86-64 · 16T", "16T", "x86-64" or "" when all unknown. */
export function formatCpuLabel(info: CpuInfo): string {
  const parts: string[] = [];
  if (info.arch) parts.push(info.arch);
  if (info.cores) parts.push(`${info.cores}T`);
  return parts.join(' · ');
}
