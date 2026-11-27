# L4 acceptance report

Plugins: 30 · PASS: 8 · FAIL: 22

Release gate: any FAIL blocks publication.

## example.em-eigensolver — FAIL

- Discipline: physics / electromagnetics
- Default parameters: _not recorded_
- Extreme parameters: `{}`
- Extreme results: _not recorded_

### Export reconciliation

_not recorded_

### Refresh restoration

_not recorded_

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector skipped: requires a Web Worker; not available in the Node collector
- Requires a real browser E2E run.

- **FAIL reason:** no default-parameter result was recorded
- **FAIL reason:** no extreme-parameter result was recorded
- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: no evidence
- **FAIL reason:** independent recomputation was not documented

## example.fluid-cfd-coupler — FAIL

- Discipline: physics / fluid dynamics
- Default parameters: _not recorded_
- Extreme parameters: `{}`
- Extreme results: _not recorded_

### Export reconciliation

_not recorded_

### Refresh restoration

_not recorded_

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector skipped: requires document.baseURI + Pyodide worker; not available in Node
- Requires a real browser E2E run.

- **FAIL reason:** no default-parameter result was recorded
- **FAIL reason:** no extreme-parameter result was recorded
- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: no evidence
- **FAIL reason:** independent recomputation was not documented

## example.fluid — FAIL

- Discipline: physics / fluid dynamics
- Default parameters: _not recorded_
- Extreme parameters: `{"u0":0.18}`
- Extreme results: _not recorded_

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: NOT restored; fresh plugin instance restored params via api.getParam; metrics differed

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no default-parameter result was recorded
- **FAIL reason:** no extreme-parameter result was recorded
- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: fresh plugin instance restored params via api.getParam; metrics differed
- **FAIL reason:** independent recomputation was not documented

## example.nbody — PASS

- Discipline: physics / gravitation
- Default parameters: | metric | value |
| --- | --- |
| bench-T-sim | 19.87 |
| bench-T-kepler | 19.87 |
| bench-period-err | 1.133e-6 |
| bench-energy-drift | 1.600e-6 |
- Extreme parameters: `{"seed":1234567}`
- Extreme results: | metric | value |
| --- | --- |
| bench-T-sim | 19.87 |
| bench-T-kepler | 19.87 |
| bench-period-err | 1.133e-6 |
| bench-energy-drift | 1.600e-6 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 19.87 | 19.87 | — | 19.87 |
| 1 | 19.87 | — | 19.87 | 19.87 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- integrator period 19.87 vs analytic Kepler period 19.87 (expression: `two-body Kepler period vs integrator period`)

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.wave — FAIL

- Discipline: physics / waves
- Default parameters: _not recorded_
- Extreme parameters: `{"speed":0.7}`
- Extreme results: _not recorded_

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: NOT restored; fresh plugin instance restored params via api.getParam; metrics differed

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no default-parameter result was recorded
- **FAIL reason:** no extreme-parameter result was recorded
- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: fresh plugin instance restored params via api.getParam; metrics differed
- **FAIL reason:** independent recomputation was not documented

## example.fem-lab — PASS

- Discipline: engineering / FEM
- Default parameters: | metric | value |
| --- | --- |
| poissonL2 | 6.027e-3 |
| poissonOrder | 1.96 |
| uniaxial | 2.50e-17 |
| heatDecay | 1.67e-3 |
| heatEnergy | 1.37e-13 |
- Extreme parameters: `{"h":0.25}`
- Extreme results: | metric | value |
| --- | --- |
| poissonL2 | 6.027e-3 |
| poissonOrder | 1.96 |
| uniaxial | 2.50e-17 |
| heatDecay | 1.67e-3 |
| heatEnergy | 1.37e-13 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 2.50e-17 | 2.50e-17 | — | 2.50e-17 |
| 1 | 1.37e-13 | — | 1.37e-13 | 1.37e-13 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: poissonOrder=1.96

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.eng-truss — FAIL

- Discipline: engineering / structures
- Default parameters: | metric | value |
| --- | --- |
| max-disp | 0.6656 |
| max-tension | 10.02 |
| max-compression | -11.11 |
| react-0-x | -1.091e-11 |
| react-0-y | 25000 |
| react-2-y | 25000 |
| equilibrium | 1.091e-11 |
- Extreme parameters: `{"deformScale":5000}`
- Extreme results: | metric | value |
| --- | --- |
| max-disp | 0.6656 |
| max-tension | 10.02 |
| max-compression | -11.11 |
| react-0-x | -1.091e-11 |
| react-0-y | 25000 |
| react-2-y | 25000 |
| equilibrium | 1.091e-11 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 0.6656 | 0.6656 | — | 0.6656 |
| 1 | 1.091e-11 | — | 1.091e-11 | 1.091e-11 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** independent recomputation was not documented

