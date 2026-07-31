import type { AnalysisResult, CanonicalColorRow, ExportRow } from "./engine";

export type HtmlReportGroup = {
  label: string;
  cohort: "human" | "ai" | "unspecified";
  fileName: string;
  sheetName: string;
  rowCount: number;
};

export type HtmlReportMethod = {
  id: string;
  group: string;
  title: string;
  description: string;
  output: string;
  space: string;
  status: "included" | "not-applicable" | "error";
  resultRows: number;
  reason?: string;
};

export type HtmlReportPayload = {
  title: string;
  generatedAt: string;
  scopeLabel: string;
  schemaLabel: string;
  groups: HtmlReportGroup[];
  methods: HtmlReportMethod[];
  colors: CanonicalColorRow[];
  gew: ExportRow[];
  bidirectional: ExportRow[];
  results: AnalysisResult[];
  initialFilters: {
    source: string;
    emotion: string;
    color: string;
  };
};

function safeJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function reportData(payload: HtmlReportPayload) {
  return {
    ...payload,
    results: payload.results.map(result => ({
      ...result,
      totalRows: result.rows.length,
      rows: result.rows,
    })),
  };
}

const REPORT_STYLE = `
:root{--ink:#203944;--muted:#718087;--line:#dce5e2;--soft:#f4f7f5;--teal:#277b92;--green:#4f8a70;--orange:#d47d55;--paper:#fbfcfa;--serif:Georgia,"Times New Roman",serif;--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:"SFMono-Regular",Consolas,monospace}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:#eef2ef;font-family:var(--sans)}button,select,input{font:inherit}button{cursor:pointer}.shell{max-width:1500px;margin:0 auto;background:var(--paper);min-height:100vh;box-shadow:0 0 50px rgba(30,55,64,.09)}
.hero{padding:34px 42px 29px;color:#fff;background:#193846}.hero-top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.brand{font:700 13px var(--mono);letter-spacing:.18em;color:#82c0cd}.hero h1{max-width:850px;margin:13px 0 8px;font:500 34px/1.15 var(--serif)}.hero p{max-width:850px;margin:0;color:#a7bbc2;font-size:13px;line-height:1.65}.stamp{padding:10px 13px;border:1px solid rgba(255,255,255,.18);color:#bdd0d5;font:11px/1.6 var(--mono);text-align:right}
.nav{position:sticky;top:0;z-index:10;padding:10px 24px;display:flex;gap:7px;overflow:auto;background:rgba(251,252,250,.96);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.nav button{min-width:max-content;padding:10px 14px;border:1px solid var(--line);color:#64767d;background:#fff;font-weight:700;font-size:12px}.nav button.active{color:#fff;background:var(--teal);border-color:var(--teal)}
.content{padding:24px 30px 48px}.notice{margin-bottom:18px;padding:12px 15px;color:#526b73;background:#edf5f4;border-left:3px solid var(--teal);font-size:12px;line-height:1.6}.view{display:none}.view.active{display:block}.section-head{margin:0 0 16px;display:flex;justify-content:space-between;gap:20px;align-items:end}.eyebrow{color:var(--teal);font:10px var(--mono);letter-spacing:.1em}.section-head h2{margin:5px 0 3px;font:500 25px var(--serif)}.section-head p{margin:0;color:var(--muted);font-size:12px}.section-head button,.download{padding:10px 13px;color:#fff;background:var(--teal);border:0;font-weight:700;font-size:11px}
.filters{margin-bottom:15px;padding:13px 15px;display:flex;align-items:end;gap:10px;flex-wrap:wrap;border:1px solid var(--line);background:#fff}.filters label{min-width:160px;display:flex;flex-direction:column;gap:5px;color:#66777e;font-size:10px;font-weight:700}.filters select,.filters input{min-height:38px;padding:0 10px;color:#304d58;background:#fff;border:1px solid #cfd9d6}.filters .download{margin-left:auto}
.kpis{margin-bottom:15px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi{min-height:105px;padding:17px;background:#fff;border:1px solid var(--line);border-top:3px solid #7badb8}.kpi:nth-child(2){border-top-color:#7ba88f}.kpi:nth-child(3){border-top-color:#c5a05d}.kpi:nth-child(4){border-top-color:#9a79a0}.kpi span{color:var(--muted);font-size:11px}.kpi strong{display:block;margin:8px 0 4px;font:500 29px var(--serif)}.kpi small{color:#94a0a4;font-size:10px}
.grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,.6fr);gap:14px}.panel{min-width:0;padding:18px;background:#fff;border:1px solid var(--line)}.panel h3{margin:0 0 5px;font:500 18px var(--serif)}.panel-note{margin:0 0 15px;color:var(--muted);font-size:11px}.chart{width:100%;height:430px;display:block;background:#fbfcfb}.tooltip{position:fixed;z-index:20;display:none;pointer-events:none;padding:7px 9px;color:#fff;background:#173b49;font:10px/1.5 var(--mono);box-shadow:0 5px 18px rgba(0,0,0,.2)}
.swatches{display:grid;grid-template-columns:repeat(10,1fr);gap:3px;max-height:430px;overflow:auto}.swatch{aspect-ratio:1;position:relative;border:1px solid rgba(0,0,0,.08)}.swatch span{position:absolute;inset:auto 2px 2px;padding:2px;overflow:hidden;color:#233a44;background:rgba(255,255,255,.78);font:8px var(--mono);white-space:nowrap;opacity:0}.swatch:hover span{opacity:1}
.table-wrap{margin-top:14px;max-height:600px;overflow:auto;border:1px solid var(--line);background:#fff}table{width:100%;border-collapse:collapse;font-size:11px}th{position:sticky;top:0;z-index:2;padding:9px 10px;color:#435b64;background:#edf3f1;text-align:left;white-space:nowrap}td{padding:8px 10px;border-top:1px solid #e8edeb;vertical-align:top}tr:hover td{background:#f7faf8}.mini-color{width:14px;height:14px;display:inline-block;margin-right:6px;border:1px solid rgba(0,0,0,.12);vertical-align:-3px}
.heatmap-wrap{overflow:auto;border:1px solid var(--line)}.heatmap{min-width:900px}.heatmap th:first-child,.heatmap td:first-child{position:sticky;left:0;z-index:3;background:#f5f8f6}.heat-cell{text-align:center;font:10px var(--mono)}.top-list{display:flex;flex-direction:column}.top-item{padding:9px 0;display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;border-bottom:1px solid #e8edeb}.top-item i{width:23px;height:23px;display:grid;place-items:center;color:#26788c;background:#e7f2f3;border-radius:50%;font:normal 10px var(--mono)}.top-item b{font-size:11px}.top-item strong{font:11px var(--mono)}
.group-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.group-card{padding:16px;background:#fff;border:1px solid var(--line)}.group-card header{display:flex;justify-content:space-between;gap:10px}.group-card h3{margin:0;font:500 17px var(--serif)}.tag{padding:4px 6px;color:#507064;background:#e7f2eb;font:9px var(--mono)}.tag.ai{color:#3a6773;background:#e5f1f3}.tag.unspecified{color:#727b7e;background:#eef0ef}.group-card p{margin:11px 0 0;color:var(--muted);font:10px/1.6 var(--mono)}.method-catalog{margin-top:16px}.method-catalog h3{margin:0 0 9px;font:500 19px var(--serif)}.method-table td:first-child{font-weight:700;white-space:nowrap}.method-status{display:inline-flex;padding:4px 7px;font:9px var(--mono);background:#e7f2eb;color:#3f745c}.method-status.not-applicable{background:#eef0ef;color:#707b7e}.method-status.error{background:#f7e9e5;color:#a25343}.method-reason{display:block;margin-top:4px;color:#89969a;font-size:9px}
.result-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px}.result-list{display:flex;flex-direction:column;gap:6px}.result-list button{padding:11px 12px;color:#51666e;background:#fff;border:1px solid var(--line);text-align:left;font-size:11px}.result-list button.active{color:#fff;background:var(--teal);border-color:var(--teal)}.result-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.result-summary div{padding:12px;background:var(--soft);border:1px solid var(--line)}.result-summary strong{display:block;font:500 20px var(--serif)}.result-summary span{color:var(--muted);font-size:9px}.warning{padding:10px 12px;color:#8a6335;background:#fbf4df;border-left:3px solid #cf9a49;font-size:11px}
.empty{padding:50px 20px;color:#819095;text-align:center;border:1px dashed #ccd7d4;background:#fff}.footer{padding:22px 30px;color:#7f8c90;background:#f2f5f3;border-top:1px solid var(--line);font:10px/1.7 var(--mono)}
@media(max-width:900px){.hero{padding:28px 22px}.hero-top,.section-head{align-items:flex-start;flex-direction:column}.content{padding:18px 15px 38px}.kpis{grid-template-columns:repeat(2,1fr)}.grid,.result-layout{grid-template-columns:1fr}.group-grid{grid-template-columns:1fr}.filters label{min-width:calc(50% - 5px)}.filters .download{width:100%;margin-left:0}.stamp{text-align:left}.swatches{grid-template-columns:repeat(6,1fr)}}`;

