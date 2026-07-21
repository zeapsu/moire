import { extractArxivId } from "@/lib/target";
import type { ScanSection, VisualizationBrief } from "@/lib/types";

export type SeededArtifact = {
  brief: VisualizationBrief;
  html: string;
};

type SeedDefinition = {
  title: string;
  concept: string;
  needles: string[];
  governingMath: string;
  groundingTerms: string[];
  parameters: VisualizationBrief["parameters"];
  expectedBehavior: string;
  caption: string;
  controls: string;
  stage?: string;
  script: string;
};

const ARTIFACT_CSS = `
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#071018;color:#edf7f7}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 82% 12%,#163642 0,transparent 34%),#071018}
main{display:grid;grid-template-rows:auto minmax(260px,1fr) auto;gap:14px;min-height:100vh;padding:18px}
header{display:flex;align-items:end;justify-content:space-between;gap:16px}h1{font:600 clamp(20px,3vw,32px)/1.05 Georgia,serif;margin:0;letter-spacing:-.03em}
.tag{color:#75e7d1;font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}
.stage{position:relative;min-height:260px;border:1px solid #294753;border-radius:18px;overflow:hidden;background:linear-gradient(145deg,#0c1d27,#071018)}
canvas{display:block;width:100%;height:100%;min-height:260px}.controls{display:flex;flex-wrap:wrap;gap:10px}.control{flex:1 1 180px;border:1px solid #294753;border-radius:12px;padding:9px 11px;background:#0b1921}
label{display:flex;justify-content:space-between;gap:8px;color:#b7cdcf;font-size:12px}output{color:#75e7d1;font-family:ui-monospace,monospace}
input[type=range]{width:100%;accent-color:#75e7d1}.caption{margin:0;color:#bdd0d2;font-size:13px;line-height:1.45}.caption strong{color:#fff}
@media(max-width:560px){main{padding:12px}.stage,canvas{min-height:230px}}
`;

function artifactHtml(definition: SeedDefinition): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${ARTIFACT_CSS}</style></head><body><main><header><div><span class="tag">Moiré field note</span><h1>${definition.title}</h1></div></header><section class="stage">${definition.stage ?? '<canvas id="view" width="960" height="500" aria-label="Interactive visualization"></canvas>'}</section><section><div class="controls">${definition.controls}</div><p class="caption"><strong>What you're seeing.</strong> ${definition.caption}</p></section></main><script>(()=>{${definition.script}\nwindow.setTimeout(()=>window.parent.postMessage({ready:true},'*'),50)})()</script></body></html>`;
}

function control(id: string, label: string, min: number, max: number, value: number, step: number): string {
  return `<div class="control"><label for="${id}">${label}<output id="${id}-out">${value}</output></label><input id="${id}" type="range" min="${min}" max="${max}" value="${value}" step="${step}"></div>`;
}

function pickSection(sections: ScanSection[], needles: string[], used: Set<string>): ScanSection | undefined {
  const normalized = needles.map((needle) => needle.toLowerCase());
  return sections.find((section) => {
    if (used.has(section.selector)) return false;
    const text = section.text.toLowerCase();
    return normalized.every((needle) => text.includes(needle));
  });
}

function instantiate(definitions: SeedDefinition[], sections: ScanSection[]): SeededArtifact[] | null {
  const used = new Set<string>();
  const artifacts: SeededArtifact[] = [];
  const normalizedSource = sections.map((section) => section.text).join("\n").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  for (const [index, definition] of definitions.entries()) {
    const anchor = pickSection(sections, definition.needles, used);
    if (!anchor) continue;
    if (
      !definition.groundingTerms.every((term) =>
        normalizedSource.includes(term.replace(/\s+/g, " ").trim().toLocaleLowerCase()),
      )
    ) continue;
    used.add(anchor.selector);
    artifacts.push({
      brief: {
        span_id: `s-${index + 1}`,
        anchor: {
          section: anchor.section,
          element_type: anchor.elementType,
          dom_selector: anchor.selector,
          text_excerpt: anchor.text.slice(0, 420),
        },
        title: definition.title,
        concept: definition.concept,
        viz_kind: "simulation",
        render: "2d",
        governing_math: definition.governingMath,
        grounding_terms: definition.groundingTerms,
        references: [],
        parameters: definition.parameters,
        expected_behavior: definition.expectedBehavior,
        score: 0.99 - index * 0.02,
      },
      html: artifactHtml(definition),
    });
  }
  return artifacts.length > 0 ? artifacts : null;
}

