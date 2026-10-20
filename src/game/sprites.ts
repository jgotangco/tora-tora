/** Hand-packed 8-bit sprites. '.' is empty. Baked once to canvases. */

const INK: Record<string, string> = {
  o: "#101814",
  n: "#1d4f9c",
  d: "#0c2858",
  w: "#f4f1e6",
  a: "#e2a02a",
  r: "#c4472a",
  R: "#8e1e1e",
  g: "#3d7a3a",
  G: "#14341c",
  s: "#a2a8ae",
  S: "#5c646c",
  k: "#22262a",
  y: "#f0c14a",
  b: "#7a5a30",
  B: "#3a2814",
  c: "#d7c48a",
  m: "#8e9890",
};

export const RAW: Record<string, string[]> = {
  player: [
    "......oooo......",
    ".....onwwno.....",
    ".....onaano.....",
    "......oooo......",
    "..oonnnnnnnnoo..",
    ".onnwwwnnnwwwnno",
    "onnnnnnnnnnnnnno",
    "onnnnnwwwwwnnnno",
    ".onnwwwnnnwwwnno",
    "..oonnnnnnnnoo..",
    "....onnnnnno....",
    ".....onnnno.....",
    "......onno......",
    ".....oo..oo.....",
    "....o......o....",
    "...o........o...",
  ],
  life: [
    "...oo...",
    "..oano..",
    ".onnnno.",
    "onnnnnno",
    ".onnnno.",
    "..onno..",
    "..o..o..",
    ".o....o.",
  ],
  plane: [
    "..o......o..",
    ".og......go.",
    "oggggggggggo",
    ".gggwwwwggg.",
    ".ggRrwwrRgg.",
    "..gggggggg..",
    "...gggggg...",
    "....gaag....",
    "....oooo....",
    ".....oo.....",
    "....o..o....",
    "...o....o...",
  ],
  pt: [
    "...oooo...",
    "..osssso..",
    "..oswwso..",
    ".osssssso.",
    ".ossrrsso.",
    ".osssssso.",
    ".osssssso.",
    "..osssso..",
    "..os..so..",
    ".oss..sso.",
    "..s....s..",
  ],
  cargo: [
    "....oooo....",
    "...osssso...",
    "...oskkso...",
    "..osssssso..",
    "..oskrrkso..",
    "..osssssso..",
    "..oskkkkso..",
    "..osssssso..",
    "..oskkkkso..",
    "..osssssso..",
    "..oskrrkso..",
    "..osssssso..",
    "...osssso...",
    "...os..so...",
    "..oss..sso..",
    "...s....s...",
  ],
  tanker: [
    "....oooo....",
    "...osssso...",
    "..ossyyysso.",
    "..osyyyyyso.",
    "..ossyyysso.",
    "...osssso...",
    "..ossyyysso.",
    "..osyyyyyso.",
    "..ossyyysso.",
    "...osssso...",
    "..osrrrrso..",
    "..osssssso..",
    "...osssso...",
    "...os..so...",
    "..o......o..",
  ],
  fuel: [
    "..oooooooooo..",
    ".oyyyyyyyyyyo.",
    ".oyayyyyyyayo.",
    ".oyyyyyyyyyyo.",
    "..oooooooooo..",
    ".osssssssssso.",
    ".oskkyyyykkso.",
    ".osyyyyyyyyso.",
    ".oskkyyyykkso.",
    ".osssssssssso.",
    "..oooooooooo..",
    ".oyyyyyyyyyyo.",
    ".oyayyyyyyayo.",
    ".oyyyyyyyyyyo.",
    "..oooooooooo..",
    "...osssssso...",
    "...os....so...",
  ],
  bridge: [
    "okkkkkkkkkkkkkkkkkko",
    "osssssssssssssssssso",
    "osSkkrSSkrSSkrSSksso",
    "osssssssssssssssssso",
    "osSkkrSSkrSSkrSSksso",
    "osssssssssssssssssso",
    "okkkkkkkkkkkkkkkkkko",
    "o..o............o..o",
  ],
  aa: [
    "...oooooo...",
    "..obbbbbbo..",
    ".obBssssBbo.",
    ".obsskkssbo.",
    ".obsskkssbo.",
    ".obssrrssbo.",
    "..obbbbbbo..",
    "...o.ss.o...",
    ".....ss.....",
    "....o..o....",
  ],
  palm: [
    "...gggg...",
    "..gGggGg..",
    ".gggggggg.",
    "..gGggGg..",
    "...bbbb...",
    "....bb....",
    "....bb....",
    "....bb....",
    "...b..b...",
  ],
  boom0: [
    "................",
    "................",
    "................",
    ".......yy.......",
    "......yaay......",
    ".......yy.......",
    "................",
    "................",
  ],
  boom1: [
    "................",
    "......r..r......",
    "....r.yaay.r....",
    ".....yyyyyy.....",
    "....ryaaaayr....",
    ".....yyyyyy.....",
    "....r.yaay.r....",
    "......r..r......",
  ],
  boom2: [
    "..w..........w..",
    "....r..yy..r....",
    "..r.yyyyyyyy.r..",
    "....yaaaaay.....",
    ".w.yyaaaaayy.w..",
    "....yaaaaay.....",
    "..r.yyyyyyyy.r..",
    "....r..yy..r....",
  ],
  boom3: [
    "m..............m",
    "..m...m..m...m..",
    "....myyyyym.....",
    "..m.mmmmmmmm.m..",
    "....myyyyym.....",
    "..m...m..m...m..",
    "m..............m",
    "................",
  ],
};

export type SpriteName = keyof typeof RAW;

export function bakeSprites(): Record<SpriteName, HTMLCanvasElement> {
  const out = {} as Record<SpriteName, HTMLCanvasElement>;
  for (const [name, rows] of Object.entries(RAW)) {
    const w = rows[0]?.length ?? 0;
    const h = rows.length;
    for (const row of rows) {
      if (row.length !== w) throw new Error(`sprite ${name} jagged row "${row}"`);
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < h; y++) {
      const row = rows[y] ?? "";
      for (let x = 0; x < w; x++) {
        const ch = row[x] ?? ".";
        if (ch === ".") continue;
        const color = INK[ch];
        if (!color) throw new Error(`sprite ${name} bad ink '${ch}'`);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    out[name as SpriteName] = c;
  }
  return out;
}
