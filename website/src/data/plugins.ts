export type PluginCategory = 'scientific' | 'fun' | 'utility';

export interface PluginListing {
  id: string;
  name: { zh: string; en: string };
  desc: { zh: string; en: string };
  author: string;
  version: string;
  category: PluginCategory;
  tags: string[];
  installs: number;
  /** ed25519 public-key fingerprint recorded in the package manifest. */
  fingerprint: string;
  signed: boolean;
  /** Size of the .cspkg archive in KB. */
  sizeKb: number;
  updatedAt: string;
}

export const PLUGINS: PluginListing[] = [
  {
    id: 'example.ai-training',
    name: { zh: 'AI 训练演示', en: 'AI Training Playground' },
    desc: {
      zh: '在浏览器里训练线性/逻辑回归与 MNIST CNN，实时损失曲线与决策边界。',
      en: 'Train linear/logistic regression and an MNIST CNN in the browser with live loss curves and decision boundaries.',
    },
    author: 'Ergalics Official', version: '1.3.0', category: 'scientific',
    tags: ['ml', 'ai', 'tensorflow', 'canvas'], installs: 4821,
    fingerprint: 'ed25519:9f2c…a41d', signed: true, sizeKb: 182, updatedAt: '2026-09-09',
  },
  {
    id: 'example.fluid',
    name: { zh: '格子玻尔兹曼流体', en: 'Lattice-Boltzmann Fluid' },
    desc: {
      zh: 'GPU 加速的二维不可压流体模拟，可交互放置障碍物观察涡街。',
      en: 'GPU-accelerated 2-D incompressible flow; drop obstacles in and watch vortex streets form.',
    },
    author: 'Ergalics Official', version: '2.0.1', category: 'scientific',
    tags: ['physics', 'fluid', 'webgpu'], installs: 3977,
    fingerprint: 'ed25519:1ab8…77e0', signed: true, sizeKb: 96, updatedAt: '2026-08-31',
  },
  {
    id: 'example.errorband',
    name: { zh: '误差带图', en: 'Error Band Plot' },
    desc: {
      zh: '均值 ± 置信区间的出版级误差带图，支持对数轴与分组叠加。',
      en: 'Publication-grade mean ± CI error bands with log axes and grouped overlays.',
    },
    author: 'Ergalics Official', version: '1.1.0', category: 'scientific',
    tags: ['plot', 'statistics', 'uncertainty'], installs: 2643,
    fingerprint: 'ed25519:c3d1…02b9', signed: true, sizeKb: 41, updatedAt: '2026-08-20',
  },
  {
    id: 'example.geomap',
    name: { zh: '地理等值区域图', en: 'Geo Choropleth' },
    desc: {
      zh: 'GeoJSON 等值区域着色与气泡叠加，内置自然断点分色。',
      en: 'GeoJSON choropleths with bubble overlays and natural-breaks binning.',
    },
    author: 'Ergalics Official', version: '1.0.2', category: 'scientific',
    tags: ['geography', 'geojson', 'map'], installs: 2210,
    fingerprint: 'ed25519:88aa…5c12', signed: true, sizeKb: 63, updatedAt: '2026-07-28',
  },
  {
    id: 'example.em-eigensolver',
    name: { zh: '电磁谐振特征值求解器', en: 'EM Eigensolver' },
    desc: {
      zh: '十万阶非正定厄密稀疏矩阵特征值求解：厚重启 Lanczos、块 LOBPCG、Jacobi-Davidson 三内核 + MINRES 位移逆变换，支持 3D 模式场渲染。',
      en: 'Large-scale sparse Hermitian (indefinite) eigenpairs via thick-restart Lanczos, block LOBPCG and Jacobi-Davidson with MINRES shift-invert; 3-D mode-field rendering included.',
    },
    author: 'Ergalics Official', version: '1.0.0', category: 'scientific',
    tags: ['physics', 'eigenvalues', 'webgpu'], installs: 1873,
    fingerprint: 'ed25519:3d5e…90af', signed: true, sizeKb: 148, updatedAt: '2026-09-14',
  },
  {
    id: 'example.fluid-cfd-coupler',
    name: { zh: '1D-3D 双向耦合求解器', en: '1D-3D Coupled Solver' },
    desc: {
      zh: '1D 管网与 3D 场双向耦合：多速率时间子循环、正反向边界耦合、毫秒级阀门控制、守恒性审计与精度-效率权衡曲线。',
      en: 'Join a coarse-time 1-D pipe network with a fine-time 3-D field solver: multi-rate sub-cycling, bidirectional boundary coupling, millisecond valve control and conservation auditing.',
    },
    author: 'Ergalics Official', version: '1.0.0', category: 'scientific',
    tags: ['physics', 'cfd', 'coupling', 'python'], installs: 1296,
    fingerprint: 'ed25519:c81b…64e3', signed: true, sizeKb: 176, updatedAt: '2026-09-18',
  },
  {
    id: 'fun.life',
    name: { zh: '生命游戏', en: 'Game of Life' },
    desc: {
      zh: '高效单元格生命游戏，支持规则变体与模式库导入。',
      en: 'A fast cell-based Game of Life with rule variants and a pattern library.',
    },
    author: 'Ergalics Official', version: '1.4.0', category: 'fun',
    tags: ['automaton', 'simulation', 'toy'], installs: 5108,
    fingerprint: 'ed25519:44f0…9d3e', signed: true, sizeKb: 22, updatedAt: '2026-09-03',
  },
  {
    id: 'fun.mandelbrot',
    name: { zh: '曼德博集合', en: 'Mandelbrot Explorer' },
    desc: {
      zh: '任意精度缩放的分形探索器，可导出坐标书签用于分享。',
      en: 'Arbitrary-zoom fractal explorer that exports coordinate bookmarks for sharing.',
    },
    author: 'Ergalics Official', version: '1.2.3', category: 'fun',
    tags: ['fractal', 'math', 'canvas'], installs: 4312,
    fingerprint: 'ed25519:7e21…b8c4', signed: true, sizeKb: 18, updatedAt: '2026-08-15',
  },
  {
    id: 'fun.fireworks',
    name: { zh: '粒子烟花', en: 'Particle Fireworks' },
    desc: {
      zh: '基于物理的粒子烟花，点击绽放、拖拽画轨迹。',
      en: 'Physics-based fireworks: click to bloom, drag to draw trajectories.',
    },
    author: 'Ergalics Official', version: '1.0.0', category: 'fun',
    tags: ['particles', 'animation', 'toy'], installs: 3560,
    fingerprint: 'ed25519:2b9c…e107', signed: true, sizeKb: 14, updatedAt: '2026-06-30',
  },
  {
    id: 'fun.palette',
    name: { zh: '调色板生成器', en: 'Palette Generator' },
    desc: {
      zh: '感知均匀的色彩梯度与色盲安全调色板生成，可导出 CSS 变量。',
      en: 'Perceptually uniform gradients and colorblind-safe palettes, exportable as CSS variables.',
    },
    author: 'Ergalics Official', version: '1.1.1', category: 'utility',
    tags: ['color', 'design', 'gradient'], installs: 1987,
    fingerprint: 'ed25519:d05e…3a76', signed: true, sizeKb: 9, updatedAt: '2026-07-11',
  },
  {
    id: 'community.voxel-cloud',
    name: { zh: '体素点云查看器', en: 'Voxel Point Cloud Viewer' },
    desc: {
      zh: '百万级体素点云流式加载与 LOD 渲染，适合 LiDAR 与地形数据。',
      en: 'Streaming million-point voxel clouds with LOD rendering for LiDAR and terrain data.',
    },
    author: 'community:geo-labs', version: '0.4.0', category: 'utility',
    tags: ['3d', 'pointcloud', 'lidar', 'webgpu'], installs: 654,
    fingerprint: 'ed25519:6f3a…c9d2', signed: true, sizeKb: 214, updatedAt: '2026-09-06',
  },
  {
    id: 'community.hdf5-browser',
    name: { zh: 'HDF5 结构浏览器', en: 'HDF5 Structure Browser' },
    desc: {
      zh: '树状浏览 HDF5 组/数据集层级，预览属性并导出选择子集。',
      en: 'Tree view of HDF5 groups and datasets with attribute previews and subset export.',
    },
    author: 'community:datacore', version: '0.2.1', category: 'utility',
    tags: ['hdf5', 'io', 'browser'], installs: 431,
    fingerprint: 'ed25519:aa17…4f88', signed: true, sizeKb: 57, updatedAt: '2026-08-25',
  },
];
