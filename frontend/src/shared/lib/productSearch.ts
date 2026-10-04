const HOMOGLYPHS: Record<string, string> = {
  а: "a",
  в: "b",
  с: "c",
  е: "e",
  ё: "e",
  н: "h",
  к: "k",
  м: "m",
  о: "o",
  р: "p",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
};

const LATIN_TO_RUSSIAN: Record<string, string> = {
  q: "й",
  w: "ц",
  e: "у",
  r: "к",
  t: "е",
  y: "н",
  u: "г",
  i: "ш",
  o: "щ",
  p: "з",
  "[": "х",
  "]": "ъ",
  a: "ф",
  s: "ы",
  d: "в",
  f: "а",
  g: "п",
  h: "р",
  j: "о",
  k: "л",
  l: "д",
  ";": "ж",
  "'": "э",
  z: "я",
  x: "ч",
  c: "с",
  v: "м",
  b: "и",
  n: "т",
  m: "ь",
  ",": "б",
  ".": "ю",
};

const RUSSIAN_TO_LATIN = Object.fromEntries(
  Object.entries(LATIN_TO_RUSSIAN).map(([latin, russian]) => [russian, latin]),
) as Record<string, string>;

const RUSSIAN_TO_TRANSLITERATED_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

const TRANSLITERATED_LATIN_TO_RUSSIAN: Array<[string, string]> = [
  ["shch", "щ"],
  ["sch", "щ"],
  ["yo", "ё"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["ch", "ч"],
  ["sh", "ш"],
  ["yu", "ю"],
  ["ya", "я"],
  ["a", "а"],
  ["b", "б"],
  ["c", "к"],
  ["d", "д"],
  ["e", "е"],
  ["f", "ф"],
  ["g", "г"],
  ["h", "х"],
  ["i", "и"],
  ["j", "й"],
  ["k", "к"],
  ["l", "л"],
  ["m", "м"],
  ["n", "н"],
  ["o", "о"],
  ["p", "п"],
  ["q", "к"],
  ["r", "р"],
  ["s", "с"],
  ["t", "т"],
  ["u", "у"],
  ["v", "в"],
  ["w", "в"],
  ["x", "кс"],
  ["y", "й"],
  ["z", "з"],
];

function replaceCharacters(value: string, replacements: Record<string, string>) {
  return Array.from(value)
    .map((character) => replacements[character] ?? character)
    .join("");
}

function transliterateRussianToLatin(value: string) {
  return replaceCharacters(value, RUSSIAN_TO_TRANSLITERATED_LATIN);
}

function transliterateLatinToRussian(value: string) {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const match = TRANSLITERATED_LATIN_TO_RUSSIAN.find(([latin]) => value.startsWith(latin, index));
    if (match) {
      result += match[1];
      index += match[0].length;
    } else {
      result += value[index];
      index += 1;
    }
  }
  return result;
}

function normalizeInput(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru");
}

/** Keeps client-only product filters consistent with the server's product search. */
export function normalizeProductSearchText(value: string | null | undefined) {
  return replaceCharacters(normalizeInput(value), HOMOGLYPHS);
}

export function productSearchVariants(value: string | null | undefined) {
  const input = normalizeInput(value);
  if (!input) return [];

  return Array.from(
    new Set([
      normalizeProductSearchText(input),
      normalizeProductSearchText(replaceCharacters(input, LATIN_TO_RUSSIAN)),
      normalizeProductSearchText(replaceCharacters(input, RUSSIAN_TO_LATIN)),
      normalizeProductSearchText(transliterateRussianToLatin(input)),
      normalizeProductSearchText(transliterateLatinToRussian(input)),
    ]),
  ).filter(Boolean);
}

export function productMatchesSearch(value: string, search: string) {
  const tokens = normalizeInput(search).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const searchableValue = normalizeProductSearchText(value);
  return tokens.every((token) =>
    productSearchVariants(token).some((variant) => searchableValue.includes(variant)),
  );
}
