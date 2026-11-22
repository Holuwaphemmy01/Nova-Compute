/** BCH BLAZE 2026 submission links, used by the landing-page banner. */
export const BLAZE_LINKS = {
  baselineCode: "https://github.com/Holuwaphemmy01/Nova-Compute/tree/blaze-start",
  baselineDesigns: "https://github.com/Holuwaphemmy01/Nova-Compute/tree/blaze-start/design",
  repo: "https://github.com/Holuwaphemmy01/Nova-Compute",
  slides: "https://docs.google.com/presentation/d/1RohvlVEY_oiTu-SfjnhdvDGlHyM-XXfOKp0-Gsi9VaA/edit?usp=drivesdk",
  emberAddress: "<EMBER_ADDRESS>",
} as const;

/** A banner value is shown only once it's filled in: not empty and not a <PLACEHOLDER>. */
export function blazeValue(v: string): string | null {
  const t = v.trim();
  return t && !/^<[^>]*>$/.test(t) ? t : null;
}