const ATTENTION_DEMOS: SeedDefinition[] = [
  {
    title: "Inside scaled dot-product attention",
    concept: "Dividing query-key dot products by √d_k changes the softmax weights on the values.",
    needles: ["softmax", "divide"],
    governingMath: "Attention(Q,K,V)=softmax(QK^T/sqrt(d_k))V",
    groundingTerms: ["Scaled Dot-Product Attention", "queries", "keys", "values", "softmax", "weights"],
    parameters: [
      { name: "Key dimension", symbol: "d_k", default: 64, min: 1, max: 256, unit: "" },
      { name: "Query", symbol: "Q", default: 2, min: 0, max: 5, unit: "row" },
    ],
    expectedBehavior: "Changing d_k changes the scale applied before softmax; changing the query shows another row of weights on the values.",
    caption: "Each row is a query and each column is a key. The dot products are divided by √d_k before softmax produces the weights on the values.",
    controls: `${control("key-dimension", "Key dimension dₖ", 1, 256, 64, 1)}${control("query", "Query row", 0, 5, 2, 1)}`,
    script: `
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),keyDimension=document.getElementById('key-dimension'),query=document.getElementById('query'),keyDimensionOut=document.getElementById('key-dimension-out'),queryOut=document.getElementById('query-out');
const words=['The','model','learns','what','to','attend'];
function draw(){const dk=+keyDimension.value,q=+query.value,scale=Math.sqrt(dk)/8;keyDimensionOut.value=dk;queryOut.value=words[q];const w=canvas.width,h=canvas.height,pad=92,size=Math.min(58,(w-pad-30)/6);ctx.clearRect(0,0,w,h);ctx.font='16px system-ui';ctx.fillStyle='#9db6ba';words.forEach((x,i)=>{ctx.fillText(x,pad+i*size+5,48);ctx.fillText(x,18,98+i*size)});for(let r=0;r<6;r++){const logits=words.map((_,c)=>(2.2*Math.cos((r-c)*1.12)+((r*3+c*5)%7)/9)/scale),mx=Math.max(...logits),raw=logits.map(v=>Math.exp(v-mx)),sum=raw.reduce((a,b)=>a+b,0);raw.forEach((v,c)=>{const p=v/sum,x=pad+c*size,y=62+r*size;ctx.fillStyle=r===q?'rgba(117,231,209,'+(0.12+p*.88)+')':'rgba(70,112,139,'+(0.08+p*.62)+')';ctx.fillRect(x,y,size-4,size-4);ctx.fillStyle=p>.18?'#071018':'#d5e5e7';ctx.fillText(p.toFixed(2),x+10,y+34)});if(r===q){ctx.strokeStyle='#75e7d1';ctx.lineWidth=3;ctx.strokeRect(pad-4,58+r*size,6*size+2,size+4)}}}
keyDimension.addEventListener('input',draw);query.addEventListener('input',draw);draw();`,
  },
  {
    title: "Multi-head attention in parallel",
    concept: "Queries, keys, and values are linearly projected h times in parallel before the outputs are concatenated.",
    needles: ["linearly project"],
    governingMath: "MultiHead(Q,K,V)=Concat(head_1,...,head_h)W^O",
    groundingTerms: ["queries", "keys", "values", "linearly project", "in parallel", "concatenated"],
    parameters: [
      { name: "Head", symbol: "h_i", default: 1, min: 1, max: 4, unit: "index" },
      { name: "Focus", symbol: "alpha", default: 0.7, min: 0.2, max: 1, unit: "" },
    ],
    expectedBehavior: "Changing the head shows a different projected representation; increasing the weight strengthens its displayed relations.",
    caption: "The queries, keys, and values are linearly projected in parallel. Change the displayed head before the outputs are concatenated.",
    controls: `${control("head", "Head", 1, 4, 1, 1)}${control("focus", "Weight", 0.2, 1, 0.7, 0.05)}`,
    script: `
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),head=document.getElementById('head'),focus=document.getElementById('focus'),headOut=document.getElementById('head-out'),focusOut=document.getElementById('focus-out');const words=['A','small','bird','crossed','the','bright','sky'];
function draw(){const n=+head.value,f=+focus.value;headOut.value=n;focusOut.value=Math.round(f*100)+'%';ctx.clearRect(0,0,canvas.width,canvas.height);const xs=words.map((_,i)=>82+i*128),y=385;ctx.font='18px system-ui';ctx.textAlign='center';words.forEach((word,i)=>{ctx.fillStyle='#dcebed';ctx.fillText(word,xs[i],y+45);ctx.beginPath();ctx.fillStyle='#163747';ctx.arc(xs[i],y,24,0,Math.PI*2);ctx.fill()});const pairs=n===1?[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]]:n===2?[[0,6],[1,5],[2,4],[3,3]]:n===3?[[2,3],[3,0],[3,6],[5,6]]:[[0,3],[1,3],[2,3],[4,3],[5,3],[6,3]];pairs.forEach((pair,i)=>{const a=xs[pair[0]],b=xs[pair[1]],lift=85+Math.abs(pair[1]-pair[0])*20;ctx.beginPath();ctx.moveTo(a,y-20);ctx.quadraticCurveTo((a+b)/2,y-lift,b,y-20);ctx.strokeStyle='rgba(117,231,209,'+(f*(.35+(i%3)*.22))+')';ctx.lineWidth=2+(i%3);ctx.stroke()});ctx.fillStyle='#75e7d1';ctx.font='700 14px ui-monospace';ctx.fillText('HEAD '+n,canvas.width/2,55)}
head.addEventListener('input',draw);focus.addEventListener('input',draw);draw();`,
  },
  {
    title: "Sine and cosine positional encodings",
    concept: "Sine and cosine functions of different frequencies add relative or absolute position information.",
    needles: ["positional encodings", "order"],
    governingMath: "PE(pos,2i)=sin(pos/10000^(2i/d_model)); PE(pos,2i+1)=cos(...) ",
    groundingTerms: ["positional encodings", "relative or absolute position", "sine and cosine functions", "different frequencies"],
    parameters: [
      { name: "Position", symbol: "pos", default: 18, min: 0, max: 80, unit: "token" },
      { name: "Dimension", symbol: "i", default: 4, min: 0, max: 15, unit: "channel" },
    ],
    expectedBehavior: "Position moves the sample; changing dimension changes the frequency of the sine or cosine function.",
    caption: "The positional encoding uses sine and cosine functions of different frequencies. The sample shows one position and dimension.",
    controls: `${control("position", "Position", 0, 80, 18, 1)}${control("dimension", "Dimension i", 0, 15, 4, 1)}`,
    script: `
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),position=document.getElementById('position'),dimension=document.getElementById('dimension'),positionOut=document.getElementById('position-out'),dimensionOut=document.getElementById('dimension-out');
function draw(){const pos=+position.value,dim=+dimension.value;positionOut.value=pos;dimensionOut.value=dim;ctx.clearRect(0,0,canvas.width,canvas.height);const left=60,right=920,top=60,bottom=430,scale=Math.pow(10000,2*Math.floor(dim/2)/32),fn=dim%2?Math.cos:Math.sin;ctx.strokeStyle='#294753';ctx.beginPath();ctx.moveTo(left,(top+bottom)/2);ctx.lineTo(right,(top+bottom)/2);ctx.stroke();ctx.beginPath();for(let x=0;x<=80;x++){const px=left+x/80*(right-left),py=(top+bottom)/2-fn(x/scale)*135;x?ctx.lineTo(px,py):ctx.moveTo(px,py)}ctx.strokeStyle='#75e7d1';ctx.lineWidth=4;ctx.stroke();const px=left+pos/80*(right-left),value=fn(pos/scale),py=(top+bottom)/2-value*135;ctx.setLineDash([7,7]);ctx.strokeStyle='#e8a96b';ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,bottom);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e8a96b';ctx.beginPath();ctx.arc(px,py,9,0,Math.PI*2);ctx.fill();ctx.font='16px ui-monospace';ctx.fillText((dim%2?'cos':'sin')+' = '+value.toFixed(3),left,35)}
position.addEventListener('input',draw);dimension.addEventListener('input',draw);draw();`,
  },
];

