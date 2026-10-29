// Time Series Analysis — decomposition, ARIMA/GARCH, unit roots, Granger.
import type { PluginManifest } from '@/types/plugin';

export const statsTimeseriesManifest: PluginManifest = {
  id: 'example.stats-timeseries',
  name: 'Time Series Analysis',
  nameI18n: { 'zh-CN': '时间序列分析', 'en-US': 'Time Series Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'ACF / PACF, additive and multiplicative seasonal decomposition, ADF / KPSS / Phillips-Perron unit-root tests, AIC-selected ARIMA with forecast bands, GARCH(1,1) volatility and the Granger causality F-test.',
  descriptionI18n: {
    'zh-CN':
      'ACF/PACF、加法与乘法季节分解、ADF/KPSS/Phillips-Perron 单位根检验、按 AIC 选择的 ARIMA 与预测带、GARCH(1,1) 波动率以及 Granger 因果 F 检验。',
    'en-US':
      'ACF / PACF, additive and multiplicative seasonal decomposition, ADF / KPSS / Phillips-Perron unit-root tests, AIC-selected ARIMA with forecast bands, GARCH(1,1) volatility and the Granger causality F-test.',
  },
  license: 'MIT',
  entry: 'example.stats-timeseries',
  category: 'scientific',
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['ar1-recovery', 'adf-stationarity', 'seasonal-recovery'],
    notes:
      'ARMA parameters use conditional sum of squares followed by AIC order selection; GARCH(1,1) is fitted by a deterministic Nelder-Mead-style grid search. Unit-root p-values are normal approximations to the Dickey-Fuller distribution.',
    notesI18n: {
      'zh-CN':
        'ARMA 参数采用条件最小二乘并由 AIC 选择阶数；GARCH(1,1) 通过确定性的网格搜索拟合。单位根 p 值为 Dickey-Fuller 分布的近似。',
      'en-US':
        'ARMA parameters use conditional sum of squares followed by AIC order selection; GARCH(1,1) is fitted by a deterministic grid search. Unit-root p-values are normal approximations to the Dickey-Fuller distribution.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'time,value[,aux] series table' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'same table, tab separated' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: 'c7de8ea8bad906f4c23214376d46b3a8ad8c6be7dc429c6b75862028cc5d5f5a7ac1860f689cea91c734a359c2b559d88ccc1adaa700281c57dd617dbcd59805',
    signer: 'Ergalics Studio (stats pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