## example.eng-heat — PASS

- Discipline: engineering / heat transfer
- Default parameters: | metric | value |
| --- | --- |
| tmax | 373 |
| tmin | 293 |
| residual | 0.000994 |
| courant | 9 |
- Extreme parameters: `{"plateW":2}`
- Extreme results: | metric | value |
| --- | --- |
| tmax | 373 |
| tmin | 293 |
| residual | 0.001 |
| courant | 9 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 373 | 373 | — | 373 |
| 1 | 293 | — | 293 | 293 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: residual=0.000994

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.eng-control — FAIL

- Discipline: engineering / control
- Default parameters: | metric | value |
| --- | --- |
| overshoot | 37.23 |
| rel-err-sigma | 8.24e-5% |
| peak-time | 1.646 |
| rel-err-tp | 0.039% |
| settling-time | 5.616 |
| rel-err-ts | 0.0171% |
| ess | 0.0006465 |
| bandwidth | 2.907 |
- Extreme parameters: `{"tau":10}`
- Extreme results: | metric | value |
| --- | --- |
| overshoot | 37.23 |
| rel-err-sigma | 8.24e-5% |
| peak-time | 1.646 |
| rel-err-tp | 0.039% |
| settling-time | 5.616 |
| rel-err-ts | 0.0171% |
| ess | 0.0006465 |
| bandwidth | 2.907 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 0.039% | 0.039% | — | 0.039% |
| 1 | 0.0171% | — | 0.0171% | 0.0171% |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** independent recomputation was not documented

## example.eng-circuit — FAIL

- Discipline: engineering / circuits
- Default parameters: | metric | value |
| --- | --- |
| v-vcc | 12 |
| v-mid | 8 |
| v-out | 8 |
| i-Vs | -0.004 |
| power-diss | 0.048 |
| power-balance | 0 |
- Extreme parameters: `{"iterations":1,"epochs":1,"steps":1}`
- Extreme results: | metric | value |
| --- | --- |
| v-vcc | 12 |
| v-mid | 8 |
| v-out | 8 |
| i-Vs | -0.004 |
| power-diss | 0.048 |
| power-balance | 0 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 12 | 12 | — | 12 |
| 1 | 0 | — | 0 | 0 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** independent recomputation was not documented

## example.chem-titration — FAIL

- Discipline: chemistry
- Default parameters: | metric | value |
| --- | --- |
| bench-strong-eq | 7 |
| bench-weak-eq-err | 0.0006338 |
| bench-dilution-err | 4.281e-8 |
- Extreme parameters: `{"kaCustom":1}`
- Extreme results: | metric | value |
| --- | --- |
| bench-strong-eq | 7 |
| bench-weak-eq-err | 0.0006338 |
| bench-dilution-err | 4.281e-8 |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-strong-eq=7, bench-weak-eq-err=0.0006338, bench-dilution-err=4.281e-8

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)

## example.chem-reaction-order — FAIL

- Discipline: chemistry / kinetics
- Default parameters: | metric | value |
| --- | --- |
| bench-order1 | n=1, 0.03775% |
| bench-order2 | n=2, 0.4222% |
| bench-arrhenius | 3.197e-12 |
- Extreme parameters: `{"iterations":1,"epochs":1,"steps":1}`
- Extreme results: | metric | value |
| --- | --- |
| bench-order1 | n=1, 0.03775% |
| bench-order2 | n=2, 0.4222% |
| bench-arrhenius | 3.197e-12 |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-arrhenius=3.197e-12

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)

## example.chem-crystal — FAIL

- Discipline: chemistry / crystallography
- Default parameters: | metric | value |
| --- | --- |
| cell_volume | 177.5 |
| density_est | 2.187 |
| density_dev | 0 |
| lattice_dev | -0.3546 |
- Extreme parameters: `{"iterations":1,"epochs":1,"steps":1}`
- Extreme results: | metric | value |
| --- | --- |
| cell_volume | 177.5 |
| density_est | 2.187 |
| density_dev | 0 |
| lattice_dev | -0.3546 |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** independent recomputation was not documented

## example.bio-pk — PASS