const PHYSICS_DEMOS: SeedDefinition[] = [
  {
    title: "Number of domains and quench time",
    concept: "The number of domains produced in the quench scales with quench time.",
    needles: ["number of domains", "quench time"],
    governingMath: "N_q ~ tau_q^(-nu/(1+nu z))",
    groundingTerms: ["number of domains", "quench time", "power law", "scaling"],
    parameters: [
      { name: "Quench time", symbol: "tau_q", default: 80, min: 10, max: 400, unit: "ms" },
      { name: "Scaling exponent", symbol: "nu/(1+nu z)", default: 0.33, min: 0.2, max: 0.6, unit: "" },
    ],
    expectedBehavior: "Changing quench time changes the number of domains according to the selected power law.",
    caption: "The strip shows how the number and size of domains vary with quench time according to the power law.",
    controls: `${control("quench", "Quench time", 10, 400, 80, 5)}${control("exponent", "KZM exponent", 0.2, 0.6, 0.33, 0.01)}`,
    script: `
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),quench=document.getElementById('quench'),exponent=document.getElementById('exponent'),quenchOut=document.getElementById('quench-out'),exponentOut=document.getElementById('exponent-out');
function draw(){const tq=+quench.value,a=+exponent.value,N=Math.max(2,Math.round(20*Math.pow(tq/10,-a)));quenchOut.value=tq+' ms';exponentOut.value=a.toFixed(2);ctx.clearRect(0,0,canvas.width,canvas.height);const x0=55,w=850,y=165,h=135;for(let i=0;i<N;i++){const x=x0+i*w/N,ww=w/N+1;ctx.fillStyle=i%2?'#e8a96b':'#75e7d1';ctx.globalAlpha=.78;ctx.fillRect(x,y,ww,h);ctx.globalAlpha=1;if(i>0){ctx.fillStyle='#fff';ctx.fillRect(x-1,y-12,2,h+24)}}ctx.fillStyle='#b9cdcf';ctx.font='15px system-ui';ctx.fillText('− magnetization',x0,y+h+42);ctx.fillText('+ magnetization',x0+w-112,y+h+42);ctx.fillStyle='#fff';ctx.font='600 24px Georgia';ctx.fillText(N+' domains · '+(N-1)+' walls',x0,78);ctx.strokeStyle='#294753';ctx.strokeRect(x0,y,w,h)}
quench.addEventListener('input',draw);exponent.addEventListener('input',draw);draw();`,
  },
  {
    title: "Freezing time and non-adiabatic evolution",
    concept: "The freezing time defines when the evolution becomes non-adiabatic.",
    needles: ["freezing time", "non-adiabatic"],
    governingMath: "hat(t)=(tau_0 tau_q^(nu z))^(1/(1+nu z))",
    groundingTerms: ["freezing time", "KZM", "non-adiabatic", "quench time scale", "relaxation time"],
    parameters: [
      { name: "Quench time", symbol: "tau_q", default: 120, min: 20, max: 400, unit: "ms" },
      { name: "Dynamic exponent", symbol: "z", default: 2, min: 1, max: 3, unit: "" },
    ],
    expectedBehavior: "Changing quench time or z changes the freezing time obtained from the quench and relaxation time scales.",
    caption: "The freezing time is identified by equating the quench time scale to the relaxation time; the highlighted interval marks non-adiabatic evolution.",
    controls: `${control("freeze-quench", "Quench time", 20, 400, 120, 5)}${control("dynamic-z", "Dynamic exponent z", 1, 3, 2, 0.05)}`,
    script: `
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),quench=document.getElementById('freeze-quench'),z=document.getElementById('dynamic-z'),quenchOut=document.getElementById('freeze-quench-out'),zOut=document.getElementById('dynamic-z-out');
function draw(){const tq=+quench.value,dz=+z.value,hat=Math.min(36,7*Math.pow(tq/20,dz/(1+dz)));quenchOut.value=tq+' ms';zOut.value=dz.toFixed(2);ctx.clearRect(0,0,canvas.width,canvas.height);const left=70,right=900,mid=485,base=395,sx=(right-left)/100;ctx.fillStyle='rgba(232,169,107,.15)';ctx.fillRect(mid-hat*sx,55,hat*2*sx,base-35);ctx.strokeStyle='#e8a96b';ctx.setLineDash([7,6]);ctx.beginPath();ctx.moveTo(mid-hat*sx,55);ctx.lineTo(mid-hat*sx,base);ctx.moveTo(mid+hat*sx,55);ctx.lineTo(mid+hat*sx,base);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();for(let t=-50;t<=50;t++){const x=mid+t*sx,y=base-270/(Math.abs(t)/7+1);t===-50?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.strokeStyle='#75e7d1';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#6f8790';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left,base-25);ctx.lineTo(mid,55);ctx.lineTo(right,base-25);ctx.stroke();ctx.fillStyle='#fff';ctx.font='18px system-ui';ctx.fillText('relaxation time',78,92);ctx.fillStyle='#e8a96b';ctx.fillText('freeze-out  ±'+hat.toFixed(1)+' ms',mid-92,42)}
quench.addEventListener('input',draw);z.addEventListener('input',draw);draw();`,
  },
  {
    title: "Lower branch with one or two minima",
    concept: "The lower branch has one or two minima depending on Ω.",
    needles: ["lower branch", "dispersion"],
    governingMath: "E_-(k)=k^2/2-sqrt((gamma k-delta/2)^2+(Omega/2)^2)",
    groundingTerms: ["lower branch", "dispersion", "one or two minima"],
    parameters: [
      { name: "Raman coupling", symbol: "Omega/Omega_c", default: 0.75, min: 0.4, max: 1.5, unit: "" },
      { name: "Detuning", symbol: "delta", default: 0, min: -0.8, max: 0.8, unit: "E_r" },
    ],
    expectedBehavior: "Changing Ω shows when the lower branch has one or two minima; detuning changes the displayed dispersion.",
    caption: "The curves show the dispersion branches. Change Ω to see when the lower branch has one or two minima.",
    controls: `${control("raman", "Raman coupling Ω/Ωc", 0.4, 1.5, 0.75, 0.01)}${control("detuning", "Detuning δ", -0.8, 0.8, 0, 0.02)}`,
    script: `
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),raman=document.getElementById('raman'),detuning=document.getElementById('detuning'),ramanOut=document.getElementById('raman-out'),detuningOut=document.getElementById('detuning-out');
function draw(){const O=+raman.value,D=+detuning.value;ramanOut.value=O.toFixed(2);detuningOut.value=D.toFixed(2);ctx.clearRect(0,0,canvas.width,canvas.height);const left=70,right=910,midY=265,scaleX=(right-left)/6;ctx.strokeStyle='#294753';ctx.beginPath();ctx.moveTo(left,midY);ctx.lineTo(right,midY);ctx.moveTo((left+right)/2,45);ctx.lineTo((left+right)/2,450);ctx.stroke();for(const branch of [-1,1]){ctx.beginPath();for(let i=0;i<=240;i++){const k=-3+i/40,E=.42*k*k+branch*Math.sqrt((1.15*k-D/2)**2+(O*1.25)**2),x=(left+right)/2+k*scaleX,y=midY-E*62;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.strokeStyle=branch<0?'#75e7d1':'#e8a96b';ctx.lineWidth=4;ctx.stroke()}ctx.fillStyle='#b9cdcf';ctx.font='14px ui-monospace';ctx.fillText('momentum k',right-92,midY+28);ctx.fillStyle='#75e7d1';ctx.fillText(O<1?'TWO-MINIMUM PHASE':'SINGLE-MINIMUM PHASE',70,42)}
raman.addEventListener('input',draw);detuning.addEventListener('input',draw);draw();`,
  },
];

