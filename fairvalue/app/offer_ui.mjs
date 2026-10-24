/**
 * Anonymous offer comparison — client-side only, no storage/network/upload.
 * User-provided company identifiers and notes are inserted via textContent.
 */
import {compareOffers,MAX_OFFERS,formatNotesForNegotiation} from "./offer_compare.mjs";
import {formatYen,formatMan} from "./seller_proceeds.mjs";

const el=id=>document.getElementById(id);
const rows=el("offersRows");
let nextId=1,activeReport=null;

function field(row,name){return row.querySelector(".offer-"+name);}
function createNode(tag,className,content){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(content!==undefined)node.textContent=String(content);
  return node;
}
function addCell(row,text,className=""){
  const c=createNode("td",className,text);
  row.appendChild(c);
}
function updateRow(row){
  const brokerage=field(row,"kind").value==="brokerage";
  if(!brokerage){
    field(row,"fee-mode").value="ceiling";
    field(row,"manual-fee").value="";
    field(row,"special").checked=false;
  }
  for(const node of row.querySelectorAll(".offer-broker-field"))node.hidden=!brokerage;
  row.querySelector(".offer-manual-field").hidden=!brokerage || field(row,"fee-mode").value!=="manual";
  row.querySelector(".offer-price-label").textContent=brokerage?"査定・想定成約価格":"業者の直接買取提示額";
  const rawPrice=field(row,"price").value;
  const price=Number(rawPrice);
  const eligible=brokerage && rawPrice!=="" && Number.isFinite(price)&&price>0&&price<=800;
  field(row,"special").disabled=!eligible;
  if(!eligible)field(row,"special").checked=false;
}
function updateRowTitles(){
  const all=[...rows.querySelectorAll(".offer-entry")];
  all.forEach((row,i)=>{
    row.querySelector(".offer-entry-title").textContent="候補 "+(i+1);
    row.querySelector(".offer-remove").hidden=all.length<=2;
  });
  el("offersAdd").disabled=all.length>=MAX_OFFERS;
  el("offersAdd").textContent=all.length>=MAX_OFFERS?"最大8件です":"＋ 比較候補を追加";
}
function addRow(data={}){
  if(rows.children.length>=MAX_OFFERS)return null;
  const fragment=el("offerRowTemplate").content.cloneNode(true);
  const row=fragment.querySelector(".offer-entry");
  row.dataset.offerId="offer_"+nextId++;
  row.querySelector(".offer-name").value=data.name??"";
  row.querySelector(".offer-kind").value=data.kind??
    (rows.children.length===0?"brokerage":"direct");
  row.querySelector(".offer-price").value=data.priceMan??"";
  row.querySelector(".offer-evidence").value=data.evidence??"unknown";
  row.querySelector(".offer-other").value=data.otherMan??"";
  row.querySelector(".offer-fee-mode").value=data.feeMode??"ceiling";
  row.querySelector(".offer-manual-fee").value=data.manualFeeMan??"";
  row.querySelector(".offer-special").checked=data.specialLowPrice===true;
  row.querySelector(".offer-timing").value=data.timing??"unknown";
  row.querySelector(".offer-reduction").value=data.reduction??"unknown";
  row.querySelector(".offer-expiry").value=data.expiryDate??"";
  row.querySelector(".offer-notes").value=data.notes??"";
  row.querySelector(".offer-remove").addEventListener("click",()=>{
    if(rows.children.length<=2)return;
    row.remove();
    updateRowTitles();
    clearReport();
  });
  for(const type of ["input","change"])row.addEventListener(type,()=>{
    updateRow(row);
    clearReport();
  });
  rows.appendChild(fragment);
  updateRow(row);
  updateRowTitles();
  return row;
}