const REPORT_SCRIPT = `
(function(){
  'use strict';
  var D=JSON.parse(document.getElementById('report-data').textContent);
  var state={view:'overview',source:D.initialFilters.source||'全部来源',emotion:D.initialFilters.emotion||'全部情绪',color:D.initialFilters.color||'全部颜色',metric:'选择率',result:0,search:''};
  var palette={D38:'#F38EBB',F17:'#00904A',F4:'#DD4200',J0:'#262626',F0:'#808080',F29:'#007FD3',A0:'#F2F2F2',H35:'#6F2A78',I6:'#4B2819',G3:'#BB1F23',C9:'#FFBC00'};
  var tooltip=document.getElementById('tooltip');
  function text(v){return v===null||v===undefined?'':String(v)}
  function number(v){var n=Number(v);return Number.isFinite(n)?n:0}
  function unique(values){return Array.from(new Set(values.filter(Boolean)))}
  function esc(value){return text(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function cohort(value){return value==='human'?'人类':value==='ai'?'AI':'未指定'}
  function option(value,selected){return '<option'+(value===selected?' selected':'')+'>'+esc(value)+'</option>'}
  function csvCell(value){var raw=text(value);if(/^[=+@]/.test(raw))raw="'"+raw;return /[",\\n]/.test(raw)?'"'+raw.replace(/"/g,'""')+'"':raw}
  function downloadCsv(name,rows){if(!rows.length)return;var columns=unique(rows.flatMap(function(row){return Object.keys(row)}));var content='\\ufeff'+[columns.join(',')].concat(rows.map(function(row){return columns.map(function(c){return csvCell(row[c])}).join(',')})).join('\\n');var url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));var a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(url)},1000)}
  function table(rows,limit){if(!rows.length)return '<div class="empty">当前筛选没有数据</div>';var shown=rows.slice(0,limit||250),columns=unique(shown.flatMap(function(row){return Object.keys(row)}));return '<div class="table-wrap"><table><thead><tr>'+columns.map(function(c){return '<th>'+esc(c)+'</th>'}).join('')+'</tr></thead><tbody>'+shown.map(function(row){return '<tr>'+columns.map(function(c){var value=row[c],color=/hex|色值|标准HEX/i.test(c)&&/^#[0-9a-f]{6}$/i.test(text(value));return '<td>'+(color?'<i class="mini-color" style="background:'+esc(value)+'"></i>':'')+esc(value)+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>'+(rows.length>shown.length?'<p class="panel-note">当前显示前 '+shown.length.toLocaleString()+' / '+rows.length.toLocaleString()+' 行；CSV 下载包含当前报告内的全部行。</p>':'')}
  function filters(extra){var sources=unique(D.colors.map(function(r){return r.source}).concat(D.gew.map(function(r){return r['来源']}).concat(D.bidirectional.map(function(r){return r['来源']}))));var emotions=unique(D.colors.map(function(r){return r.emotion}).concat(D.gew.map(function(r){return r['情绪']}).concat(D.bidirectional.map(function(r){return r['情绪']}))));var colors=unique(D.gew.map(function(r){return r['颜色']}).concat(D.bidirectional.map(function(r){return r['标准色码']})));return '<div class="filters"><label>来源<select id="sourceFilter">'+option('全部来源',state.source)+sources.map(function(v){return option(v,state.source)}).join('')+'</select></label><label>情绪<select id="emotionFilter">'+option('全部情绪',state.emotion)+emotions.map(function(v){return option(v,state.emotion)}).join('')+'</select></label>'+(state.view==='task2'?'<label>颜色<select id="colorFilter">'+option('全部颜色',state.color)+colors.map(function(v){return option(v,state.color)}).join('')+'</select></label>':'')+(extra||'')+'<button class="download" id="csvButton">下载当前数据 CSV</button></div>'}
  function bindFilters(rows,name){var source=document.getElementById('sourceFilter'),emotion=document.getElementById('emotionFilter'),color=document.getElementById('colorFilter'),metric=document.getElementById('metricFilter');if(source)source.onchange=function(){state.source=this.value;render()};if(emotion)emotion.onchange=function(){state.emotion=this.value;render()};if(color)color.onchange=function(){state.color=this.value;render()};if(metric)metric.onchange=function(){state.metric=this.value;render()};var csv=document.getElementById('csvButton');if(csv)csv.onclick=function(){downloadCsv(name,rows)}}
  function kpis(items){return '<div class="kpis">'+items.map(function(item){return '<article class="kpi"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong><small>'+esc(item[2])+'</small></article>'}).join('')+'</div>'}
  function methodStatus(method){if(method.status==='included')return '已完整纳入';if(method.status==='error')return '计算失败';return '当前不适用'}
  function methodCatalog(){return '<div class="method-catalog"><h3>完整分析目录</h3><p class="panel-note">目录列出平台全部分析方法；“当前不适用”表示当前数据不满足该方法的来源数或人类/AI 分组条件，不属于导出遗漏。</p><div class="table-wrap"><table class="method-table"><thead><tr><th>分析模块</th><th>分析方法</th><th>状态</th><th>结果行</th><th>统计空间 / 输出</th></tr></thead><tbody>'+D.methods.map(function(m){return '<tr><td>'+esc(m.group)+'</td><td><b>'+esc(m.title)+'</b><span class="method-reason">'+esc(m.description)+'</span></td><td><span class="method-status '+esc(m.status)+'">'+methodStatus(m)+'</span>'+(m.reason?'<span class="method-reason">'+esc(m.reason)+'</span>':'')+'</td><td>'+number(m.resultRows).toLocaleString()+'</td><td>'+esc(m.space)+'<span class="method-reason">'+esc(m.output)+'</span></td></tr>'}).join('')+'</tbody></table></div></div>'}
  function overview(){var totalResultRows=D.results.reduce(function(sum,r){return sum+r.totalRows},0),included=D.methods.filter(function(m){return m.status==='included'}).length;document.getElementById('overview').innerHTML='<div class="section-head"><div><span class="eyebrow">REPORT OVERVIEW</span><h2>数据范围与分析资产</h2><p>'+esc(D.scopeLabel)+' · '+esc(D.schemaLabel)+'</p></div></div>'+kpis([['实验组',D.groups.length,'当前报告范围'],['全部分析方法',D.methods.length,included+' 项适用并已纳入'],['分析结果行',totalResultRows.toLocaleString(),'不截断，完整嵌入 HTML'],['情绪轮统计单元',D.gew.length.toLocaleString(),'来源×颜色×情绪聚合']])+'<div class="group-grid">'+D.groups.map(function(g){return '<article class="group-card"><header><h3>'+esc(g.label)+'</h3><span class="tag '+esc(g.cohort)+'">'+cohort(g.cohort)+'</span></header><p>'+esc(g.fileName)+'<br>'+esc(g.sheetName)+' · '+number(g.rowCount).toLocaleString()+' 行进入分析</p></article>'}).join('')+'</div>'+methodCatalog()}
  function filteredColors(){return D.colors.filter(function(r){return (state.source==='全部来源'||r.source===state.source)&&(state.emotion==='全部情绪'||r.emotion===state.emotion)})}
  function drawHs(rows){var canvas=document.getElementById('task1Chart');if(!canvas)return;var ctx=canvas.getContext('2d'),w=1000,h=430;canvas.width=w;canvas.height=h;ctx.clearRect(0,0,w,h);ctx.fillStyle='#fbfcfb';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#dfe6e3';ctx.lineWidth=1;for(var i=0;i<=4;i++){var x=55+i*225,y=375-i*82.5;ctx.beginPath();ctx.moveTo(x,25);ctx.lineTo(x,375);ctx.stroke();ctx.beginPath();ctx.moveTo(55,y);ctx.lineTo(955,y);ctx.stroke()}ctx.fillStyle='#75878d';ctx.font='11px sans-serif';ctx.textAlign='center';[0,90,180,270,360].forEach(function(v,i){ctx.fillText(v+'°',55+i*225,402)});ctx.save();ctx.translate(17,210);ctx.rotate(-Math.PI/2);ctx.fillText('HSV Saturation',0,0);ctx.restore();var points=rows.slice(0,12000).map(function(r){return{x:55+number(r.hsvH)/360*900,y:375-number(r.hsvS)*350,row:r}});points.forEach(function(p){ctx.globalAlpha=.68;ctx.fillStyle=p.row.hex||'#277b92';ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle='rgba(255,255,255,.65)';ctx.stroke()});canvas.onmousemove=function(event){var rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*w/rect.width,y=(event.clientY-rect.top)*h/rect.height,best=null,dist=100;points.forEach(function(p){var d=(p.x-x)*(p.x-x)+(p.y-y)*(p.y-y);if(d<dist){dist=d;best=p}});if(best){tooltip.style.display='block';tooltip.style.left=event.clientX+12+'px';tooltip.style.top=event.clientY+12+'px';tooltip.textContent=best.row.source+' · '+best.row.emotion+' · '+best.row.hex}else tooltip.style.display='none'};canvas.onmouseleave=function(){tooltip.style.display='none'}}
  function task1(){var rows=filteredColors(),avgS=rows.length?rows.reduce(function(s,r){return s+number(r.s)},0)/rows.length:0,avgL=rows.length?rows.reduce(function(s,r){return s+number(r.labL)},0)/rows.length:0;var exportRows=rows.map(function(r){return{来源:r.source,组类型:r.cohort,情绪:r.emotion,HEX:r.hex,HSL_H:r.h,HSL_S:r.s,HSL_L:r.l,HSV_H:r.hsvH,HSV_S:r.hsvS,HSV_V:r.hsvV,Lab_L:r.labL,Lab_a:r.labA,Lab_b:r.labB}});document.getElementById('task1').innerHTML='<div class="section-head"><div><span class="eyebrow">TASK 1 · WORD TO COLOR</span><h2>词选色交互分布</h2><p>筛选来源与情绪，查看 H–S 分布和原始色彩样本。</p></div></div>'+filters()+kpis([['有效色彩',rows.length.toLocaleString(),'当前筛选'],['来源',unique(rows.map(function(r){return r.source})).length,'独立组'],['平均 HSL 饱和度',(avgS*100).toFixed(1)+'%','S 0–1'],['平均 Lab 明度',avgL.toFixed(1),'CIE L*']])+'<div class="grid"><article class="panel"><h3>H–S 散点分布</h3><p class="panel-note">横轴为 HSV 色相角，纵轴为饱和度；悬停查看样本。</p><canvas id="task1Chart" class="chart"></canvas></article><article class="panel"><h3>色彩马赛克</h3><p class="panel-note">最多显示 500 个当前筛选色彩。</p><div class="swatches">'+rows.slice(0,500).map(function(r){return '<div class="swatch" style="background:'+esc(r.hex)+'"><span>'+esc(r.source+' · '+r.emotion+' · '+r.hex)+'</span></div>'}).join('')+'</div></article></div>'+table(exportRows,250);bindFilters(exportRows,'chromalab-task1-filtered.csv');drawHs(rows)}
  function filteredGew(){return D.gew.filter(function(r){return (state.source==='全部来源'||r['来源']===state.source)&&(state.emotion==='全部情绪'||r['情绪']===state.emotion)&&(state.color==='全部颜色'||r['颜色']===state.color)})}
  function task2(){var rows=filteredGew(),metric=state.metric,metricMax=metric==='选择率'?1:5,allColors=unique(rows.map(function(r){return r['颜色']})),allEmotions=unique(rows.map(function(r){return r['情绪']}));var cells={};rows.forEach(function(r){var key=r['情绪']+'\\u0000'+r['颜色'],entry=cells[key]||{sum:0,n:0};entry.sum+=number(r[metric]);entry.n+=1;cells[key]=entry});var heat='<div class="heatmap-wrap"><table class="heatmap"><thead><tr><th>情绪</th>'+allColors.map(function(c){return '<th><i class="mini-color" style="background:'+esc(palette[c]||'#ddd')+'"></i>'+esc(c)+'</th>'}).join('')+'</tr></thead><tbody>'+allEmotions.map(function(e){return '<tr><td><b>'+esc(e)+'</b></td>'+allColors.map(function(c){var v=cells[e+'\\u0000'+c],value=v?v.sum/v.n:0,alpha=.07+Math.min(1,value/metricMax)*.83;return '<td class="heat-cell" style="background:rgba(39,123,146,'+alpha.toFixed(3)+')">'+(metric==='选择率'?(value*100).toFixed(1)+'%':value.toFixed(2))+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>';var sorted=rows.slice().sort(function(a,b){return number(b[metric])-number(a[metric])}).slice(0,15);var extra='<label>指标<select id="metricFilter">'+['选择率','平均强度_全部','平均强度_已选择'].map(function(v){return option(v,metric)}).join('')+'</select></label>';document.getElementById('task2').innerHTML='<div class="section-head"><div><span class="eyebrow">TASK 2 · COLOR TO EMOTION</span><h2>颜色 × 情绪关联画像</h2><p>实验二仅包含来源×颜色×情绪聚合值，不包含参与者标识。</p></div></div>'+filters(extra)+kpis([['统计单元',rows.length.toLocaleString(),'当前筛选'],['来源',unique(rows.map(function(r){return r['来源']})).length,'独立组'],['颜色',allColors.length,'标准色'],['情绪',allEmotions.length,'GEW 情绪']])+'<div class="grid"><article class="panel"><h3>'+esc(metric)+'热力图</h3><p class="panel-note">选择“全部来源”时显示各来源等权平均。</p>'+heat+'</article><article class="panel"><h3>当前最高关联</h3><p class="panel-note">按所选指标排序。</p><div class="top-list">'+sorted.map(function(r,i){return '<div class="top-item"><i>'+(i+1)+'</i><b>'+esc(r['来源']+' · '+r['颜色']+' · '+r['情绪'])+'</b><strong>'+(metric==='选择率'?(number(r[metric])*100).toFixed(1)+'%':number(r[metric]).toFixed(2))+'</strong></div>'}).join('')+'</div></article></div>'+table(rows,250);bindFilters(rows,'chromalab-task2-filtered.csv')}
  function filteredBi(){return D.bidirectional.filter(function(r){return (state.source==='全部来源'||r['来源']===state.source)&&(state.emotion==='全部情绪'||r['情绪']===state.emotion)})}
  function drawBi(rows){var canvas=document.getElementById('biChart');if(!canvas)return;var ctx=canvas.getContext('2d'),w=1000,h=430;canvas.width=w;canvas.height=h;ctx.fillStyle='#fbfcfb';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#dfe6e3';for(var i=0;i<=5;i++){var x=55+i*180,y=375-i*70;ctx.beginPath();ctx.moveTo(x,25);ctx.lineTo(x,375);ctx.stroke();ctx.beginPath();ctx.moveTo(55,y);ctx.lineTo(955,y);ctx.stroke()}ctx.strokeStyle='#9c6b62';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(55,375);ctx.lineTo(955,25);ctx.stroke();ctx.setLineDash([]);rows.forEach(function(r){var x=55+number(r['词选色概率_P'])*900,y=375-number(r['色选词归一化综合_Q'])*350;ctx.globalAlpha=.72;ctx.fillStyle=r['标准HEX']||'#277b92';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill()});ctx.fillStyle='#75878d';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('词选色概率 P',505,415);ctx.save();ctx.translate(17,210);ctx.rotate(-Math.PI/2);ctx.fillText('色选词归一化综合 Q',0,0);ctx.restore()}
  function bidirectional(){var rows=filteredBi();document.getElementById('bidirectional').innerHTML='<div class="section-head"><div><span class="eyebrow">BIDIRECTIONAL EXPLORATION</span><h2>双向一致性与非对称性</h2><p>比较词选色概率 P 与色选词归一化综合 Q；该模块属于探索性分析。</p></div></div>'+filters()+kpis([['分析单元',rows.length.toLocaleString(),'当前筛选'],['来源',unique(rows.map(function(r){return r['来源']})).length,'独立组'],['情绪',unique(rows.map(function(r){return r['情绪']})).length,'双向可匹配'],['标准色',unique(rows.map(function(r){return r['标准色码']})).length,'ΔE00 映射']])+'<article class="panel"><h3>P–Q 双向散点</h3><p class="panel-note">对角线表示两个方向的归一化关联相等。</p><canvas id="biChart" class="chart"></canvas></article>'+table(rows,250);bindFilters(rows,'chromalab-bidirectional-filtered.csv');drawBi(rows)}
  function results(){var host=document.getElementById('results');if(!D.results.length){host.innerHTML='<div class="section-head"><div><span class="eyebrow">ANALYSIS RESULTS</span><h2>全部分析结果</h2></div></div>'+methodCatalog()+'<div class="empty">当前数据没有可运行并生成结果的分析任务，请查看完整分析目录中的条件说明。</div>';return}state.result=Math.min(state.result,D.results.length-1);var selected=D.results[state.result],search=state.search.toLowerCase(),rows=selected.rows.filter(function(row){return !search||Object.values(row).some(function(v){return text(v).toLowerCase().includes(search)})});host.innerHTML='<div class="section-head"><div><span class="eyebrow">ANALYSIS RESULTS</span><h2>全部适用分析结果</h2><p>导出时已自动计算全部适用任务；选择分析、搜索表格或下载完整 CSV。</p></div></div><div class="result-layout"><aside class="result-list">'+D.results.map(function(r,i){return '<button data-result="'+i+'" class="'+(i===state.result?'active':'')+'">'+esc(r.title)+' · '+r.totalRows.toLocaleString()+' 行</button>'}).join('')+'</aside><article class="panel"><h3>'+esc(selected.title)+'</h3>'+(selected.note?'<p class="panel-note">'+esc(selected.note)+'</p>':'')+'<div class="result-summary">'+selected.summary.map(function(s){return '<div><strong>'+esc(s.value)+'</strong><span>'+esc(s.label)+'</span></div>'}).join('')+'</div><div class="filters"><label>搜索当前结果<input id="resultSearch" value="'+esc(state.search)+'" placeholder="输入来源、情绪、颜色或数值"></label><button class="download" id="resultCsv">下载当前结果 CSV</button></div>'+table(rows,300)+'</article></div>'+methodCatalog();document.querySelectorAll('[data-result]').forEach(function(button){button.onclick=function(){state.result=Number(this.dataset.result);state.search='';render()}});var searchInput=document.getElementById('resultSearch');if(searchInput)searchInput.oninput=function(){state.search=this.value;results()};var csv=document.getElementById('resultCsv');if(csv)csv.onclick=function(){downloadCsv(selected.id+'.csv',rows)}}
  function render(){document.querySelectorAll('.view').forEach(function(v){v.classList.toggle('active',v.id===state.view)});document.querySelectorAll('.nav button').forEach(function(b){b.classList.toggle('active',b.dataset.view===state.view)});if(state.view==='overview')overview();else if(state.view==='task1')task1();else if(state.view==='task2')task2();else if(state.view==='bidirectional')bidirectional();else results()}
  document.querySelectorAll('.nav button').forEach(function(button){button.onclick=function(){state.view=this.dataset.view;render()}});render();
})();`;

