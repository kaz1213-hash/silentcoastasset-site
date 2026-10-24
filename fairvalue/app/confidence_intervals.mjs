/**
 * TANUKI FairValue — 観測された時系列残差に基づく価格帯の実験。
 *
 * ⚠ 80% は目標被覆率（nominal target）であり、将来の物件ごとの保証ではない。
 *    非定常な住宅市場に exchangeability を仮定できないため、実績と一緒に表示する。
 *
 * Residual at quarter t is scored using ONLY pre-t observations.
 * Interval evaluated at quarter T is calibrated ONLY on residuals from t<T.
 * Calibration score = abs(log(actual/prediction)), with split-conformal order statistic.
 * Covers multiplicative error: [prediction/exp(q), prediction*exp(q)].
 */
import {estimate,normalizeLabel} from "./estimator.mjs";
import {fitHedonicModel,inferHedonic} from "./hedonic.mjs";

export const INTERVAL_SPEC=Object.freeze({
  version:"0.3.0",
  nominalCoverage:0.80,
  calibrationMinimum:100,
  evaluationMinimum:80,
  calibrationLookbackQuarters:8,
  verifiedWilsonLowerBound:0.70,
  wilsonZ:1.96,
  minimumStationCases:3,
  maxUsableWidthRatio:1.50,
  evaluationStartPeriod:2025*4+1, // 2025Q2
});

export function quarterIndex(record) {
  const y=Number(record?.year),q=Number(record?.quarter);
  if (!Number.isInteger(y)||!Number.isInteger(q)||q<1||q>4) return null;
  return y*4+q-1;
}
const median = items => items.length ? [...items].sort((a,b)=>a-b)[Math.floor((items.length-1)/2)]:null;
const round = (number,digits=1) => Number(number.toFixed(digits));

export function finiteSampleRadius(values,nominalCoverage=INTERVAL_SPEC.nominalCoverage) {
  const clean=values.filter(v=>Number.isFinite(v)&&v>=0).slice().sort((a,b)=>a-b);
  const k=Math.ceil((clean.length+1)*nominalCoverage);
  if(!clean.length||k>clean.length)return null;
  return clean[k-1];
}

export function priceInterval(centerYen,radiusLog) {
  if(!Number.isFinite(centerYen)||centerYen<=0 || !Number.isFinite(radiusLog)||radiusLog<0)return null;
  const factor=Math.exp(radiusLog);
  return {
    lowYen:Math.max(0,Math.round(centerYen/factor)),
    highYen:Math.round(centerYen*factor),
    factor:round(factor,3),
    fullWidthOverCenter:round(factor-1/factor,3),
  };
}

export function rollingScores(rows) {
  const periods=[...new Set(rows.map(quarterIndex).filter(Number.isFinite))].sort((a,b)=>a-b);
  const scores=[];
  let insufficientComparables=0,regressionFailed=0;
  for(const period of periods) {
    const older=rows.filter(r=>quarterIndex(r)<period);
    if(older.length<25)continue;
    const model=fitHedonicModel(older,rows[0].prefecture,rows[0].city);
    if(!model.ok)continue;
    for(const record of rows.filter(r=>quarterIndex(r)===period)){
      const query={
        prefecture:record.prefecture,city:record.city,district:record.district,
        station:record.station,area:record.area,
        ageYears:record.ageYears,stationMinutes:record.stationMinutes,
      };
      const comps=estimate(older,query);
      if(!comps.ok) {insufficientComparables++;continue;}
      const prediction=inferHedonic(model,query,{targetPeriod:period});
      if(!prediction.ok){regressionFailed++;continue;}
      const residual=Math.log(record.priceYen/prediction.medianYen);
      if(!Number.isFinite(residual))continue;
      scores.push({
        period,absoluteLogError:Math.abs(residual),signedLogError:residual,
        actualYen:record.priceYen, predictedYen:prediction.medianYen,
        year:record.year,quarter:record.quarter,
      });
    }
  }
  return {scores,insufficientComparables,regressionFailed};
}

