import type { Font } from "satori";

const cache = new Map<string, Promise<Font[]>>();

// Google Sans Code has no Chinese glyphs. Request only the characters used in OG images.
export function loadOgCjkFonts(text: string): Promise<Font[]> {
  if (!/\p{Script=Han}/u.test(text)) return Promise.resolve([]);
  const subset = [...new Set(text)].sort().join("");
  const cached = cache.get(subset);
  if (cached) return cached;

  const fonts = Promise.all(
    ([400, 700] as const).map(async weight => {
      const url = new URL("https://fonts.googleapis.com/css2");
      url.searchParams.set("family", "Noto Sans SC:wght@" + weight);
      url.searchParams.set("text", subset);
      const cssResponse = await fetch(url, {
        // Ask for static TTF/OTF, which Satori supports, rather than WOFF2.
        headers: {
          "User-Agent":
            "Mozilla/5.0 AppleWebKit/533.21.1 Version/5.0.5 Safari/533.21.1",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!cssResponse.ok) {
        throw new Error(
          "Failed to load Chinese OG font CSS: " + cssResponse.status
        );
      }
      const css = await cssResponse.text();
      const resource = css.match(
        /src:\s*url\(([^)]+)\)\s*format\(['"](?:opentype|truetype)['"]\)/
      );
      if (!resource) throw new Error("Chinese OG font has no TTF/OTF source");
      const response = await fetch(resource[1], {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        throw new Error("Failed to load Chinese OG font: " + response.status);
      }
      return {
        name: "Noto Sans SC",
        data: await response.arrayBuffer(),
        weight,
        style: "normal" as const,
      };
    })
  );
  cache.set(subset, fonts);
  fonts.catch(() => cache.delete(subset));
  return fonts;
}
