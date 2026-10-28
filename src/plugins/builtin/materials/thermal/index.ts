// Lazy-load entry for the mats-thermal plugin.
export { default } from './plugin';
export { matsThermalManifest } from './manifest';
export { parseThermal, analyseThermal, estimateBaseline, derivative, linreg, type ThermalMode, type ThermalPoint, type ThermalPeak, type ThermalAnalysis } from './kernel';