export function calibrateAsOf(rollingScoreRows,asOfExclusive,spec=INTERVAL_SPEC) {
  const scores=rollingScoreRows.filter(item=>item.period<asOfExclusive &&
    item.period>=asOfExclusive-spec.calibrationLookbackQuarters &&
    Number.isFinite(item.absoluteLogError)).map(item=>item.absoluteLogError);
  if(scores.length<spec.calibrationMinimum) {
    return {ok:false,count:scores.length,reason:"有効な過去検証データが"+spec.calibrationMinimum+"件未満"};
  }
  const q=finiteSampleRadius(scores,spec.nominalCoverage);
  if(q===null) return {ok:false,count:scores.length,reason:"予測区間の半径を算定できない"};
  return {
    ok:true,count:scores.length,radiusLog:q,
    nominalCoverage:spec.nominalCoverage,
    recentQuarters:spec.calibrationLookbackQuarters,
  };
}

export function wilsonLowerBound(hits,n,z=1.96) {
  if(!Number.isInteger(n)||n<=0||!Number.isInteger(hits)||hits<0||hits>n)return null;
  const p=hits/n, z2=z*z, div=1+z2/n;
  return Math.max(0,(p+z2/(2*n)-z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/div);
}

function spanDiagnostics(rows){
  const areas=rows.map(r=>Number(r.area)).filter(a=>Number.isFinite(a)&&a>0).sort((a,b)=>a-b);
  const ranks=[.05,.95].map(frac=>areas[Math.floor(frac*(areas.length-1))]??null);
  const stations=new Map();
  for(const r of rows){
    const station=normalizeLabel(r.station);
    if(station)stations.set(station,(stations.get(station)||0)+1);
  }
  return {areaP05:ranks[0],areaP95:ranks[1],ageKnownShare:round(rows.filter(r=>r.ageYears!=null).length/Math.max(rows.length,1),3),
    stationCounts:Object.fromEntries([...stations].sort((a,b)=>b[1]-a[1]).slice(0,80))};
}

export function evaluateCityIntervals(rows,spec=INTERVAL_SPEC) {
  const history=rollingScores(rows);
  const assessment=[];
  const all=history.scores;
  const diagnostics=spanDiagnostics(rows);
  const evaluation=all.filter(s=>s.period>=spec.evaluationStartPeriod);
  for(const item of evaluation){
    const calibration=calibrateAsOf(all,item.period,spec);
    if(!calibration.ok)continue;
    const range=priceInterval(item.predictedYen,calibration.radiusLog);
    assessment.push({
      period:item.period, covered:item.actualYen>=range.lowYen&&item.actualYen<=range.highYen,
      ratio:range.fullWidthOverCenter, calibrationCount:calibration.count,
      prediction:item.predictedYen,
    });
  }
  const covered=assessment.filter(r=>r.covered).length;
  const coverage=assessment.length ? covered/assessment.length:null;
  const coverageLowerBound=wilsonLowerBound(covered,assessment.length,spec.wilsonZ);
  const currentAsOf=Math.max(...rows.map(quarterIndex))+1;
  const profile=calibrateAsOf(all,currentAsOf,spec);
  return {
    records:rows.length,
    rollingScoreCount:all.length,
    evaluationCount:assessment.length,
    evaluationEligible: evaluation.length,
    evaluationCoverage:coverage==null?null:round(coverage,3),
    evaluationCoverageWilsonLower:coverageLowerBound==null?null:round(coverageLowerBound,3),
    medianWidthOverCenter:assessment.length?round(median(assessment.map(r=>r.ratio)),3):null,
    currentIntervalCalibration:{
      count:profile.count,
      radiusLog:profile.ok?round(profile.radiusLog,6):null,
      targetCoverage:spec.nominalCoverage,
      windowQuarters:spec.calibrationLookbackQuarters,
      available:profile.ok,
      reason:profile.ok?null:profile.reason,
    },
    dataSupport:diagnostics,
    researchGate:
      !profile.ok?"INSUFFICIENT_CALIBRATION":
      assessment.length<spec.evaluationMinimum?"INSUFFICIENT_EVALUATION":
      coverageLowerBound<spec.verifiedWilsonLowerBound?"LOW_HISTORICAL_COVERAGE":
      profile.radiusLog>Math.log(2)?"UNUSABLY_WIDE":
      "OBSERVED_COVERAGE_PASS",
    skipped:{noComparable:history.insufficientComparables,regression:history.regressionFailed},
  };
}
export function buildIntervalProfiles(transactions,spec=INTERVAL_SPEC){
  const grouped=new Map();
  for(const r of transactions) {
    if(!r?.prefecture||!r?.city||r?.category!=="condo")continue;
    const key=normalizeLabel(r.prefecture)+" "+normalizeLabel(r.city);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(r);
  }
  const byCity={};
  for(const [key,rows] of grouped)byCity[key]=evaluateCityIntervals(rows,spec);
  return {
    protocol:"walk_forward_city_conformal_absolute_log_residual_v03",
    targetCoverage:spec.nominalCoverage,
    calibrationLookbackQuarters:spec.calibrationLookbackQuarters,
    model:"ridge_age_walk_station_time_lambda3_v0.2_candidate",
    byMunicipality:byCity,
    note:"80%は目標。ローリング過去取引の残差から算出するため非定常性・個別物件への条件付き被覆保証なし。検証段階の観測値。",
  };
}

export function assessEvidence(result,query,cityProfile,spec=INTERVAL_SPEC) {
  if(!result?.ok) return {grade:"NO_PRICE",priceInterval:null,reasons:["比較価格情報が不足"]};
  const reasons=[];
  if(!cityProfile) return {grade:"UNVERIFIED",priceInterval:null,reasons:["地域別の検証情報なし"]};
  const calibration=cityProfile.currentIntervalCalibration;
  if(!calibration?.available)reasons.push("過去の誤差検証数が不足");
  if(cityProfile.evaluationCount<spec.evaluationMinimum)reasons.push("時系列の評価事例が"+spec.evaluationMinimum+"件未満");
  if(cityProfile.evaluationCoverage!=null&&
    cityProfile.evaluationCount>=spec.evaluationMinimum&&
    cityProfile.evaluationCoverageWilsonLower<spec.verifiedWilsonLowerBound)reasons.push("過去の価格帯的中率が目標を大きく下回る");
  const lowArea=cityProfile.dataSupport.areaP05;
  const highArea=cityProfile.dataSupport.areaP95;
  const area=Number(query.area);
  if(Number.isFinite(lowArea)&&Number.isFinite(highArea)&&
    (area<lowArea||area>highArea)) reasons.push("専有面積が地域の主要な取引事例の範囲外");
  if(query.ageYears==null||query.ageYears==="")reasons.push("築年数が未入力");
  const station=normalizeLabel(query.station);
  if(!station) reasons.push("最寄り駅を指定していない");
  else if((cityProfile.dataSupport.stationCounts[station]??0)<spec.minimumStationCases)reasons.push("最寄り駅の公開事例が少ない");
  const rawInterval=calibration?.available?priceInterval(result.medianYen,calibration.radiusLog):null;
  if(rawInterval&&rawInterval.fullWidthOverCenter>spec.maxUsableWidthRatio)reasons.push("価格帯が広すぎる");
  const hasGate=cityProfile.researchGate==="OBSERVED_COVERAGE_PASS";
  const propertyConditionsComplete= !reasons.some(message=>
    /専有面積が|築年数が|最寄り駅を|最寄り駅の/.test(message));
  if(!hasGate)reasons.push("この地域は予測帯の検証ゲートを満たしていない");
  const grade=hasGate && propertyConditionsComplete && reasons.length===0?"SUPPORTIVE": "CAUTION";
  return {
    grade,reasons,
    priceInterval:hasGate && propertyConditionsComplete && rawInterval && rawInterval.fullWidthOverCenter<=spec.maxUsableWidthRatio
      ?rawInterval:null,
    candidateInterval:rawInterval,
    observedCoverage:cityProfile.evaluationCoverage,
    coverageEvaluations:cityProfile.evaluationCount,
    calibrationCount:calibration?.count??0,
    evidenceLabel:grade==="SUPPORTIVE"?"条件・検証実績が揃う参考値":"検証条件に制約がある参考値"
  };
}
