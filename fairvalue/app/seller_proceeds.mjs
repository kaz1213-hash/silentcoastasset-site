/**
 * TANUKI FairValue — brokerage-vs-direct-buy cash proceeds.
 *
 * Pure, local and deterministic. It does NOT predict sale price.
 * The brokerage fee is the upper-limit rule effective 2024-07-01 in Japan
 * per MLIT's official consumer guide. See docs/SELLER_PROCEEDS_V043.md.
 *
 * Amount units in caller: "万円" as user-typed text/number.
 * Core math uses integer yen, with nonnegative cash constraints.
 * Transfer taxes, acquisition cost, capital gains tax, and seller's own
 * tax circumstances are not inferred here.
 */
export const SELLER_SIM_VERSION="0.4.3";
export const MAX_MAN=500000;
const MAN=10000, TAX_MULTIPLIER=1.1;
const LOW_LIMIT=800*MAN, SPECIAL_GROSS_MAX=330000;
const FEE_SOURCE="https://www.mlit.go.jp/totikensangyo/const/1_6_bf_000013.html";

export function parseMan(value,{required=false,label="金額",allowZero=true}={}) {
  if(value===undefined||value===null||String(value).trim()===""){
    if(required) throw new RangeError(label+"を入力してください。");
    return null;
  }
  const str=String(value).trim().replaceAll(",","");
  if(!/^\d+(?:\.\d{1,4})?$/.test(str))
    throw new RangeError(label+"は0以上の数字を万円単位で入力してください。");
  const n=Number(str);
  if(!Number.isFinite(n)||n>MAX_MAN||(!allowZero&&n===0))
    throw new RangeError(label+"は"+(allowZero?"0より小さくない":"0より大きい")+"、50億円以下の値にしてください。");
  const amount=Math.round(n*MAN);
  if(!Number.isSafeInteger(amount))throw new RangeError(label+"が大きすぎます。");
  return amount;
}

export function standardBrokerageCeilingYen(saleYen) {
  if(!Number.isSafeInteger(saleYen)||saleYen<0)throw new RangeError("取引価格の範囲が不正です。");
  const first=Math.min(saleYen,2_000_000)*0.05;
  const second=Math.min(Math.max(saleYen-2_000_000,0),2_000_000)*0.04;
  const third=Math.max(saleYen-4_000_000,0)*0.03;
  // Floors final inclusive-tax amount to 1 yen; an estimate of upper bound, not an invoice.
  return Math.floor((first+second+third)*TAX_MULTIPLIER+1e-7);
}

export function brokerageCeiling(saleYen,{specialLowPrice=false}={}){
  const normal=standardBrokerageCeilingYen(saleYen);
  const specialEligible=saleYen<=LOW_LIMIT;
  const applied=Boolean(specialLowPrice&&specialEligible);
  return {
    standardYen:normal,
    selectedYen:applied?Math.max(normal,SPECIAL_GROSS_MAX):normal,
    specialEligible,
    specialApplied:applied,
    source:FEE_SOURCE,
    explanation:applied
      ?"800万円以下の低廉な宅地・建物の媒介報酬特例（税込33万円上限）を選択した想定。事前説明・合意が必要。"
      :"通常の売買媒介報酬上限（税込）の参考計算。事前説明・合意で実際の報酬額が決まります。"
  };
}

export function calculateBrokerage(input){
  const saleYen=parseMan(input?.saleMan,{required:true,label:"仲介による想定成約価格",allowZero:false});
  const loanYen=parseMan(input?.loanMan,{label:"住宅ローン残債"})??0;
  const otherYen=parseMan(input?.otherMan,{label:"仲介側のその他費用"})??0;
  const rule=brokerageCeiling(saleYen,{specialLowPrice:input?.specialLowPrice===true});
  const mode=input?.feeMode??"ceiling";
  if(mode!=="ceiling"&&mode!=="manual")throw new RangeError("仲介手数料の設定が不明です。");
  let feeYen=rule.selectedYen;
  if(mode==="manual"){
    feeYen=parseMan(input?.manualFeeMan,{required:true,label:"合意する仲介手数料",allowZero:true});
    if(feeYen>rule.selectedYen)
      throw new RangeError("入力した仲介手数料が、選択した条件での報酬上限を超えています。");
  }
  return {
    kind:"brokerage",saleYen,feeYen,feeUpperYen:rule.selectedYen,
    feeStandardUpperYen:rule.standardYen,specialApplied:rule.specialApplied,
    loanYen,otherYen,
    beforeLoanYen:saleYen-feeYen-otherYen,
    proceedsYen:saleYen-feeYen-otherYen-loanYen,
    feeMode:mode,feeRule:rule,
    costsKnownOnly:true,excludeCapitalGainsTax:true
  };
}

