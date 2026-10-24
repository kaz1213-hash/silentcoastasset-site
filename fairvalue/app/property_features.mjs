/**
 * 国交省 公開CSVの間取り・建物構造を少数の安定カテゴリへ規格化する。
 * 勝手な階数、眺望、修繕状況、建物名、リフォーム歴は補完しない。
 */
export function normalizePropertyText(text) {
  return String(text??"").normalize("NFKC").toUpperCase().replace(/\s+/g,"").trim();
}
export function layoutClass(value) {
  const text=normalizePropertyText(value);
  if(!text)return "";
  if(/オープンフロア|OPEN/.test(text))return "OPEN";
  if(/メゾネット/.test(text))return "MAISONETTE";
  const m=/^([1-5])((?:LDK|DK|LK|K|R))/.exec(text);
  if(!m)return "OTHER";
  const room=Number(m[1]),type=m[2];
  if(room===1)return type==="R"?"1R":type==="K"?"1K":type==="DK"?"1DK":type==="LDK"?"1LDK":"OTHER";
  if(room===2)return type==="LDK"?"2LDK":type==="DK"?"2DK":"OTHER";
  if(room===3)return type==="LDK"?"3LDK":type==="DK"?"3DK":"OTHER";
  if(room>=4)return type==="LDK"?"4LDK+":type==="DK"?"4DK+":"OTHER";
  return "OTHER";
}
export function structureClass(value) {
  const text=normalizePropertyText(value);
  if(!text)return "";
  if(text==="SRC"||text==="SRC造")return "SRC";
  if(text==="RC"||text==="RC造")return "RC";
  if(text.includes("SRC")&&text.includes("RC"))return "MIXED";
  if(text.includes("RC")&&text.includes("鉄骨"))return "MIXED";
  if(text.includes("SRC"))return "SRC";
  if(text.includes("RC"))return "RC";
  if(text.includes("鉄骨"))return "STEEL";
  return "OTHER";
}
