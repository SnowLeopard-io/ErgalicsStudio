// @vitest-environment jsdom
//
// Regression: an intermediate edit used `const { t } = useT()` (useT returns
// the translation function directly), so opening any file picker crashed with
// "t is not a function" and the error boundary swallowed every data dialog.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FilePickerPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    const { FilePickerPanel } = await import('@/components/FilePicker');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `ex${i}`,
      name: `示例数据 ${i}`,
    }));
    const few = [{ id: 'a', name: 'a.csv' }];
    act(() => {
      root.render(
        createElement(FilePickerPanel, {
          columns: [
            { key: 'p', title: '项目数据', items: few, empty: '空' },
            { key: 'e', title: '示例数据', items: many, empty: '空' },
          ],
          onChoose: () => {},
        }),
      );
    });
  });

  afterAll(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders without crashing and shows the filter above threshold', () => {
    expect(container.querySelector('.data-file-picker-item')).not.toBeNull();
    // 20-item column gets a filter, 1-item column does not.
    expect(container.querySelectorAll('.data-file-picker-filter').length).toBe(1);
  });

  it('filters items by name', () => {
    const input = container.querySelector('.data-file-picker-filter') as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    act(() => {
      set.call(input, '数据 5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const names = Array.from(container.querySelectorAll('.data-file-picker-name')).map(
      (n) => n.textContent,
    );
    expect(names).toContain('示例数据 5');
    expect(names).not.toContain('示例数据 4');
  });
});