function collectOffer(row){
  return {
    id:row.dataset.offerId,
    name:field(row,"name").value,
    kind:field(row,"kind").value,
    priceMan:field(row,"price").value,
    evidence:field(row,"evidence").value,
    otherMan:field(row,"other").value,
    feeMode:field(row,"fee-mode").value,
    manualFeeMan:field(row,"manual-fee").value,
    specialLowPrice:field(row,"special").checked,
    timing:field(row,"timing").value,
    reduction:field(row,"reduction").value,
    expiryDate:field(row,"expiry").value,
    notes:field(row,"notes").value
  };
}
function clearReport(){
  activeReport=null;
  el("offersReport").hidden=true;
  el("offersCopyStatus").textContent="";
  el("offersError").hidden=true;
  el("offersError").textContent="";
}
function termsFor(item,index){
  const article=createNode("article","offer-terms-card");
  article.appendChild(createNode("h5","","候補"+(index+1)+" — "+item.name));
  const summary=createNode("p","offer-terms-intro",
    item.kindLabel+"／"+item.evidenceLabel);
  article.appendChild(summary);
  const list=createNode("dl","offer-terms-definitions");
  function addTerm(term,value){
    list.appendChild(createNode("dt","",term));
    list.appendChild(createNode("dd","",value));
  }
  addTerm("引渡し時期",item.timingLabel);
  addTerm("減額・解除",item.reductionLabel);
  addTerm("価格の有効期限",item.expiryDate||"未入力");
  addTerm("補足メモ",item.notes||"未入力");
  addTerm("注意事項",item.caution.join("／"));
  addTerm("交渉時の確認質問",item.negotiationQuestions.join("／"));
  if(item.kind==="brokerage"&&item.breakEvenYen!==null) {
    const compared=activeReport.asEntered.find(x=>x.id===item.breakEvenReferenceId);
    addTerm("直接買取との損益分岐成約額",
      formatYen(item.breakEvenYen)+"（"+(compared?.name||"直接買取")+"との比較。仲介手数料は上限仮定）");
  }
  article.appendChild(list);
  return article;
}
function renderReport(report){
  activeReport=report;
  const date=new Date().toLocaleString("ja-JP",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"
  });
  el("offersReportMeta").textContent="作成："+date+"（JST）／有効な候補 "+report.count+"件／共通ローン返済 "+
    formatYen(report.loanYen)+"。すべて利用者入力に基づく計算です。";
  const body=el("offersRankingBody");
  body.replaceChildren();
  report.compared.forEach((item,i)=>{
    const tr=document.createElement("tr");
    addCell(tr,item.name+(i===0?(item.proceedsYen>=0?"（試算上の手取りが最大）":"（資金不足が最小）"):""),"offer-title-cell");
    addCell(tr,item.kindLabel+"／"+item.evidenceLabel);
    addCell(tr,formatYen(item.priceYen),"offer-money");
    addCell(tr,formatYen(item.feeYen)+
      (item.kind==="brokerage"?(item.feeMode==="ceiling"?"（上限で仮計算）":"（合意額を入力）"):""),"offer-money");
    addCell(tr,formatYen(item.otherYen)+(item.otherCostProvided?"":"（未入力のため0で仮計算）"),"offer-money");
    addCell(tr,formatYen(item.proceedsYen),"offer-money offer-net");
    const columnNames=["候補","取引方法・根拠","入力価格","仲介手数料","その他費用","手取り試算"];
    [...tr.children].forEach((cell,i)=>cell.dataset.label=columnNames[i]);
    body.appendChild(tr);
  });
  const labels=report.compared.map(x=>x.name);
  el("offersReportDifference").textContent=report.spreadYen===0
    ?"各候補の既知費用・ローン控除後の計算額は同じです。条件の優劣は別途確認してください。"
    :"試算上の最高と最低の差額は "+formatYen(report.spreadYen)+
      "（"+labels[0]+" と "+labels.at(-1)+"）。仲介査定の成約可能性や条件リスクを比較した結果ではありません。";
  const terms=el("offersTerms");
  terms.replaceChildren();
  report.compared.forEach((entry,i)=>terms.appendChild(termsFor(entry,i)));
  el("offersReportDisclaimer").textContent=report.disclaimer+
    " また、法定上限による仲介報酬は、個人の通常の住宅売却など、消費税相当額を取引価格に含めない前提で計算しています。";
  el("offersReport").hidden=false;
  el("offersCopyStatus").textContent="";
}
function calculate(){
  clearReport();
  try{
    const result=compareOffers({
      loanMan:el("offersLoanMan").value,
      offers:[...rows.querySelectorAll(".offer-entry")].map(collectOffer)
    });
    renderReport(result);
    el("offersReport").scrollIntoView({block:"start",behavior:"smooth"});
  }catch(error){
    el("offersError").textContent=error?.message??"入力を確認してください。";
    el("offersError").hidden=false;
  }
}
function clearAll(){
  el("offersLoanMan").value="";
  rows.replaceChildren();
  addRow({kind:"brokerage"});
  addRow({kind:"direct"});
  clearReport();
}
function useExample(){
  el("offersLoanMan").value="1000";
  rows.replaceChildren();
  addRow({
    kind:"brokerage",name:"架空の仲介A",priceMan:"4000",otherMan:"20",
    feeMode:"ceiling",evidence:"scenario",timing:"one_to_three",
    reduction:"unknown",notes:"査定・売出想定。成約は未確定"
  });
  addRow({
    kind:"direct",name:"架空の直接買取B",priceMan:"3700",otherMan:"10",
    evidence:"scenario",timing:"within_month",reduction:"unknown",
    notes:"契約後の価格変更条項を確認する"
  });
  addRow({
    kind:"direct",name:"架空の直接買取C",priceMan:"3650",otherMan:"30",
    evidence:"scenario",timing:"unknown",reduction:"conditions",
    notes:"条件付き想定額"
  });
  calculate();
}
el("offersLoanMan").addEventListener("input",clearReport);
el("offersAdd").addEventListener("click",()=>{addRow();clearReport();});
el("offersExample").addEventListener("click",useExample);
el("offersReset").addEventListener("click",clearAll);
el("offersCalculate").addEventListener("click",calculate);
el("offersPrint").addEventListener("click",()=>{
  if(!activeReport)return;
  window.print();
});
el("offersCopy").addEventListener("click",async()=>{
  if(!activeReport)return;
  try{
    if(!navigator.clipboard?.writeText)
      throw Error("このブラウザではコピーを利用できません。");
    await navigator.clipboard.writeText(formatNotesForNegotiation(activeReport));
    el("offersCopyStatus").textContent="比較内容をコピーしました。共有先には個人情報が含まれていないか確認してください。";
  }catch(_){
    el("offersCopyStatus").textContent="クリップボードへのコピーができません。印刷・PDF保存を利用してください。";
  }
});
clearAll();
