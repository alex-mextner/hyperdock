// gjs -m tests/unique_name_check.js - collision-safe name rules. Exits 1 on failure.
import { createChecker } from './harness.js';
import { fitName, splitName, uniqueName } from '../uniqueName.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const split = (n) => splitName(n);

check(same(split('a.png'), { stem: 'a', ext: '.png' }), 'a.png splits at the last dot');
check(same(split('a.tar.gz'), { stem: 'a', ext: '.tar.gz' }), '.tar.gz is one extension');
check(same(split('a.b.tar.bz2'), { stem: 'a.b', ext: '.tar.bz2' }), '.tar.bz2 keeps earlier dots in the stem');
check(same(split('a.tar'), { stem: 'a', ext: '.tar' }), 'A plain .tar is an extension');
check(same(split('.bashrc'), { stem: '.bashrc', ext: '' }), 'A leading dot is no extension');
check(same(split('...'), { stem: '...', ext: '' }), 'A dot-only run has no extension');
check(same(split('v1.2.3'), { stem: 'v1.2.3', ext: '' }), 'v1.2.3 has no extension (digit after the dot)');
check(same(split('README'), { stem: 'README', ext: '' }), 'No dot, no extension');
check(same(split('a.'), { stem: 'a.', ext: '' }), 'A trailing dot is no extension');
check(same(split('a.abcdefghi'), { stem: 'a.abcdefghi', ext: '' }), 'Nine characters is too long for an extension');
check(same(split('a.abcdefgh'), { stem: 'a', ext: '.abcdefgh' }), 'Eight characters is allowed');
check(same(split('a.mp3'), { stem: 'a', ext: '.mp3' }), 'Digits are allowed after the first letter');
check(same(split('a.png.1'), { stem: 'a.png.1', ext: '' }), 'A numeric last part is no extension');
check(same(split('.tar.gz'), { stem: '.tar', ext: '.gz' }), '.tar.gz as a whole name keeps a non-empty stem');
check(same(split(''), { stem: '', ext: '' }), 'The empty name splits to nothing');
check(same(split('имя.txt'), { stem: 'имя', ext: '.txt' }), 'Cyrillic stems split');
check(same(split('имя.тхт'), { stem: 'имя.тхт', ext: '' }), 'Non-ASCII extensions are not extensions');

const set = (...n) => new Set(n);
check(uniqueName('a.png', set()) === 'a.png', 'A free name is unchanged');
check(uniqueName('a.png', set('a.png')) === 'a 2.png', 'a.png -> a 2.png');
check(uniqueName('a.png', set('a.png', 'a 2.png')) === 'a 3.png', 'a 2.png taken -> a 3.png');
check(uniqueName('a.png', set('a.png', 'a 2.png', 'a 4.png')) === 'a 3.png', 'The first gap is used');
check(uniqueName('a 2.png', set('a 2.png')) === 'a 3.png', 'a 2.png continues the series');
check(uniqueName('a 2.png', set('a 2.png', 'a 3.png')) === 'a 4.png', 'Series continues past taken numbers');
check(uniqueName('a 1.png', set('a 1.png')) === 'a 1 2.png', 'A suffix of 1 is part of the name');
check(uniqueName('a 2.png', set()) === 'a 2.png', 'A free numbered name is unchanged');
check(uniqueName('a.tar.gz', set('a.tar.gz')) === 'a 2.tar.gz', '.tar.gz stays at the end');
check(uniqueName('.bashrc', set('.bashrc')) === '.bashrc 2', 'Leading dot names get the suffix at the end');
check(uniqueName('v1.2.3', set('v1.2.3')) === 'v1.2.3 2', 'v1.2.3 -> v1.2.3 2');
check(uniqueName('README', set('README')) === 'README 2', 'No extension -> README 2');
check(uniqueName('Фото.png', set('Фото.png')) === 'Фото 2.png', 'Cyrillic name');
check(uniqueName('Фото 2.png', set('Фото 2.png')) === 'Фото 3.png', 'Cyrillic series continues');
check(uniqueName('A.png', set('a.png')) === 'A.png', 'Comparison is case-sensitive');
check(uniqueName('a.png', (n) => n === 'a.png' || n === 'a 2.png') === 'a 3.png', 'A predicate works like a set');
check(uniqueName('a.png', set('a.png'), 'keep-both') === 'a 2.png', 'keep-both is explicit style');
check(uniqueName(' 2', set(' 2')) === ' 2 2', 'A name that is only a number has no base to continue');

check(uniqueName('a.png', set('a.png'), 'copy') === 'a copy.png', 'copy: a.png -> a copy.png');
check(uniqueName('a.png', set('a.png', 'a copy.png'), 'copy') === 'a copy 2.png', 'copy: -> a copy 2.png');
check(uniqueName('a.png', set('a.png', 'a copy.png', 'a copy 2.png'), 'copy') === 'a copy 3.png', 'copy: -> a copy 3.png');
check(uniqueName('a copy.png', set('a copy.png'), 'copy') === 'a copy 2.png', 'copy: a copy.png continues');
check(uniqueName('a copy 2.png', set('a copy 2.png'), 'copy') === 'a copy 3.png', 'copy: a copy 2.png continues');
check(uniqueName('a.png', set(), 'copy') === 'a.png', 'copy: a free name is unchanged');
check(uniqueName('a 2.png', set('a 2.png'), 'copy') === 'a 2 copy.png', 'copy: a keep-both number is just a name');
check(uniqueName('a.tar.gz', set('a.tar.gz'), 'copy') === 'a copy.tar.gz', 'copy: .tar.gz stays at the end');
check(uniqueName('Фото.png', set('Фото.png'), 'copy') === 'Фото copy.png', 'copy: Cyrillic');

