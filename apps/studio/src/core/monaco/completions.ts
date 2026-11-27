// ==========================================================================
// Ergalics Studio — Monaco `studio.*` completion provider data
//
// Shared by the code-mode editor and the standalone code file editors so
// every Monaco surface offers the same studio DSL suggestions.
// ==========================================================================

import type * as MonacoNS from 'monaco-editor';

export const STUDIO_COMPLETIONS: Omit<MonacoNS.languages.CompletionItem, 'range'>[] = [
  { label: 'studio.load', kind: 3, insertText: 'studio.load("")', detail: 'load a data file' },
  { label: 'studio.random', kind: 3, insertText: 'studio.random(100)', detail: 'random numbers' },
  { label: 'studio.range', kind: 3, insertText: 'studio.range(0, 10)', detail: 'numeric range' },
  { label: 'studio.normalize', kind: 3, insertText: 'studio.normalize(df, "col")', detail: 'normalize a column' },
  { label: 'studio.sort', kind: 3, insertText: 'studio.sort(df, "col")', detail: 'sort a table' },
  { label: 'studio.select', kind: 3, insertText: 'studio.select(df, ["col"])', detail: 'pick columns' },
  { label: 'studio.addColumn', kind: 3, insertText: 'studio.addColumn(df, "name", values)', detail: 'append a column from values' },
  { label: 'studio.addConstantColumn', kind: 3, insertText: 'studio.addConstantColumn(df, "name", 1)', detail: 'append a constant column' },
  { label: 'studio.exampleData', kind: 3, insertText: 'studio.exampleData(200, 1)', detail: 'sine + noise sample data' },
  { label: 'studio.grid', kind: 3, insertText: 'studio.grid(20)', detail: 'size×size x/y grid' },
  { label: 'studio.filterRange', kind: 3, insertText: 'studio.filterRange(df, "x", 0, 1)', detail: 'inclusive numeric range filter' },
  { label: 'studio.topK', kind: 3, insertText: 'studio.topK(df, "x", 10, "largest")', detail: 'top K rows by column' },
  { label: 'studio.renameColumn', kind: 3, insertText: 'studio.renameColumn(df, "x", "z")', detail: 'rename a column' },
  { label: 'studio.filter', kind: 3, insertText: 'studio.filter(df, "col", ">", 5)', detail: 'filter rows' },
  { label: 'studio.summary', kind: 3, insertText: 'studio.summary(df, "col")', detail: 'column stats' },
  { label: 'studio.histogram', kind: 3, insertText: 'studio.histogram(df, "col", 10)', detail: 'column histogram' },
  { label: 'studio.plot', kind: 3, insertText: 'studio.plot("scatter", df)', detail: 'render a plot' },
  { label: 'studio.print', kind: 3, insertText: 'studio.print("hello")', detail: 'print to console' },
  { label: 'studio.notify', kind: 3, insertText: 'studio.notify("info", "done")', detail: 'host notification' },
  { label: 'studio.getParam', kind: 3, insertText: 'studio.getParam("key")', detail: 'read a project param' },
  { label: 'studio.setParam', kind: 3, insertText: 'studio.setParam("key", value)', detail: 'write a project param' },
];
