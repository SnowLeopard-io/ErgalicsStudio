// CPU capability hook: resolves the one-shot probe from core/cpu-info and
// caches it for the component tree. StatusBar and PerfOverlay use it to show
// a real descriptor ("x86-64 · 16T") when the app runs in CPU fallback mode
// instead of the GPU adapter's absent name.
import { useEffect, useState } from 'react';
import { getCpuInfo, type CpuInfo } from '@/core/cpu-info';

export function useCpuInfo(): CpuInfo | null {
  const [info, setInfo] = useState<CpuInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void getCpuInfo().then((resolved) => {
      if (alive) setInfo(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);

  return info;
}
