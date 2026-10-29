// Regexes built for patches and CSS class lookups.

/** `\i` stands for any identifier; `\\i` keeps a literal `\i`. */
export const canonicalize = (re: RegExp) => new RegExp(
    re.source.replaceAll(/(\\*)\\i/g, (m, escapes: string) => escapes.length % 2 === 0 ? `${escapes}(?:[A-Za-z_$][\\w$]*)` : m.slice(1)),
    re.flags
);

/** A readable CSS class name ("button") inside a class list of Discord's hashed ones ("button_a1b2 other_c3"). */
export const classNameRegex = (name: string) => new RegExp(`(?<=^|\\s)${name}(?:_\\S*)?(?=$|\\s)`);