- Discipline: biology / pharmacokinetics
- Default parameters: | metric | value |
| --- | --- |
| pk-bench-one-iv | 7.040e-13 |
| pk-bench-one-oral | 7.279e-11 |
| pk-bench-two-iv | 1.930e-12 |
| pk-bench-two-oral | 1.113e-10 |
| pk-bench-auc | 8.333e-6 |
| cmax | 11.43 |
| tmax | 0 |
| half-life | 6.931 |
| auc-err | 3.031e-5 |
- Extreme parameters: `{"seed":1234567}`
- Extreme results: | metric | value |
| --- | --- |
| pk-bench-one-iv | 7.040e-13 |
| pk-bench-one-oral | 7.279e-11 |
| pk-bench-two-iv | 1.930e-12 |
| pk-bench-two-oral | 1.113e-10 |
| pk-bench-auc | 8.333e-6 |
| cmax | 11.43 |
| tmax | 0 |
| half-life | 6.931 |
| auc-err | 3.031e-5 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 7.040e-13 | 7.040e-13 | — | 7.040e-13 |
| 1 | 6.931 | — | 6.931 | 6.931 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: auc-err=3.031e-5

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.bio-epidemic — FAIL

- Discipline: biology / epidemiology
- Default parameters: | metric | value |
| --- | --- |
| n-conservation | 2.445e-15 |
| r0 | 4 |
| rt-early | 3.675 |
| peak-day | 21 |
| final-size | 9.608e-7% |
- Extreme parameters: `{"r0":8}`
- Extreme results: | metric | value |
| --- | --- |
| n-conservation | 1.048e-15 |
| r0 | 8 |
| rt-early | 6.715 |
| peak-day | 10 |
| final-size | 1.746e-6% |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 2.445e-15 | 2.445e-15 | — | 2.445e-15 |
| 1 | 21 | — | 21 | 21 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** independent recomputation was not documented

## example.bio-seqalign — FAIL

- Discipline: bioinformatics
- Default parameters: _not recorded_
- Extreme parameters: `{"gapOpen":-1}`
- Extreme results: _not recorded_

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: NOT restored; fresh plugin instance restored params via api.getParam; metrics differed

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no default-parameter result was recorded
- **FAIL reason:** no extreme-parameter result was recorded
- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: fresh plugin instance restored params via api.getParam; metrics differed
- **FAIL reason:** independent recomputation was not documented

## example.bio-popgen — FAIL

- Discipline: biology / population genetics
- Default parameters: _not recorded_
- Extreme parameters: `{"seed":1234567}`
- Extreme results: | metric | value |
| --- | --- |
| heterozygosity_initial | 0.5 |
| heterozygosity_final_obs | 0.2662 |
| heterozygosity_final_exp | 0.2736 |
| variance_p_final | 0.1161 |
| mean_fixation_time | 44.88 |
| fixed_lost | 3 / 5 |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: NOT restored; fresh plugin instance restored params via api.getParam; metrics differed

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no default-parameter result was recorded
- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: fresh plugin instance restored params via api.getParam; metrics differed
- **FAIL reason:** independent recomputation was not documented

## example.stats-bayes — FAIL

- Discipline: statistics / Bayesian
- Default parameters: | metric | value |
| --- | --- |
| bench-posterior-mean | 0.06744 |
| bench-posterior-sigma | 0.07518 |
| bench-gibbs-analytic | 0.00258 |
| bench-rhat-convergence | 0.01953 |
- Extreme parameters: `{"seed":1234567}`
- Extreme results: | metric | value |
| --- | --- |
| bench-posterior-mean | 0.06744 |
| bench-posterior-sigma | 0.07518 |
| bench-gibbs-analytic | 0.00258 |
| bench-rhat-convergence | 0.01953 |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-posterior-mean=0.06744, bench-posterior-sigma=0.07518, bench-gibbs-analytic=0.00258, bench-rhat-convergence=0.01953

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)

## example.stats-timeseries — FAIL

- Discipline: statistics / time series
- Default parameters: | metric | value |
| --- | --- |
| bench-ar1-recovery | 0.036334 |
| bench-adf-stationarity | 0.000000 |
| bench-seasonal-recovery | 4.95e-15 |
- Extreme parameters: `{"period":24}`
- Extreme results: | metric | value |
| --- | --- |
| bench-ar1-recovery | 0.036334 |
| bench-adf-stationarity | 0.000000 |
| bench-seasonal-recovery | 4.95e-15 |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-ar1-recovery=0.036334, bench-adf-stationarity=0.000000, bench-seasonal-recovery=4.95e-15

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)

## example.stats-survival — PASS

