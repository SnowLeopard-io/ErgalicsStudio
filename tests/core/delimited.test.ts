// ==========================================================================
// Regression tests for the shared delimited-text splitter.
//
// Five call sites used to carry their own copy of this logic (block/flow
// file loader, chunked reader, cleaning wizard, data-engine schema and
// synthesiser). They now share core/io/delimited — these tests pin the
// semantics each of them relied on.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { splitDelimitedLine, splitLooseTokens } from '@/core/io/delimited';

describe('splitLooseTokens — comma OR whitespace separated', () => {
  it('splits plain numeric rows', () => {
    expect(splitLooseTokens('1 2 3')).toEqual(['1', '2', '3']);
    expect(splitLooseTokens('1,2,3')).toEqual(['1', '2', '3']);
    expect(splitLooseTokens('1, 2, 3')).toEqual(['1', '2', '3']);
  });

  it('collapses whitespace runs into one separator', () => {
    expect(splitLooseTokens('1   2')).toEqual(['1', '2']);
    expect(splitLooseTokens('a  b\tc')).toEqual(['a', 'b', 'c']);
  });

  it('a comma always closes a field (explicit empty middle field)', () => {
    expect(splitLooseTokens('1,,3')).toEqual(['1', '', '3']);
  });

  it('keeps quoted fields together and unescapes ""', () => {
    expect(splitLooseTokens('"a,b",c')).toEqual(['a,b', 'c']);
    expect(splitLooseTokens('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });

  it('keeps an explicitly empty quoted field', () => {
    expect(splitLooseTokens('""')).toEqual(['']);
  });

  it('drops trailing whitespace-only content', () => {
    expect(splitLooseTokens('  ')).toEqual([]);
  });
});

describe('splitDelimitedLine — one explicit delimiter', () => {
  it('splits on the given delimiter', () => {
    expect(splitDelimitedLine('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(splitDelimitedLine('a\tb', '\t')).toEqual(['a', 'b']);
    expect(splitDelimitedLine('a;b', ';')).toEqual(['a', 'b']);
  });

  it('keeps quoted fields together and unescapes ""', () => {
    expect(splitDelimitedLine('"a,b",c')).toEqual(['a,b', 'c']);
    expect(splitDelimitedLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });

  it('a trailing delimiter promises one more (empty) field', () => {
    expect(splitDelimitedLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('does not split on whitespace', () => {
    expect(splitDelimitedLine('a b')).toEqual(['a b']);
  });
});
