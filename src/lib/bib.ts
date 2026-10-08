// Minimal BibTeX reader for our own papers.bib: @type{key, field = {value} | number | month-macro, ...}.
// Braces may nest; LaTeX accents used in titles (\'{e}) are normalized.

export interface BibEntry {
  id: string;
  type: string;
  fields: Record<string, string>;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function readValue(src: string, i: number): [string, number] {
  while (/\s/.test(src[i])) i++;
  if (src[i] === '{') {
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    return [src.slice(i + 1, j), j + 1];
  }
  if (src[i] === '"') {
    const j = src.indexOf('"', i + 1);
    return [src.slice(i + 1, j), j + 1];
  }
  const m = /^[^,}\s]+/.exec(src.slice(i))!;
  return [m[0], i + m[0].length];
}

function clean(v: string): string {
  return v
    .replace(/\\'\{?e\}?/g, 'é')
    .replace(/--/g, '–')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBib(src: string): BibEntry[] {
  const out: BibEntry[] = [];
  const body = src.replace(/^\s*%.*$/gm, '');
  const head = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(body))) {
    const fields: Record<string, string> = {};
    let i = head.lastIndex;
    for (;;) {
      const f = /^\s*([A-Za-z_-]+)\s*=\s*/.exec(body.slice(i));
      if (!f) break;
      const [raw, next] = readValue(body, i + f[0].length);
      const name = f[1].toLowerCase();
      fields[name] = name === 'month' && MONTHS.includes(raw.toLowerCase()) ? String(MONTHS.indexOf(raw.toLowerCase()) + 1) : clean(raw);
      i = next;
      const sep = /^\s*,?/.exec(body.slice(i))!;
      i += sep[0].length;
      if (body[i] === '}' || /^\s*\}/.test(body.slice(i))) break;
    }
    out.push({ id: m[2], type: m[1].toLowerCase(), fields });
    head.lastIndex = i;
  }
  return out;
}

/** "Zhu, Linzhen and Wang, Runqiu" → ["Linzhen Zhu", "Runqiu Wang"] */
export function splitAuthors(s: string): string[] {
  return s.split(/\s+and\s+/).map((a) => {
    const [last, first] = a.split(',').map((x) => x.trim());
    return first ? `${first} ${last}` : last;
  });
}