- Discipline: statistics / survival
- Default parameters: | metric | value |
| --- | --- |
| bench-km-hand-product | 0.00e+0 |
| bench-logrank-computable | 0.00e+0 |
| bench-cox-hr-recovery | 0.090202 |
- Extreme parameters: `{"conf":0.99}`
- Extreme results: | metric | value |
| --- | --- |
| bench-km-hand-product | 0.00e+0 |
| bench-logrank-computable | 0.00e+0 |
| bench-cox-hr-recovery | 0.090202 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 0.00e+0 | 0.00e+0 | — | 0.00e+0 |
| 1 | 0.00e+0 | — | 0.00e+0 | 0.00e+0 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-km-hand-product=0.00e+0, bench-logrank-computable=0.00e+0, bench-cox-hr-recovery=0.090202

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.stats-multivariate — FAIL

- Discipline: statistics / multivariate
- Default parameters: | metric | value |
| --- | --- |
| bench-pca-pc1 | 0.005781 |
| bench-kmeans-separation | 0.000000 |
| bench-lda-accuracy | 0.000000 |
- Extreme parameters: `{"clusters":8}`
- Extreme results: | metric | value |
| --- | --- |
| bench-pca-pc1 | 0.005781 |
| bench-kmeans-separation | 0.000000 |
| bench-lda-accuracy | 0.000000 |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-pca-pc1=0.005781, bench-kmeans-separation=0.000000, bench-lda-accuracy=0.000000

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)

## example.stats-meta — PASS

- Discipline: statistics / meta-analysis
- Default parameters: | metric | value |
| --- | --- |
| bench-fixed-effect-hand | 0 |
| bench-heterogeneity-bounds | 0 |
| bench-random-effect-ci | 0 |
- Extreme parameters: `{"iterations":1,"epochs":1,"steps":1}`
- Extreme results: | metric | value |
| --- | --- |
| bench-fixed-effect-hand | 0 |
| bench-heterogeneity-bounds | 0 |
| bench-random-effect-ci | 0 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0 | — | 0 |
| 1 | 0 | — | 0 | 0 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-fixed-effect-hand=0, bench-heterogeneity-bounds=0, bench-random-effect-ci=0

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.stats-doe — PASS

- Discipline: statistics / design of experiments
- Default parameters: | metric | value |
| --- | --- |
| bench-doe-full-factorial-recovery | 0.00e+0 |
| bench-doe-orthogonality | 0.00e+0 |
- Extreme parameters: `{"iterations":1,"epochs":1,"steps":1}`
- Extreme results: | metric | value |
| --- | --- |
| bench-doe-full-factorial-recovery | 0.00e+0 |
| bench-doe-orthogonality | 0.00e+0 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 0.00e+0 | 0.00e+0 | — | 0.00e+0 |
| 1 | 0.00e+0 | — | 0.00e+0 | 0.00e+0 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-doe-full-factorial-recovery=0.00e+0, bench-doe-orthogonality=0.00e+0

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.stats-conformal — FAIL

- Discipline: statistics / conformal inference
- Default parameters: | metric | value |
| --- | --- |
| cov | 92.0% / 90% |
| covGauss | 87.3% |
| covTercile | 95% / 87% |
| covTercileGauss | 100% / 71% |
| q | 2.185 |
| width | 0.9228 |
| widthGauss | 0.9029 |
| rmse | 0.3042 |
| ncal | 300 |
| sigma | 0.2745 |
- Extreme parameters: `{"seed":1234567}`
- Extreme results: | metric | value |
| --- | --- |
| cov | 92.0% / 90% |
| covGauss | 87.3% |
| covTercile | 95% / 87% |
| covTercileGauss | 100% / 71% |
| q | 2.185 |
| width | 0.9228 |
| widthGauss | 0.9029 |
| rmse | 0.3042 |
| ncal | 300 |
| sigma | 0.2745 |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 87.3% | 87.3% | — | 87.3% |
| 1 | 0.3042 | — | 0.3042 | 0.3042 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** independent recomputation was not documented

## example.geo-seismic — PASS

- Discipline: geoscience / seismology
- Default parameters: | metric | value |
| --- | --- |
| p-arrival | 1067.6 |
| s-arrival | 1841.0 |
| s-p | 773.4 |
| p-shadow | 103.0–142.0 |
| s-shadow | 103.0–180.0 |
| energy | 1.259e+14 |
| mmi | 7.74 |
| nodal | 21° / 317° |
- Extreme parameters: `{"magnitude":9}`
- Extreme results: | metric | value |
| --- | --- |
| p-arrival | 1067.6 |
| s-arrival | 1841.0 |
| s-p | 773.4 |
| p-shadow | 103.0–142.0 |
| s-shadow | 103.0–180.0 |
| energy | 1.995e+18 |
| mmi | 11.3 |
| nodal | 21° / 317° |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 1067.6 | 1067.6 | — | 1067.6 |
| 1 | 1841.0 | — | 1841.0 | 1841.0 |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- S-P differential time = 1841 - 1067.6 = 773.4 s (expression: `S arrival - P arrival`)

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.