export function buildInteractiveHtmlReport(payload: HtmlReportPayload) {
  const data = reportData(payload);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${payload.title.replace(/[<>&]/g, "")}</title>
  <style>${REPORT_STYLE}</style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div class="hero-top">
        <div><div class="brand">CHROMALAB · INTERACTIVE REPORT</div><h1>${payload.title.replace(/[<>&]/g, "")}</h1><p>可离线查看的单文件交互式数据报告。所有筛选和图表运算均在当前浏览器完成，不会向网络上传数据。</p></div>
        <div class="stamp">生成时间<br>${payload.generatedAt.replace(/[<>&]/g, "")}</div>
      </div>
    </header>
    <nav class="nav" aria-label="报告章节">
      <button class="active" data-view="overview">报告概览</button>
      <button data-view="task1">实验一 · 词选色</button>
      <button data-view="task2">实验二 · 情绪轮</button>
      <button data-view="bidirectional">双向整合</button>
      <button data-view="results">分析结果</button>
    </nav>
    <div class="content">
      <div class="notice">隐私说明：本报告不包含 API Key、模型访问凭证或实验运行控制；实验二仅嵌入聚合统计，不包含参与者标识。若原始组名或文件名包含敏感信息，请在发送前检查报告概览。</div>
      <section class="view active" id="overview"></section>
      <section class="view" id="task1"></section>
      <section class="view" id="task2"></section>
      <section class="view" id="bidirectional"></section>
      <section class="view" id="results"></section>
    </div>
    <footer class="footer">Chromalab 交互式数据报告 · 单文件离线版 · 展示报告不替代原始数据、分析配置和可复现归档。</footer>
  </main>
  <div class="tooltip" id="tooltip"></div>
  <script id="report-data" type="application/json">${safeJson(data)}</script>
  <script>${REPORT_SCRIPT}</script>
</body>
</html>`;
}
