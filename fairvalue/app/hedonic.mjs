/**
 * TANUKI FairValue: 固定仕様のヘドニック回帰モデル v0.2 candidate
 *
 * 目的: 公開取引価格の参考値を、面積・築年・駅距離・駅・取引時期で補正。
 * price/m2 の対数をridge回帰。学習データの取引価格はその予測時点より前のもののみ。
 * このモデルはまず未使用地域での外部検証を通すまで本番既定に切り替えない。
 *
 * バックテスト時のデータ利用漏洩対策:
 *   - train の四半期を cutoff より前に限定
 *   - 出現駅ダミーは train のみから生成
 *   - 欠損築年中央値も train から算出
 *   - 検証物件の価格は feature として受け取らない
 */
import { normalizeLabel } from "./estimator.mjs";

export const MODEL_ID = "ridge_age_walk_station_time_lambda3_v0.2_candidate";
export const MODEL_VERSION = "0.2.0";
export const FROZEN_CONFIG = Object.freeze({
  lambda:3,
  minTraining:25,
  minStationCases:5,
  maxStationFeatures:24,
  featureAge:true,
  featureWalk:true,
  featureStation:true,
  featureTime:true,
  featureArea:true,
});
const periodOf = r => {
  const y=Number(r.year),q=Number(r.quarter);
  return Number.isInteger(y)&&Number.isInteger(q)&&q>=1&&q<=4?y*4+q-1:null;
};
const median = values => {
  if(!values.length)return null;
  const a=[...values].sort((x,y)=>x-y),middle=Math.floor((a.length-1)/2);
  return a[middle];
};
const acceptable = r => {
  const area=Number(r.area),price=Number(r.priceYen);
  return r.category==="condo" && Number.isFinite(area) && Number.isFinite(price)
    && area>=15 && area<=300 && price>=500000 && price<=1_000_000_000
    && price/area>=50_000 && price/area<=10_000_000 && periodOf(r)!==null;
};
function solveLinear(ata, atb) {
  const n=atb.length;
  const augmented=ata.map((row,i)=>[...row,atb[i]]);
  for(let i=0;i<n;i++) {
    let pivot=i;
    for(let j=i+1;j<n;j++) {
      if(Math.abs(augmented[j][i])>Math.abs(augmented[pivot][i]))pivot=j;
    }
    [augmented[i],augmented[pivot]]=[augmented[pivot],augmented[i]];
    if(Math.abs(augmented[i][i])<1e-10)return null;
    const denom=augmented[i][i];
    for(let c=i;c<=n;c++)augmented[i][c]/=denom;
    for(let row=0;row<n;row++) {
      if(row===i)continue;
      const factor=augmented[row][i];
      for(let c=i;c<=n;c++)augmented[row][c]-=factor*augmented[i][c];
    }
  }
  return augmented.map(row=>row[n]);
}
function vectorize(r, vars, ageMedian) {
  return vars.map(v=>{
    if(v==="logArea")return Math.log(Number(r.area)/70);
    if(v==="age")return ((r.ageYears==null?ageMedian:Number(r.ageYears))-20)/15;
    if(v==="ageMissing")return Number(r.ageYears==null);
    if(v==="walk")return ((r.stationMinutes==null?15:Number(r.stationMinutes))-15)/15;
    if(v==="time")return (periodOf(r)-2024*4)/8;
    if(v.startsWith("station:"))return Number(normalizeLabel(r.station)===v.slice(8));
    return 0;
  });
}
export function fitHedonicModel(transactions, prefecture, city, options={}) {
  const config=FROZEN_CONFIG;
  const maxPeriodExclusive=Number(options.maxPeriodExclusive);
  const rows=transactions.filter(r=>acceptable(r)
    && normalizeLabel(r.prefecture)===normalizeLabel(prefecture)
    && normalizeLabel(r.city)===normalizeLabel(city)
    && (!Number.isFinite(maxPeriodExclusive)||periodOf(r)<maxPeriodExclusive));
  if(rows.length<config.minTraining) {
    return {ok:false,reason:"学習事例が少ないため補正モデルを利用できません。",count:rows.length};
  }
  const ages=rows.map(r=>r.ageYears).filter(v=>v!=null&&Number.isFinite(Number(v))).map(Number);
  const ageMedian=median(ages)??20;
  const stations=new Map();
  for(const r of rows) {
    const name=normalizeLabel(r.station);
    if(name)stations.set(name,(stations.get(name)??0)+1);
  }
  const frequentStations=[...stations.entries()]
    .filter(([,count])=>count>=config.minStationCases)
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"ja"))
    .slice(0,config.maxStationFeatures).map(([name])=>name);
  const vars=[
    "logArea","age","ageMissing","walk","time",
    ...frequentStations.map(name=>"station:"+name),
  ];
  const n=vars.length+1;
  const ata=Array.from({length:n},()=>new Float64Array(n));
  const atb=new Float64Array(n);
  for(const r of rows) {
    const x=[1,...vectorize(r,vars,ageMedian)];
    const y=Math.log(Number(r.priceYen)/Number(r.area));
    for(let j=0;j<n;j++) {
      atb[j]+=x[j]*y;
      for(let k=0;k<n;k++)ata[j][k]+=x[j]*x[k];
    }
  }
  // 切片は正則化しない。
  for(let i=1;i<n;i++)ata[i][i]+=config.lambda;
  const beta=solveLinear(ata,atb);
  if(!beta||beta.some(v=>!Number.isFinite(v))) {
    return {ok:false,reason:"数値計算が収束しませんでした。",count:rows.length};
  }
  const periods=rows.map(periodOf);
  return {
    ok:true,modelId:MODEL_ID,count:rows.length,features:vars,
    coefficients:beta,ageMedian,latestPeriod:Math.max(...periods),
    earliestPeriod:Math.min(...periods),ageKnownRatio:ages.length/rows.length
  };
}
export function inferHedonic(model, query, options={}) {
  if(!model?.ok)return {ok:false,reason:model?.reason||"学習モデルが利用できません。"};
  const area=Number(query?.area);
  if(!Number.isFinite(area)||area<15||area>300)return {ok:false,reason:"専有面積の指定が不正です。"};
  const requestedPeriod=options.targetPeriod==null?model.latestPeriod:Number(options.targetPeriod);
  if(!Number.isInteger(requestedPeriod)||requestedPeriod<model.earliestPeriod)return {
    ok:false,reason:"価格基準時期が学習データより前です。"
  };
  // 最新公開四半期を越えた推測的な時系列外挿は行わない。
  // 過去のローリング検証時に限り1四半期先まで推測して評価可能。
  const targetPeriod=Math.min(requestedPeriod,model.latestPeriod+1);
  const year=Math.floor(targetPeriod/4),quarter=targetPeriod%4+1;
  const x=[1,...vectorize({...query,year,quarter},model.features,model.ageMedian)];
  const logPricePerSqm=model.coefficients.reduce((sum,beta,i)=>sum+beta*x[i],0);
  const totalYen=Math.exp(logPricePerSqm)*area;
  if(!Number.isFinite(totalYen)||totalYen<500000||totalYen>1_000_000_000)return {
    ok:false,reason:"推定値が有効範囲外です。"
  };
  return {
    ok:true,medianYen:Math.round(totalYen),
    modelId:model.modelId,trainingCount:model.count,
    sourcePeriod:[Math.floor(model.latestPeriod/4),model.latestPeriod%4+1],
    estimatedPeriod:[year,quarter],ageKnownRatio:model.ageKnownRatio,
    warning:"公開済み取引に対する統計的補正。将来の成約を保証しません。"
  };
}
export function predictHedonic(transactions,query,options={}) {
  const trained=fitHedonicModel(transactions,query.prefecture,query.city,options);
  return inferHedonic(trained,query,options);
}
