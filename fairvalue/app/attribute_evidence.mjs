/**
 * 公的中古マンション取引の属性条件比較（推定AIモデルとは独立）。
 * v0.4の予測価格に一切作用しない。
 * 過去の取引金額をそのまま記述し、現在の査定や「予測区間」と呼ばない。
 */
import {normalizeLabel} from "./estimator.mjs";
import {layoutClass,structureClass} from "./property_features.mjs";

export const OBSERVED_COMPS_MIN=5;
const period=r=>Number(r.year)*4+Number(r.quarter)-1;
const median=a=>a[Math.floor((a.length-1)/2)];
const qLabel=(index)=>Math.floor(index/4)+"年第"+(index%4+1)+"四半期";

export function comparablePropertyEvidence(transactions,query) {
  const layout=query?.layout?layoutClass(query.layout):"";
  const structure=query?.structure?structureClass(query.structure):"";
  const area=Number(query?.area);
  const selectedFilters=[];
  if(!layout&&!structure)return {status:"NOT_REQUESTED",ok:false,reason:"間取り・構造を指定すると、条件が近い過去取引を別枠で集計できます。"};
  if(!query?.prefecture||!query?.city||!Number.isFinite(area)||area<15||area>300)
    return {status:"INVALID_INPUT",ok:false,reason:"市区町村と専有面積の条件が不正です。"};
  if(layout) {
    if(layout==="OTHER")return {status:"UNSUPPORTED_LAYOUT",ok:false,reason:"この間取りは比較用カテゴリに登録されていません。"};
    selectedFilters.push("間取り："+layout);
  }
  if(structure) {
    if(structure==="OTHER")return {status:"UNSUPPORTED_STRUCTURE",ok:false,reason:"この建物構造は比較用カテゴリに登録されていません。"};
    selectedFilters.push("構造："+structure);
  }
  // 説明可能な狭い面積条件のみ。対象事例がなければ黙って緩めない。
  selectedFilters.push("面積：指定値の±25%以内");
  const normalizedPref=normalizeLabel(query.prefecture),normalizedCity=normalizeLabel(query.city);
  let matches=transactions.filter(r=>
    r.category==="condo"&&normalizeLabel(r.prefecture)===normalizedPref&&
    normalizeLabel(r.city)===normalizedCity&&Number.isFinite(Number(r.priceYen))&&
    Number(r.priceYen)>0&&Number(r.area)>=area*.75&&Number(r.area)<=area*1.25
    && (!layout || layoutClass(r.layout)===layout)
    && (!structure || structureClass(r.structure)===structure)
    && Number.isInteger(period(r))
  );
  const station=normalizeLabel(query.station);
  if(station) {
    selectedFilters.push("最寄り駅："+station);
    matches=matches.filter(r=>normalizeLabel(r.station)===station);
  }
  const age=Number(query.ageYears);
  if(query.ageYears!==""&&query.ageYears!=null&&Number.isFinite(age)&&age>=0){
    selectedFilters.push("築年数：指定値の±10年");
    matches=matches.filter(r=>
      r.ageYears!=null&&Math.abs(Number(r.ageYears)-age)<=10);
  }
  if(matches.length<OBSERVED_COMPS_MIN)return {
    status:"INSUFFICIENT_EXAMPLES",ok:false,count:matches.length,
    activeFilters:selectedFilters,reason:"指定条件に近い公表取引が"+matches.length+"件。参考分布の表示基準（5件）に達しません。"
  };
  const prices=matches.map(r=>Number(r.priceYen)).sort((a,b)=>a-b);
  const newest=Math.max(...matches.map(period));
  const oldest=Math.min(...matches.map(period));
  const sample=matches.slice().sort((a,b)=>period(b)-period(a)||
    Math.abs(Number(a.area)-area)-Math.abs(Number(b.area)-area))
    .slice(0,8).map(r=>({
      city:r.city,district:r.district,area:r.area,
      priceYen:r.priceYen,layout:r.layout,structure:r.structure,
      ageYears:r.ageYears,year:r.year,quarter:r.quarter,
    }));
  return {
    status:"OBSERVED_COMPARABLES",ok:true,count:matches.length,
    medianObservedYen:median(prices),q25ObservedYen:prices[Math.floor(.25*(prices.length-1))],
    q75ObservedYen:prices[Math.floor(.75*(prices.length-1))],
    periodEarliest:qLabel(oldest),periodLatest:qLabel(newest),
    activeFilters:selectedFilters,representatives:sample,
    note:"公表された過去取引金額の実測分布。面積・築年数には許容幅があり、対象取引は物件ごとに異なります。今の売却査定額、買取手取りや将来価格の保証ではありません。"
  };
}
