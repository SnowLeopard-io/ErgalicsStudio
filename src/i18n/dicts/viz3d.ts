// FR-15 3D visualization enhancement — module dictionary (zh-CN / en-US).
// Keys use the `viz3d.` prefix. Merged into the base catalogs by
// src/i18n/modules.ts (done by the integration agent).
import type { LocaleDictionary } from '../types';

export const viz3dZh: LocaleDictionary = {
  'viz3d.surface.name': '3D 表面图',
  'viz3d.surface.desc': '高度场网格 z=f(x,y) 三维表面渲染，数据来自项目文件或示例数据，自适应视角',
  'viz3d.voxel.name': '3D 体素渲染',
  'viz3d.voxel.desc': '三维标量场等值面/半透明体素渲染，数据来自项目文件',
  'viz3d.surface.parse_failed': '未能从 {name} 解析出高度网格（需要 ≥2×2 的数值网格）',
  'viz3d.surface.loaded': '已加载高度网格 {rows} × {cols}，共 {verts} 个顶点',
  'viz3d.surface.no_data': '拖入高度场数据文件（.json/.dat/.txt）或加载示例数据以渲染三维表面',
  'viz3d.voxel.parse_failed': '未能从 {name} 解析出三维标量场（支持 JSON 数组或 {nx, ny, nz, values}）',
  'viz3d.voxel.loaded': '已加载体素场 {nx} × {ny} × {nz}，等值面 {tris} 个三角面',
  'viz3d.voxel.no_data': '拖入体素数据文件（.json/.dat/.txt）或加载示例数据以渲染三维标量场',
  'viz3d.no_container': '3D 容器不可用，请使用支持 WebGL 的浏览器',
  'viz3d.pointcloud.downsampled': 'WebGPU 不可用：点云已自动降采样至 {shown} / {total} 点以保持交互流畅',
  'viz3d.pointcloud.gpu_ready': 'WebGPU 已启用：全量渲染 {total} 个点（单次提交）',
};

export const viz3dEn: LocaleDictionary = {
  'viz3d.surface.name': '3D Surface',
  'viz3d.surface.desc': 'Height-field surface plots z=f(x,y) from project files or sample data, auto-fit view',
  'viz3d.voxel.name': '3D Voxel',
  'viz3d.voxel.desc': 'Isosurface / translucent voxel rendering of 3-D scalar fields from project files',
  'viz3d.surface.parse_failed': 'Could not parse a height grid from {name} (needs a ≥2×2 numeric grid)',
  'viz3d.surface.loaded': 'Height grid {rows} × {cols} loaded — {verts} vertices',
  'viz3d.surface.no_data': 'Drop a height-field file (.json/.dat/.txt) or load sample data to render a 3-D surface',
  'viz3d.voxel.parse_failed': 'Could not parse a 3-D scalar field from {name} (JSON array or {nx, ny, nz, values})',
  'viz3d.voxel.loaded': 'Voxel field {nx} × {ny} × {nz} loaded — {tris} isosurface triangles',
  'viz3d.voxel.no_data': 'Drop a voxel file (.json/.dat/.txt) or load sample data to render a 3-D scalar field',
  'viz3d.no_container': '3D container unavailable — use a WebGL-capable browser',
  'viz3d.pointcloud.downsampled': 'WebGPU unavailable: point cloud downsampled to {shown} / {total} points to stay interactive',
  'viz3d.pointcloud.gpu_ready': 'WebGPU enabled: rendering all {total} points in a single submission',
};