const PENDULUM_DEMOS: SeedDefinition[] = [
  {
    title: "Nearly identical initial conditions diverge",
    concept: "Two double pendulums with nearly identical initial conditions diverge over time.",
    needles: ["nearly identical", "diverge"],
    governingMath: "Coupled nonlinear Euler-Lagrange equations for theta_1 and theta_2",
    groundingTerms: ["nearly identical", "initial conditions", "diverge"],
    parameters: [
      { name: "Initial angle", symbol: "theta_1", default: 118, min: 60, max: 170, unit: "deg" },
      { name: "Difference", symbol: "Delta theta", default: 1, min: 0.1, max: 4, unit: "deg" },
    ],
    expectedBehavior: "The trajectories begin together and then diverge; reset occurs whenever a slider moves.",
    caption: "Both systems begin almost on top of each other. Their colored trails separate because a double pendulum amplifies tiny changes in its initial state.",
    controls: `${control("angle", "Starting angle", 60, 170, 118, 1)}${control("difference", "Initial difference", 0.1, 4, 1, 0.1)}`,
    script: `
const canvas=document.getElementById('view'),ctx=canvas.getContext('2d'),angle=document.getElementById('angle'),difference=document.getElementById('difference'),angleOut=document.getElementById('angle-out'),differenceOut=document.getElementById('difference-out');let systems=[],last=0;
function reset(){const a=+angle.value*Math.PI/180,d=+difference.value*Math.PI/180;angleOut.value=angle.value+'°';differenceOut.value=(+difference.value).toFixed(1)+'°';systems=[[a,a*.72,0,0,'#75e7d1',[]],[a+d,a*.72,0,0,'#e8a96b',[]]]}
function step(s,dt){let[a,b,va,vb]=s,g=9.81,L=1,m=1,delta=a-b,den=2*m-m*Math.cos(2*delta),aa=(-g*(2*m)*Math.sin(a)-m*g*Math.sin(a-2*b)-2*Math.sin(delta)*m*(vb*vb*L+va*va*L*Math.cos(delta)))/(L*den),ab=(2*Math.sin(delta)*(va*va*L*(2*m)+g*(2*m)*Math.cos(a)+vb*vb*L*m*Math.cos(delta)))/(L*den);s[2]+=aa*dt;s[3]+=ab*dt;s[0]+=s[2]*dt;s[1]+=s[3]*dt}
function draw(t){if(!last)last=t;const dt=Math.min(.018,(t-last)/1000||.016);last=t;for(let n=0;n<2;n++)step(systems[n],dt);ctx.fillStyle='rgba(7,16,24,.12)';ctx.fillRect(0,0,canvas.width,canvas.height);const ox=480,oy=180,L=135;systems.forEach(s=>{const x1=ox+L*Math.sin(s[0]),y1=oy+L*Math.cos(s[0]),x2=x1+L*Math.sin(s[1]),y2=y1+L*Math.cos(s[1]);s[5].push([x2,y2]);if(s[5].length>180)s[5].shift();ctx.beginPath();s[5].forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=s[4]+'99';ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=s[4];ctx.lineWidth=5;ctx.stroke();ctx.fillStyle=s[4];ctx.beginPath();ctx.arc(x1,y1,10,0,Math.PI*2);ctx.arc(x2,y2,13,0,Math.PI*2);ctx.fill()});requestAnimationFrame(draw)}
angle.addEventListener('input',reset);difference.addEventListener('input',reset);reset();requestAnimationFrame(draw);`,
  },
];

export function seededArtifactsFor(targetUrl: string, sections: ScanSection[]): SeededArtifact[] | null {
  const arxivId = extractArxivId(targetUrl);
  if (arxivId?.replace(/v\d+$/i, "") === "1706.03762") return instantiate(ATTENTION_DEMOS, sections);
  if (arxivId?.replace(/v\d+$/i, "") === "1811.05327") return instantiate(PHYSICS_DEMOS, sections);

  const url = new URL(targetUrl);
  if (url.hostname.toLowerCase().endsWith("wikipedia.org") && url.pathname.toLowerCase() === "/wiki/double_pendulum") {
    return instantiate(PENDULUM_DEMOS, sections);
  }
  return null;
}