export function calculateDirect(input){
  const saleYen=parseMan(input?.saleMan,{required:true,label:"業者直接買取の提示額",allowZero:false});
  const loanYen=parseMan(input?.loanMan,{label:"住宅ローン残債"})??0;
  const otherYen=parseMan(input?.otherMan,{label:"直接買取側のその他費用"})??0;
  return {
    kind:"direct",saleYen,feeYen:0,feeUpperYen:0,
    loanYen,otherYen,beforeLoanYen:saleYen-otherYen,
    proceedsYen:saleYen-otherYen-loanYen,
    costsKnownOnly:true,excludeCapitalGainsTax:true
  };
}

export function brokerageBreakEvenForDirect({
 direct,brokerageOtherYen=0,loanYen=0,specialLowPrice=false,feeMode="ceiling"
}={}){
  if(!direct||feeMode!=="ceiling")return null;
  if(!Number.isSafeInteger(brokerageOtherYen)||brokerageOtherYen<0)
    throw new RangeError("その他費用の範囲が不正です。");
  // Solve gross - legal maximum commission - other brokerage costs - common loan
  // >= direct gross - direct costs - common loan, over valid positive prices.
  const goal=direct.beforeLoanYen;
  const netAt=price=>price-brokerageCeiling(price,{specialLowPrice}).selectedYen-brokerageOtherYen;
  let lower=0,upper=MAX_MAN*MAN;
  if(netAt(upper)<goal)return null;
  while(lower<upper){
    const mid=Math.floor((lower+upper)/2);
    if(netAt(mid)>=goal)upper=mid;
    else lower=mid+1;
  }
  return lower;
}

export function compareSellRoutes(input={}){
  const loanMan=input.loanMan??"";
  const brokerageValue=String(input.brokerage?.saleMan??"").trim();
  const directValue=String(input.direct?.saleMan??"").trim();
  if(!brokerageValue&&!directValue)
    throw new RangeError("仲介想定価格か直接買取提示額のどちらかを入力してください。");
  const mortgageYen=parseMan(loanMan,{label:"住宅ローン残債"})??0;
  const brokerage=brokerageValue?calculateBrokerage({...input.brokerage,loanMan}):null;
  const direct=directValue?calculateDirect({...input.direct,loanMan}):null;
  const diffYen=brokerage&&direct?brokerage.proceedsYen-direct.proceedsYen:null;
  const breakEvenYen=brokerage&&direct?brokerageBreakEvenForDirect({
    direct,brokerageOtherYen:brokerage.otherYen,loanYen:mortgageYen,
    specialLowPrice:input.brokerage?.specialLowPrice===true,
    feeMode:brokerage.feeMode
  }):null;
  return {
    brokerage,direct,mortgageYen,diffYen,breakEvenYen,
    estimated:false,
    feeSource:FEE_SOURCE,
    assumptions:[
      "仲介価格・直接買取額は利用者が入力した仮定／提示額。自動予測ではありません。",
      "仲介手数料は上限か入力した合意額を使用。業者直接買取の仲介手数料は計上しません。",
      "譲渡所得税、取得費、売却までの維持費、決済時の日割清算、登記・抵当権抹消、印紙税など未入力の費用は含めません。",
      "売却時期、契約条件、瑕疵対応など、金額以外の差は別途比較してください。"
    ]
  };
}
export function formatYen(yen){
  if(yen==null)return "—";
  const value=Math.round(yen);
  return (value<0?"−":"")+Math.abs(value).toLocaleString("ja-JP")+"円";
}
export function formatMan(yen){
  if(yen==null)return "—";
  return (yen<0?"−":"")+((Math.abs(yen)/MAN).toLocaleString("ja-JP",{maximumFractionDigits:4}))+"万円";
}