check(uniqueName('a.png', () => true) === 'a 10001.png', 'keep-both fallback after 10000 candidates');
check(uniqueName('a.png', () => true, 'copy') === 'a copy 10001.png', 'copy fallback after 10000 candidates');
let calls = 0;
uniqueName('a.png', () => { calls++; return true; });
check(calls === 10001, 'The original name plus 10000 candidates are probed');
check(uniqueName('a.png', (n) => n !== 'a 10001.png') === 'a 10001.png', 'Candidate 10001 is the fallback, 10000 is still probed');

// ---- a trailing number that is not a safe integer is stem text -----------------
const HUGE = '100000000000000000000';
check(
  uniqueName(`a ${HUGE}.png`, set(`a ${HUGE}.png`, 'a 100000000000000020000.png', 'a 10001.png')) === `a ${HUGE} 2.png`,
  'keep-both: a 21-digit number is part of the name, not a series marker'
);
check(
  uniqueName(`a ${HUGE}.png`, set(`a ${HUGE}.png`), 'copy') === `a ${HUGE} copy.png`,
  'copy: a 21-digit number is part of the name'
);
check(
  uniqueName(`a copy ${HUGE}.png`, set(`a copy ${HUGE}.png`), 'copy') === `a copy ${HUGE} copy.png`,
  'copy: a 21-digit copy number is no series marker'
);
check(
  uniqueName('a 999999999999999.png', set('a 999999999999999.png')) === 'a 1000000000000000.png',
  'keep-both: a 15-digit number still continues the series'
);
check(
  uniqueName('a 1000000000000000.png', set('a 1000000000000000.png')) === 'a 1000000000000000 2.png',
  'keep-both: a 16-digit number is stem text'
);

// ---- names are at most 255 bytes ---------------------------------------------
const bytes = (name) => new TextEncoder().encode(name).length;
const asciiStem = 'a'.repeat(251);
check(
  uniqueName(`${asciiStem}.txt`, set(`${asciiStem}.txt`)) === `${'a'.repeat(249)} 2.txt`,
  'keep-both: an ASCII stem is cut so the name is 255 bytes'
);
check(
  uniqueName(`${asciiStem}.txt`, set(`${asciiStem}.txt`), 'copy') === `${'a'.repeat(246)} copy.txt`,
  'copy: an ASCII stem is cut so the name is 255 bytes'
);
check(
  uniqueName(`${'a'.repeat(300)}.txt`, set()) === `${'a'.repeat(300)}.txt`,
  'a free name longer than 255 bytes is returned unchanged'
);
for (const [label, char] of [['Cyrillic', 'ж'], ['emoji', '😀'], ['CJK', '日']]) {
  const name = `${char.repeat(Math.floor(255 / bytes(char)))}.txt`;
  for (const style of ['keep-both', 'copy']) {
    const result = uniqueName(name, set(name), style);
    const stem = result.slice(0, result.length - (style === 'copy' ? ' copy.txt' : ' 2.txt').length);
    check(
      bytes(result) <= 255 && bytes(result) > 255 - bytes(char) &&
        [...stem].every((c) => c === char) && result !== name,
      `${style}: a ${label} stem is cut on a character boundary within 255 bytes`
    );
  }
}
check(
  !uniqueName(`${'😀'.repeat(70)}.txt`, set(`${'😀'.repeat(70)}.txt`)).includes('\uFFFD'),
  'a cut emoji stem leaves no replacement character or lone surrogate'
);
{
  const long = `${'a'.repeat(300)}.txt`;
  const taken = new Set([long]);
  const first = uniqueName(long, taken);
  taken.add(first);
  const second = uniqueName(first, taken);
  check(
    bytes(first) <= 255 && bytes(second) <= 255 && second !== first && second.endsWith(' 3.txt'),
    'a cut name continues its series on the next call'
  );
}
check(bytes(uniqueName(`${asciiStem}.txt`, () => true)) <= 255, 'the 10001 fallback is cut too');
check(fitName('a', ' 2', '.txt') === 'a 2.txt', 'a short name is not cut');
{
  const result = fitName('a', ' 2', `.${'x'.repeat(300)}`);
  check(
    bytes(result) === 255 && result.startsWith('a 2.x'),
    'an extension that leaves no room for one stem character is cut, its dot kept'
  );
}
{
  const result = fitName('😀', ' 2', `.${'x'.repeat(300)}`);
  check(
    bytes(result) <= 255 && result.startsWith('😀 2.x'),
    'the extension cut leaves room for one whole four-byte stem character'
  );
}
{
  const result = fitName('', ' 2', `.${'x'.repeat(300)}`);
  check(
    bytes(result) === 255 && result.startsWith(' 2.x'),
    'an empty stem needs no room, so the extension keeps all it can'
  );
}
check(
  uniqueName('a'.repeat(300), set('a'.repeat(300))) === `${'a'.repeat(253)} 2`,
  'a long name without an extension is cut to 255 bytes'
);

finish();
