// The tokenizer cross-check must see a disagreement when there is one, or
// its "no difference" on three's bundle would mean nothing (C-9).
import { describe, expect, it } from 'vitest';
import { checkFile } from './tokenizer-check.mjs';

describe("the cross-check of hermet's tokenizer against TypeScript's parser", () => {
  it('agrees on ordinary minified code, templates and regular expressions', () => {
    const code = [
      'const a="x",b=`p${q}r${`s`}t`;',
      "if(/[\"']/.test(a))f(`/u`);",
      'const re=/\\/"/g,c=\'y\';',
    ].join('');
    const r = checkFile(code);
    expect(r.missedByTokenizer).toEqual([]);
    expect(r.inventedByTokenizer).toEqual([]);
    expect(r.parserFindings.paths).toEqual(['/u']);
  });

  it("sees C-9's edge case: a regular expression after ')' that holds a quote", () => {
    const r = checkFile('if(a)/"/.test(b);const c="https://example.invalid/x";');
    // The tokenizer reads from the regex's quote to the string's opening
    // quote as a string, and so misses the real one, host and all.
    expect(r.inventedByTokenizer).toEqual(['/.test(b);const c=']);
    expect(r.missedByTokenizer).toEqual(['https://example.invalid/x']);
    expect(r.parserFindings.hosts).toEqual(['example.invalid']);
  });
});
