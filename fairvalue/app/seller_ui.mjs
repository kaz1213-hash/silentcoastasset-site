/**
 * Seller proceeds UI is intentionally independent from appraisal data and
 * never sends price, mortgage, or negotiation terms to any server.
 */
import {compareSellRoutes,formatYen,formatMan} from "./seller_proceeds.mjs";

const el=id=>document.getElementById(id);
const form=el("sellerForm");
let previouslyCalculated=false;

function currentForm(){
  const mode=el("brokerFeeMode").value;
  return {
    loanMan:el("sellerLoanMan").value,
    brokerage:{
      saleMan:el("brokerPriceMan").value,
      otherMan:el("brokerOtherMan").value,
      feeMode:mode,
      manualFeeMan:el("manualBrokerFeeMan").value,
      specialLowPrice:el("specialLowFee").checked
    },
    direct:{
      saleMan:el("directPriceMan").value,
      otherMan:el("directOtherMan").value
    }
  };
}
function syncVisibility(){
  const manual=el("brokerFeeMode").value==="manual";
  el("manualBrokerFeeField").hidden=!manual;
  const text=el("brokerPriceMan").value.trim();
  const price=Number(text);
  const lowEligible=text!=="" && Number.isFinite(price) && price>0 && price<=800;
  el("specialLowFee").disabled=!lowEligible;
  if(!lowEligible)el("specialLowFee").checked=false;
}
function showChannel(r,type) {
  const broker=type==="broker";
  const section=el(broker?"brokerOutcome":"directOutcome");
  section.hidden=!r;
  if(!r)return;
  section.querySelector(".seller-meta").textContent=(broker?"仲介売却":"直接買取")+(r.proceedsYen<0?"の資金不足額（税金等は未計算）":"の手取り（税金等は未計算）");
  el(broker?"brokerNet":"directNet").textContent=formatYen(r.proceedsYen);
  el(broker?"brokerGross":"directGross").textContent=formatYen(r.saleYen);
  el(broker?"brokerOther":"directOther").textContent=formatYen(r.otherYen);
  el(broker?"brokerLoan":"directLoan").textContent=formatYen(r.loanYen);
  if(broker){
    el("brokerCommission").textContent=formatYen(r.feeYen);
    const detail=r.feeMode==="manual"?"手入力の税込手数料を採用。":"法定上限の税込額で保守的に仮計算。";
    el("brokerFeeExplanation").textContent=detail+" "+r.feeRule.explanation;
  }
}
function showComparison(result){
  const compare=el("sellerComparison");
  compare.hidden=result.diffYen==null;
  if(compare.hidden)return;
  const d=result.diffYen,abs=formatYen(Math.abs(d));
  const bothShortfall=result.brokerage.proceedsYen<0&&result.direct.proceedsYen<0;
  const mixedSign=(result.brokerage.proceedsYen<0)!==(result.direct.proceedsYen<0);
  const winner=d>0?"仲介売却":"直接買取";
  el("winnerSummary").textContent=d===0
    ?"入力額では両方の手取り・不足額が同じ"
    :bothShortfall?winner+"の方が資金不足額が"+abs+"小さい"
    :mixedSign?winner+"の方が"+abs+"有利"
    :winner+"の方が"+abs+"多く残る";
  el("sellerDifference").textContent=
    "差額（仲介売却の手取り − 直接買取の手取り）："+formatYen(d)+
    "。売却までの時間・成約不確実性・条件は金額比較に入れていません。";
  el("sellerBreakEven").textContent=result.breakEvenYen==null
    ?"仲介手数料を手入力した場合など、同条件での損益分岐成約価格は算出しません。"
    :"仲介を法定上限の手数料とした場合、直接買取と同等以上の手取りになる損益分岐成約価格は"+
     formatMan(result.breakEvenYen)+"（"+formatYen(result.breakEvenYen)+"）。仲介の成約見込みを保証する数字ではありません。";
}
function clearError(){
  el("sellerError").hidden=true;
  el("sellerError").textContent="";
}
function performCalculation(){
  clearError();
  syncVisibility();
  try{
    const result=compareSellRoutes(currentForm());
    showChannel(result.brokerage,"broker");
    showChannel(result.direct,"direct");
    showComparison(result);
    el("sellerResults").hidden=false;
    previouslyCalculated=true;
  }catch(error){
    el("sellerResults").hidden=true;
    el("sellerError").textContent=error?.message||"入力内容を確認してください。";
    el("sellerError").hidden=false;
  }
}
form.addEventListener("submit",event=>{
  event.preventDefault();
  performCalculation();
});
form.addEventListener("input",()=>{
  syncVisibility();
  if(previouslyCalculated)performCalculation();
});
form.addEventListener("change",()=>{
  syncVisibility();
  if(previouslyCalculated)performCalculation();
});
el("exampleSeller").addEventListener("click",()=>{
  // Explicitly fictional, never presented as property market or dealer offer.
  const example={
    brokerPriceMan:"4000",directPriceMan:"3700",sellerLoanMan:"1000",
    brokerOtherMan:"20",directOtherMan:"10",brokerFeeMode:"ceiling",
    manualBrokerFeeMan:""
  };
  Object.entries(example).forEach(([id,value])=>{el(id).value=value;});
  el("specialLowFee").checked=false;
  syncVisibility();
  performCalculation();
});
el("resetSeller").addEventListener("click",()=>{
  form.reset();
  previouslyCalculated=false;
  syncVisibility();
  clearError();
  el("sellerResults").hidden=true;
});
syncVisibility();