## example.geo-hydrology — FAIL

- Discipline: geoscience / hydrology
- Default parameters: | metric | value |
| --- | --- |
| bench-scs-cn-handcalc | 0.000% |
| bench-scs-uh-peak | 0.036% |
| bench-scs-mass-conservation | 0.000% |
| bench-scs-superposition | 0.000% |
- Extreme parameters: `{"cn":99}`
- Extreme results: | metric | value |
| --- | --- |
| bench-scs-cn-handcalc | 0.000% |
| bench-scs-uh-peak | 0.036% |
| bench-scs-mass-conservation | 0.000% |
| bench-scs-superposition | 0.000% |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 0.000% | 0.000% | — | 0.000% |
| 1 | 0.000% | — | 0.000% | 0.000% |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** independent recomputation was not documented

## example.geo-soilwater — FAIL

- Discipline: geoscience / soil water
- Default parameters: | metric | value |
| --- | --- |
| bench-vg-sand-recovery | 0.702% |
| bench-vg-capacity-derivative | 0.000% |
| bench-vg-rmse-convergence | 0.000% |
- Extreme parameters: `{"thr0":0.3}`
- Extreme results: | metric | value |
| --- | --- |
| bench-vg-sand-recovery | 0.702% |
| bench-vg-capacity-derivative | 0.000% |
| bench-vg-rmse-convergence | 0.000% |

### Export reconciliation

| metric | page | export first | export last | sidecar |
| --- | --- | --- | --- | --- |
| 0 | 0.702% | 0.702% | — | 0.702% |
| 1 | 0.000% | — | 0.000% | 0.000% |

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

_not recorded_

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** independent recomputation was not documented

## example.geo-minerals — FAIL

- Discipline: geoscience / mineralogy
- Default parameters: | metric | value |
| --- | --- |
| bench-cell-cubic | pass |
| bench-cell-hexagonal | pass |
| bench-retardation-calcite | pass |
| bench-identify-quartz | pass |
| bench-database-sanity | pass |
- Extreme parameters: `{"hardness":10}`
- Extreme results: | metric | value |
| --- | --- |
| bench-cell-cubic | pass |
| bench-cell-hexagonal | pass |
| bench-retardation-calcite | pass |
| bench-identify-quartz | pass |
| bench-database-sanity | pass |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: restored; fresh plugin instance restored params via api.getParam; metrics matched

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-cell-cubic=pass, bench-cell-hexagonal=pass, bench-retardation-calcite=pass, bench-identify-quartz=pass

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)

## ai.automl — FAIL

- Discipline: machine learning
- Default parameters: | metric | value |
| --- | --- |
| bench-rows | 2000 |
| bench-total | 1904 ms |
| bench-rate | 1051 rows/s |
| bench-best | logistic |
- Extreme parameters: `{"seed":1234567}`
- Extreme results: | metric | value |
| --- | --- |
| bench-rows | 2000 |
| bench-total | 2089 ms |
| bench-rate | 957.3 rows/s |
| bench-best | logistic |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: NOT restored; fresh plugin instance restored params via api.getParam; metrics differed

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-rows=2000

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: fresh plugin instance restored params via api.getParam; metrics differed

## ai.nlp — FAIL

- Discipline: machine learning / NLP
- Default parameters: | metric | value |
| --- | --- |
| bench-docs | 300 |
| bench-total | 264.6 ms |
| bench-rate | 1134 docs/s |
| bench-tfidf | pass |
| bench-lda | pass |
- Extreme parameters: `{"seed":1234567}`
- Extreme results: | metric | value |
| --- | --- |
| bench-docs | 300 |
| bench-total | 321.6 ms |
| bench-rate | 932.7 docs/s |
| bench-tfidf | pass |
| bench-lda | pass |

### Export reconciliation

_not recorded_

### Refresh restoration

- params: restored; metrics: NOT restored; fresh plugin instance restored params via api.getParam; metrics differed

### Independent recomputation

- Embedded analytic oracle cross-checks the kernel against seeded truth: bench-docs=300, bench-tfidf=pass, bench-lda=pass

### Known limitations

- Headless collector exercises kernels and benchmark actions, not the full UI canvas.
- Timing-derived metrics are environment-dependent and are not used as acceptance numbers.

- **FAIL reason:** no export reconciliation table (page / first row / last row / sidecar)
- **FAIL reason:** refresh restoration incomplete: fresh plugin instance restored params via api.getParam; metrics differed
