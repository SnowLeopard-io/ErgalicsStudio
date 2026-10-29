// ==========================================================================
// Embedded deterministic sample corpus for the NLP Workbench.
//
// 16 short English documents across four themes (tech / sports / finance /
// health), in the kernel's canonical corpus format: one document per line,
// with an optional leading `pos`/`neg` sentiment label separated by a tab
// (exactly what `parseCorpus` expects). Roughly half of the documents carry
// labels so the naive-Bayes classifier can be trained, and organisation /
// place names are included so the heuristic NER has something to find. The
// corpus is fully static — identical on every load.
// ==========================================================================

export const NLP_SAMPLE_TEXT: string = [
  'pos\tMicrosoft Corp unveiled a powerful new AI processor with impressive efficiency, and developers praised the brilliant, smooth software framework.',
  'neg\tThe new beta build shipped with a frustrating bug: the interface freezes, the startup is slow, and the battery drains faster after every update.',
  'Researchers at Google Labs published a promising algorithm that improves memory usage in cloud databases; the approach is elegant and reliable.',
  'A security incident at a major data center exposed weak encryption and unreliable backups, and regulators promised stricter audits.',
  'pos\tThe home team celebrated a stunning victory in the final; the winning goal delighted the crowd at Wembley in London.',
  'neg\tThe champions lost the derby after a poor first half; the coach blamed injuries and a weak defence for the defeat in Manchester.',
  'pos\tArsenal Football Club won the league title after a strong season; the young striker was outstanding and the supporters enjoyed a historic triumph.',
  'The tennis star retired hurt in the second set, citing a painful injury and a disappointing season.',
  'pos\tThe Federal Reserve reported rising employment and growing revenue; Wall Street rallied as investors expected higher profits next quarter.',
  'Shares of the retailer dropped sharply after a disappointing outlook; analysts cited mounting debt, weak demand and a looming recession.',
  'The central bank in Tokyo raised interest rates to fight inflation; the currency stabilized after a volatile week of trading.',
  'neg\tInvestors lost confidence after the accounting fraud scandal; the stock crashed and the fund faced a costly lawsuit and heavy losses.',
  'pos\tDoctors reported excellent results from the new vaccine trial; patients responded well and the treatment showed strong, reliable benefits.',
  'Hospitals faced a severe flu outbreak; emergency rooms were crowded and tired staff warned about a deadly virus spreading through the winter.',
  'A balanced diet, regular exercise and good sleep can improve health; the study followed two hundred patients for a full year.',
  'neg\tThe clinic warned that smoking remains a dangerous risk factor for cancer and heart disease; survival rates declined among elderly patients.',
].join('\n');
