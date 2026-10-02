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

  it('throws a descriptive error for an unreadable buffer (EG1-71)', async () => {
    // A silent `[]` used to masquerade as a successful import of zero
    // variables; the loader must surface corruption to the caller.
    await expect(loadNetcdf(new Uint8Array([1, 2, 3, 4, 5]).buffer)).rejects.toThrow(
      /NetCDF parse failed/,
    );
  });

  // Builds a classic NetCDF-3 file with a second variable "z" carrying packed
  // metadata: _FillValue=-999 (NC_SHORT), scale_factor=0.5, add_offset=10.
  // Data [10, -999, 20] must import as [15, NaN, 20] (EG3-47).
  function buildNetcdfWithMetadata(): ArrayBuffer {
    const out: number[] = [];
    const u32 = (v: number) => out.push((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
    const f64 = (v: number) => {
      const dv = new DataView(new ArrayBuffer(8));
      dv.setFloat64(0, v);
      for (let i = 0; i < 8; i += 1) out.push(dv.getUint8(i));
    };
    const i16 = (v: number) => out.push((v >> 8) & 255, v & 255);
    const pad4 = () => {
      while (out.length % 4 !== 0) out.push(0);
    };

    out.push(67, 68, 70, 1);
    u32(0); // numrecs
    u32(10); // dim_list
    u32(1);
    out.push(...encName('x'));
    u32(3);
    u32(12); // gatt_list
    u32(0);
    u32(11); // var_list
    u32(2);

    // var "y" — unchanged from buildNetcdf (double [10, 20, 30], units="m").
    out.push(...encName('y'));
    u32(1);
    u32(0);
    u32(12);
    u32(1);
    out.push(...encName('units'));
    u32(2);
    u32(1);
    out.push(109, 0, 0, 0);
    u32(6);
    u32(24);
    const yOffsetPos = out.length;
    u32(0);

    // var "z" — packed short variable with scale/offset/fill attributes.
    out.push(...encName('z'));
    u32(1);
    u32(0);
    u32(12);
    u32(3);
    // _FillValue: NC_SHORT(3), 1 elem, -999 (2 bytes + 2 pad)
    out.push(...encName('_FillValue'));
    u32(3);
    u32(1);
    i16(-999);
    out.push(0, 0);
    // scale_factor: NC_DOUBLE(6), 0.5
    out.push(...encName('scale_factor'));
    u32(6);
    u32(1);
    f64(0.5);
    // add_offset: NC_DOUBLE(6), 10
    out.push(...encName('add_offset'));
    u32(6);
    u32(1);
    f64(10);
    // NC_SHORT(3), vsize 6 → stored padded to 8
    u32(3);
    u32(8);
    const zOffsetPos = out.length;
    u32(0);

    pad4();
    const dataStart = out.length;
    const patch = (pos: number, value: number) => {
      out[pos] = (value >> 24) & 255;
      out[pos + 1] = (value >> 16) & 255;
      out[pos + 2] = (value >> 8) & 255;
      out[pos + 3] = value & 255;
    };
    patch(yOffsetPos, dataStart);
    for (const v of [10, 20, 30]) f64(v);
    patch(zOffsetPos, out.length);
    for (const v of [10, -999, 20]) i16(v);
    pad4();

    return new Uint8Array(out).buffer;
  }

  it('applies scale_factor/add_offset and maps _FillValue to NaN (EG3-47)', async () => {
    const vars = await loadNetcdf(buildNetcdfWithMetadata());
    expect(vars).toHaveLength(2);
    const z = vars.find((v) => v.name === 'z')!;
    expect(z.shape).toEqual([3]);
    const d = Array.from(z.data);
    expect(d[0]).toBeCloseTo(15); // 10 * 0.5 + 10
    expect(Number.isNaN(d[1]!)).toBe(true); // fill sentinel −999 → NaN
    expect(d[2]).toBeCloseTo(20); // 20 * 0.5 + 10
    // Raw attributes stay available for provenance.
    expect(z.attrs!.scale_factor).toBe(0.5);
    expect(z.attrs!.add_offset).toBe(10);
    // The unpacked variable is unaffected.
    const y = vars.find((v) => v.name === 'y')!;
    expect(Array.from(y.data)).toEqual([10, 20, 30]);
  });
});
