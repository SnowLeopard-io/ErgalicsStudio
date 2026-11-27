// ==========================================================================
// Ergalics Studio — IR 2 R 程式碼生成
//
// 產生與 Python/JS 目標相同的 `studio.*` DSL，以確保 R 程式碼模式遵循
// 一致且可往返轉換的合約。方法名稱對應 Python 的 snake_case 命名；R 使用
// `<-` 進行賦值，`#` 作為註解。下游的 studio R 套件應公開這些動詞
// （load_csv、filter_range、scatter 等），且簽章需與 Python/JS SDK 保持一致。
// ==========================================================================

import type { IRProgram } from '../ir/types';
import { generate } from './core';

export function codegenR(program: IRProgram): string {
  return generate(program, 'r');
}
