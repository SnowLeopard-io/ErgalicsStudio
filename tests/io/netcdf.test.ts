import { describe, it, expect } from 'vitest';
import { loadNetcdf } from '@/core/io/netcdf';

// Build a minimal NetCDF-3 *classic* file by hand so we can exercise the real
// netcdfjs parser without an external fixture. Layout:
//   dim "x" size 3
//   var "y" (double, shape [3]) with attribute units="m", data [10, 20, 30]
// NC types: NC_CHAR=2, NC_DOUBLE=6. Big-endian, 4-byte aligned.

function encName(str: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(str));
  const pad = (4 - (bytes.length % 4)) % 4;
  return [bytes.length >> 24, (bytes.length >> 16) & 255, (bytes.length >> 8) & 255, bytes.length & 255, ...bytes, ...new Array(pad).fill(0)];
}

function buildNetcdf(): ArrayBuffer {
  const out: number[] = [];
  const u32 = (v: number) => out.push((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);

  // magic + version (classic = 1)
  out.push(67, 68, 70, 1);
  u32(0); // numrecs

  // dim_list: tag 10, nelems 1, dim "x" size 3
  u32(10);
  u32(1);
  out.push(...encName('x'));
  u32(3);

  // gatt_list: tag 12, nelems 0
  u32(12);
  u32(0);

  // var_list: tag 11, nelems 1
  u32(11);
  u32(1);
  // var "y": name, ndims, dimid, attribute-list(tag 12), natts
  out.push(...encName('y'));
  u32(1);
  u32(0); // dim id 0
  u32(12); // NC_ATTRIBUTE list tag
  u32(1); // natts
  // attr "units": name, nc_type=char(2), nelems=1, value 'm'
  out.push(...encName('units'));
  u32(2);
  u32(1);
  out.push(109, 0, 0, 0); // 'm' + pad to 4
  // nc_type=double(6), vsize=24, offset (filled below)
  u32(6);
  u32(24);
  const offsetPos = out.length;
  u32(0); // placeholder offset

  // data section: pad header to 4-byte boundary
  while (out.length % 4 !== 0) out.push(0);
  const dataStart = out.length;
  // write offset
  out[offsetPos] = (dataStart >> 24) & 255;
  out[offsetPos + 1] = (dataStart >> 16) & 255;
  out[offsetPos + 2] = (dataStart >> 8) & 255;
  out[offsetPos + 3] = dataStart & 255;

  // 3 doubles: 10, 20, 30
  for (const v of [10, 20, 30]) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v);
    for (let i = 0; i < 8; i += 1) out.push(dv.getUint8(i));
  }

  return new Uint8Array(out).buffer;
}

describe('loadNetcdf', () => {
  it('parses a hand-built NetCDF-3 file into one variable', async () => {
    const vars = await loadNetcdf(buildNetcdf());
    expect(vars).toHaveLength(1);
    const v = vars[0]!;
    expect(v.name).toBe('y');
    expect(v.shape).toEqual([3]);
    expect(v.labels).toEqual(['x']);
    expect(v.unit).toBe('m');
    expect(Array.from(v.data)).toEqual([10, 20, 30]);
    expect(v.attrs!.units).toBe('m');
  });

  it('returns [] for an unreadable buffer instead of throwing', async () => {
    const vars = await loadNetcdf(new Uint8Array([1, 2, 3, 4, 5]).buffer);
    expect(vars).toEqual([]);
  });
});
