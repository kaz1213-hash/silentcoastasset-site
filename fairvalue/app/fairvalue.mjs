/**
 * TANUKI FairValue v0.2 price composition:
 * 1) 市区町村内の類似取引の分布が最低5件ある時だけ参考結果を表示。
 * 2) 回帰モデルの学習数が最低25件に達する場合は、その中央値を参考推定価格として使う。
 * 3) 過去取引分布の25-75%幅は予測区間と呼ばず、そのまま別の根拠として表示。
 * 4) 回帰失敗時は参照取引中央値へ安全にフォールバック、価格捏造をしない。
 */
import {estimate} from "./estimator.mjs";
import {predictHedonic,MODEL_ID} from "./hedonic.mjs";

export const FAIRVALUE_VERSION="0.2.0";

export function estimateFairValue(transactions,query,options={}) {
  const reference=estimate(transactions,query,options);
  if(!reference.ok)return {
    ...reference,version:FAIRVALUE_VERSION,pricingMethod:"insufficient_data"
  };
  if(options.forceComparable===true) return {
    ...reference,version:FAIRVALUE_VERSION,pricingMethod:"comparable_only",
    modelMedianYen:reference.medianYen,comparableMedianYen:reference.medianYen,
  };
  const regression=predictHedonic(transactions,query,options);
  if(!regression.ok) {
    return {
      ...reference,version:FAIRVALUE_VERSION,pricingMethod:"comparable_fallback",
      modelMedianYen:reference.medianYen,comparableMedianYen:reference.medianYen,
      modelFailureReason:regression.reason
    };
  }
  return {
    ...reference,version:FAIRVALUE_VERSION,
    pricingMethod:"ridge_v02",
    pricingModel:MODEL_ID,
    modelMedianYen:regression.medianYen,comparableMedianYen:reference.medianYen,
    medianYen:regression.medianYen,
    modelTrainingCount:regression.trainingCount,
    modelSourcePeriod:regression.sourcePeriod,
    modelEstimatedPeriod:regression.estimatedPeriod,
    modelAgeKnownRatio:regression.ageKnownRatio,
    warning:"モデルによる参考価格と、過去類似取引の第25〜75百分位範囲は別々に算出しています。範囲は価格の保証区間ではありません。"
  };
}
