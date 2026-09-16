/**
 * Emits a structured-data graph into the page.
 *
 * The escaping is not optional. Event names, machine descriptions and track
 * summaries all reach this from the database, and a value containing the
 * literal text `</script>` would close the block early and drop the rest of the
 * JSON into the document as markup - the classic JSON-in-HTML injection.
 * `JSON.stringify` does not escape `<` on its own, so every one is rewritten to
 * its \u003c form here, which is equivalent inside a JSON string and inert
 * inside HTML.
 *
 * U+2028 and U+2029 go with it: both are valid inside a JSON string but are
 * line terminators in JavaScript, and a parser reading this block as a script
 * would see a broken literal. They are written below as escapes rather than as
 * themselves for the same reason - a literal one in this file ends the regex
 * early, which is a build error rather than a runtime one, but the cause is
 * identical.
 */

const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

function serialise(data: unknown): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c] ?? c);
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // Safe: `serialise` neutralises every character that could break out of
      // the script element. See the note above before changing this.
      dangerouslySetInnerHTML={{ __html: serialise(data) }}
    />
  );
}
