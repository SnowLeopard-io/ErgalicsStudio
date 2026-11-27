// ==========================================================================
// FEM core — barrel. Pure TypeScript finite-element kernel: planar meshing
// (Bowyer–Watson Delaunay), P1 assembly, boundary conditions, physics
// (Poisson / transient heat / plane elasticity), a self-contained CG solver
// and post-processing. Zero DOM, no dependencies outside this folder.
// ==========================================================================

export * from './mesh/types';
export * from './mesh/domain';
export * from './mesh/delaunay';
export * from './mesh/refine';
export * from './mesh/quality';
export * from './assemble/basis';
export * from './assemble/stiffness';
export * from './assemble/load';
export * from './bc/dirichlet';
export * from './bc/neumann';
export * from './bc/robin';
export * from './physics/types';
export * from './physics/poisson';
export * from './physics/heat';
export * from './physics/elasticity';
export * from './solve/cg';
export * from './solve/stationary';
export * from './solve/transient';
export * from './post/stress';
