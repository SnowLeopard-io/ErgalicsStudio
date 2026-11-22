// @vitest-environment jsdom
//
// Regression test for the command palette's fuzzy filter: prefix matches used
// to score negative (the word-start bonus subtracts 2) and the filter treated
// any score < 0 as "no match", so typing the first characters of a command —
// e.g. "流程" or "Flow" — showed "no matching commands".
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Root } from 'react-dom/client';

const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)!.set!;

function type(input: HTMLInputElement, value: string) {
  nativeValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CommandPalette 搜索', () => {
  let container: HTMLDivElement;
  let root: Root;
  let input: HTMLInputElement;
  let labels: () => (string | null)[];

  beforeAll(async () => {
    // jsdom lacks matchMedia; app modules (theme store) touch it at import time.
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (q: string) => ({
          matches: false,
          media: q,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    }
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const { CommandPalette } = await import('@/components/CommandPalette');
    const { useCommandPaletteStore } = await import('@/stores/commandPaletteStore');
    const { setLocale } = await import('@/i18n');
    const { MemoryRouter } = await import('react-router-dom');

    setLocale('zh-CN');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(CommandPalette)));
    });
    act(() => {
      useCommandPaletteStore.getState().setOpen(true);
    });
    input = container.querySelector('.palette-input') as HTMLInputElement;
    labels = () =>
      Array.from(container.querySelectorAll('.palette-item-label')).map((n) => n.textContent);
  });

  afterAll(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('输入中文前缀能命中命令', () => {
    act(() => type(input, '流程'));
    expect(labels()).toContain('流程');
  });

  it('输入英文关键字能命中对应中文命令', () => {
    act(() => type(input, 'Flow'));
    expect(labels()).toContain('流程');
  });

  it('输入不相关字符时显示空状态', () => {
    act(() => type(input, 'zzzzzz'));
    expect(labels()).toEqual([]);
    expect(container.querySelector('.palette-empty')).not.toBeNull();
  });

  it('IME 合成结束后按最终汉字过滤', () => {
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      type(input, 'liucheng');
    });
    // Pinyin preedit must not flash "no matching commands".
    expect(container.querySelector('.palette-empty')).toBeNull();
    act(() => {
      nativeValueSetter.call(input, '流程');
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '流程' }));
    });
    expect(input.value).toBe('流程');
    expect(labels()).toContain('流程');
  });
});
