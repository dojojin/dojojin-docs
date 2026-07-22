// Person Data (body appearance) Redesign — DRAFT demo logic (CSP-compliant, no inline handlers).
// Field names mirror prod /api/appearances. Rows/charts = mock. Avatars synthetic (PDPA).
(function(){
  const $ = id => document.getElementById(id);
  const token = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const pad = n => String(n).padStart(2,'0');
  const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // ───────── prod vocab (mirrors page-snapshots.js _APP_*/_COLOR_HEX) ─────────
  const COLOR = {
    Black:['ดำ','#444'], White:['ขาว','#eee'], Gray:['เทา','#888'], Blue:['น้ำเงิน','#3b7fe0'],
    Green:['เขียว','#3be06a'], Red:['แดง','#e03b3b'], Orange:['ส้ม','#e07a3b'], Yellow:['เหลือง','#e0d43b'],
    Purple:['ม่วง','#7a3be0'], Brown:['น้ำตาล','#8b5c2a'], Beige:['เบจ','#d4c49a'], Blonde:['บลอนด์','#b88b50'],
    Magenta:['ชมพูบานเย็น','#e03be0'], Mixture:['หลากสี','#9aa0aa'], Unknown:['ไม่ทราบ','#6b7280'],
  };
  const cTh = c => (COLOR[c]||[])[0] || c;
  const cHex= c => (COLOR[c]||[])[1] || '#6b7280';
  const TOP = { ShortSleeve:'แขนสั้น', LongSleeve:'แขนยาว', Sleeveless:'กล้าม', Jacket:'แจ็คเก็ต', Coat:'โค้ต', Vest:'เสื้อกั๊ก', Unknown:'ไม่ทราบ' };
  const BOT = { Trousers:'กางเกงขายาว', Shorts:'กางเกงขาสั้น', Skirt:'กระโปรง', Dress:'ชุดเดรส', Unknown:'ไม่ทราบ' };
  const HAIRL = { Short:'สั้น', Long:'ยาว', Medium:'กลาง', Bald:'หัวล้าน' };
  const AGE = { youth:'วัยหนุ่มสาว', working:'วัยทำงาน', middle:'วัยกลางคน', senior:'สูงอายุ' };
  const BAG = { ShoulderBag:'กระเป๋าสะพายข้าง', Backpack:'เป้สะพายหลัง', Briefcase:'กระเป๋าเอกสาร' };
  const DIRT = { leftward:'ซ้าย', rightward:'ขวา', forward:'หน้า', backward:'หลัง' };
  const EXPR = ['ยิ้มแย้ม','หน้านิ่ง','เศร้า','ประหลาดใจ','ไม่พอใจ','โกรธ','อื่นๆ'];
  const CAMS = [
    { id:'HIK-PT-01', name:'ทางเข้าหลัก' },{ id:'HIK-PT-02', name:'ล็อบบี้' },
    { id:'HIK-PT-03', name:'ประตูพนักงาน' },{ id:'HIK-PT-04', name:'ลานจอด' },{ id:'HIK-PT-05', name:'โถงกลาง' },
  ];
  const camName = id => (CAMS.find(c=>c.id===id)||{}).name || id;

  // distribution (real proportions from prod screenshot, 7-day)
  const TOP_COLOR = [['Blue',44],['Gray',21],['Black',19],['Green',5],['White',4],['Mixture',2],['Beige',2],['Purple',1],['Yellow',1],['Magenta',0],['Brown',0]];
  const BOT_COLOR = [['Black',41],['Blue',31],['Gray',23],['Unknown',2],['Beige',2],['Green',2],['Brown',1],['White',0]];
  const HAIR_COLOR= [['Black',75],['Brown',13],['Gray',10],['Blonde',2]];
  const TOP_TYPE  = [['ShortSleeve',1180],['LongSleeve',940],['Unknown',60]];
  const BOT_TYPE  = [['Trousers',1820],['Unknown',120],['Shorts',90],['Skirt',40]];
  const HAIR_LEN  = [['Short',1180],['Long',560]];
  const AGE_DIST  = [['working',470],['middle',430],['youth',150],['senior',40]];
  const DIR_DIST  = [['leftward',180],['rightward',140],['forward',20],['backward',12]];
  const EXPR_DIST = [388,260,160,55,45,30,8];
  const ACC = [['แว่นตา',379],['กระเป๋าสะพาย',146],['กระเป๋าเป้',32],['หน้ากากอนามัย',25],['หมวก',26]];
  const CAM_DIST  = [['HIK-PT-01',640],['HIK-PT-05',520],['HIK-PT-02',430],['HIK-PT-03',210],['HIK-PT-04',140]];

  const PERIODS = {
    today:    { total:262, peakH:18, label:'วันนี้',  k:1 },
    yesterday:{ total:241, peakH:17, label:'เมื่อวาน', k:.92 },
    week:     { total:1940,peakH:18, label:'7 วัน',   k:7.4 },
    month:    { total:8200,peakH:18, label:'1 เดือน',  k:31 },
    custom:   { total:520, peakH:18, label:'กำหนดเอง', k:2 },
  };
  let period = 'week';

  // ───────── synthetic body avatar (clothing-colored) ─────────
  function avatar(o, mode){
    o=o||{}; mode=mode||'body';
    const seed=(o.seed|0), female=o.gender==='F';
    const skins=['#e8b48c','#d99a6c','#c8845a','#a9683f','#8a5230'];
    const skin=skins[seed%skins.length];
    const hair=o.hair_color?cHex(o.hair_color):'#2b2620';
    const long=o.hair_length==='Long';
    const bg=female?'#241a22':'#161b29';
    const jh=cHex(o.upper_color), th=cHex(o.lower_color);
    const skirt = o.bottom_category==='Skirt'||o.bottom_category==='Dress';
    const hairCap = (female||long)
      ? `<path d="M27 22 Q40 8 53 22 L54 40 Q55 20 40 18 Q25 20 26 40 Z" fill="${hair}"/>`
      : `<path d="M28 21 Q40 11 52 21 L52 26 Q48 18 40 18 Q32 18 28 26 Z" fill="${hair}"/>`;
    const glasses = o.glasses ? `<g stroke="rgba(255,255,255,.7)" stroke-width="1.6" fill="none"><circle cx="35" cy="29" r="3.4"/><circle cx="45" cy="29" r="3.4"/><line x1="38.4" y1="29" x2="41.6" y2="29"/></g>` : '';
    const mask = o.mask ? `<path d="M33 31 Q40 30 47 31 L46 37 Q40 41 34 37 Z" fill="rgba(255,255,255,.82)"/>` : '';
    const hat = o.hat ? `<path d="M27 18 Q40 6 53 18 L53 21 Q40 14 27 21 Z" fill="#3a4254"/>` : '';
    const legs = skirt
      ? `<path d="M31 96 L49 96 L53 134 L27 134 Z" fill="${th}"/>`
      : `<rect x="31" y="96" width="8" height="44" rx="2" fill="${th}"/><rect x="41" y="96" width="8" height="44" rx="2" fill="${th}"/>`;
    const bagEl = o.bag_category==='Backpack' ? `<rect x="50" y="56" width="9" height="22" rx="3" fill="#2f3645"/>` : '';
    return `<svg viewBox="0 0 80 150" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
      <rect width="80" height="150" fill="${bg}"/>
      ${legs}
      <path d="M27 50 Q40 43 53 50 L57 98 L23 98 Z" fill="${jh}"/>
      <path d="M27 52 L19 86 L24 89 L31 58 Z" fill="${jh}"/><path d="M53 52 L61 86 L56 89 L49 58 Z" fill="${jh}"/>
      ${bagEl}
      <rect x="36" y="40" width="8" height="11" fill="${skin}"/>
      <ellipse cx="40" cy="30" rx="12" ry="14" fill="${skin}"/>
      ${hairCap}${hat}
      <circle cx="35.5" cy="30" r="1.3" fill="#1c1c1c"/><circle cx="44.5" cy="30" r="1.3" fill="#1c1c1c"/>
      ${glasses}${mask}
    </svg>`;
  }

  // ───────── mock person rows ─────────
  function pick(dist,i){ return dist[i%dist.length][0]; }
  function mkPerson(i){
    const female = i%3===0;
    const bots = female ? ['Trousers','Skirt','Dress','Shorts'] : ['Trousers','Shorts','Trousers'];
    return {
      id:7000+i, gender:female?'F':'M',
      top_category: pick(TOP_TYPE,i), upper_color: TOP_COLOR[i%8][0],
      bottom_category: bots[i%bots.length], lower_color: BOT_COLOR[i%6][0],
      hair_length: i%3===0?'Long':'Short', hair_color: HAIR_COLOR[i%4][0],
      glasses: i%4===0, hat: i%6===0, mask: i%7===0,
      bag_category: i%3===0?'Backpack':i%5===0?'ShoulderBag':null,
      age_group: AGE_DIST[i%4][0], expression: EXPR[i%EXPR.length],
      direction: DIR_DIST[i%4][0], camera_id: CAMS[i%CAMS.length].id,
      confidence: 0.74 + (i*5%24)/100,
      time:['18:42','18:31','18:18','18:05','17:52','17:40'][i]||('17:'+pad(39-(i%39))),
      seed:i+1,
    };
  }
  let RESULTS = Array.from({length:48},(_,i)=>mkPerson(i));

  // ───────── KPI ─────────
  function renderKpi(){
    const d=PERIODS[period];
    const topCam=CAM_DIST[0];
    const items=[
      { ka:'var(--accent)', l:'คนที่ตรวจพบ', v:d.total.toLocaleString(), s:'ช่วง '+d.label,
        icon:'<circle cx="9" cy="7" r="3"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M16 7a3 3 0 0 1 0 6"/><path d="M21 19c0-2.4-1.6-4.2-4-4.8"/>' },
      { ka:'var(--warn)', l:'ช่วง Peak', v:pad(d.peakH)+':00', s:'คนเยอะสุดของวัน',
        icon:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
      { ka:'var(--purple)', l:'จุดที่คนเยอะสุด', v:camName(topCam[0]), s:topCam[1].toLocaleString()+' คน',
        icon:'<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>' },
      { ka:'var(--status-ok)', l:'สัดส่วน ช / ญ', v:'62 / 38%', s:'ชาย ' + Math.round(d.total*.62)+' · หญิง '+Math.round(d.total*.38),
        icon:'<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="3"/><path d="M3 19c0-3 2.7-5 6-5"/>' },
    ];
    $('kpiGrid').innerHTML = items.map(k=>`
      <div class="kpi" style="--ka:${k.ka}">
        <div class="ki" style="color:${k.ka}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${k.icon}</svg></div>
        <div class="kl">${k.l}</div><div class="kv">${k.v}</div><div class="ks">${k.s}</div>
      </div>`).join('');
  }

  // ───────── horizontal-bar distribution lists ─────────
  function renderHbars(){
    const max = arr => Math.max(...arr.map(x=>x[1]));
    const list = (arr, withSw) => {
      const m = max(arr)||1;
      return arr.map(([c,v])=>`<div class="hbar">
        ${withSw?`<span class="sw" style="background:${cHex(c)}"></span>`:''}
        <span class="nm">${esc(cTh(c))}</span>
        <span class="track"><span class="fill" style="width:${Math.max(2,v/m*100)}%;background:${withSw?cHex(c):'var(--accent)'}"></span></span>
        <span class="pct">${v}%</span></div>`).join('');
    };
    $('topColorList').innerHTML = list(TOP_COLOR,true);
    $('botColorList').innerHTML = list(BOT_COLOR,true);
    $('hairColorList').innerHTML = list(HAIR_COLOR,true);
  }
  function renderAcc(){
    $('accRow').innerHTML = ACC.map(([l,v])=>`<div class="acc-chip"><div class="acc-v">${v}</div><div class="acc-l">${l}</div></div>`).join('');
  }

  // ───────── charts ─────────
  let charts=[], forensicCharts=[], forensicBuilt=false;
  function hbarOpts(grid){ return { indexAxis:'y', plugins:{legend:{display:false}}, maintainAspectRatio:false, responsive:true,
    scales:{ x:{grid:{color:grid},beginAtZero:true,ticks:{font:{size:10}}}, y:{grid:{display:false},ticks:{font:{size:11}}} } }; }
  function renderCharts(){
    charts.forEach(c=>c.destroy()); charts=[];
    if (typeof Chart==='undefined') return;
    const dim=token('--text-secondary')||'#888', grid='rgba(128,128,128,.12)', accent=token('--accent')||'#5b8def', bad=token('--status-bad')||'#ef4444';
    Chart.defaults.color=dim; Chart.defaults.font.family=token('--ui-font-family')||'sans-serif';
    const k=PERIODS[period].k;
    // volume per day (7)
    charts.push(new Chart($('chVolume'),{ type:'bar',
      data:{ labels:['11','12','13','14','15','16','17 มิ.ย.'], datasets:[{ data:[80,420,360,690,640,860,820].map(v=>Math.round(v*(period==='today'?.3:1))), backgroundColor:accent+'cc', borderRadius:3 }] },
      options:{ plugins:{legend:{display:false}}, maintainAspectRatio:false, responsive:true, scales:{x:{grid:{display:false}},y:{grid:{color:grid},beginAtZero:true}} } }));
    // peak by hour
    const peakH=PERIODS[period].peakH;
    const ph=Array.from({length:24},(_,h)=>Math.round((6+40*Math.exp(-Math.pow((h-peakH)/4,2))+12*Math.exp(-Math.pow((h-8)/3,2)))*(k/7+.3)));
    const pIdx=ph.indexOf(Math.max(...ph));
    charts.push(new Chart($('chPeak'),{ type:'bar',
      data:{ labels:Array.from({length:24},(_,h)=>pad(h)), datasets:[{ data:ph, backgroundColor:ph.map((_,i)=>i===pIdx?bad:accent), borderRadius:3, barPercentage:.9, categoryPercentage:.9 }] },
      options:{ plugins:{legend:{display:false}}, maintainAspectRatio:false, responsive:true, scales:{x:{grid:{display:false},ticks:{maxTicksLimit:12,maxRotation:0}},y:{grid:{color:grid},beginAtZero:true}} } }));
    $('peakNote').textContent = `คนเยอะสุด ${pad(pIdx)}:00 น. (${ph[pIdx].toLocaleString()} คน)`;
    // by camera
    charts.push(new Chart($('chCamera'),{ type:'bar',
      data:{ labels:CAM_DIST.map(c=>camName(c[0])), datasets:[{ data:CAM_DIST.map(c=>Math.round(c[1]*(period==='today'?.14:1))), backgroundColor:accent, borderRadius:3 }] },
      options:hbarOpts(grid) }));
    // direction
    charts.push(new Chart($('chDir'),{ type:'bar',
      data:{ labels:DIR_DIST.map(d=>DIRT[d[0]]), datasets:[{ data:DIR_DIST.map(d=>d[1]), backgroundColor:['#5b8def','#22c55e','#a855f7','#f59e0b'], borderRadius:3 }] },
      options:hbarOpts(grid) }));
    // gender
    charts.push(new Chart($('chGender'),{ type:'doughnut',
      data:{ labels:['ชาย','หญิง'], datasets:[{ data:[62,38], backgroundColor:[accent,'#d65db1'], borderWidth:0 }] },
      options:{ cutout:'62%', maintainAspectRatio:false, responsive:true, plugins:{legend:{position:'bottom'}} } }));
    // age
    charts.push(new Chart($('chAge'),{ type:'bar',
      data:{ labels:AGE_DIST.map(a=>AGE[a[0]]), datasets:[{ data:AGE_DIST.map(a=>a[1]), backgroundColor:accent, borderRadius:3 }] },
      options:hbarOpts(grid) }));
    if (forensicBuilt) renderForensic();
  }
  function renderForensic(){
    forensicCharts.forEach(c=>c.destroy()); forensicCharts=[];
    if (typeof Chart==='undefined') return;
    const grid='rgba(128,128,128,.12)', accent=token('--accent')||'#5b8def';
    forensicCharts.push(new Chart($('chTop'),{ type:'bar', data:{ labels:TOP_TYPE.map(t=>TOP[t[0]]), datasets:[{data:TOP_TYPE.map(t=>t[1]),backgroundColor:accent,borderRadius:3}] }, options:hbarOpts(grid) }));
    forensicCharts.push(new Chart($('chBot'),{ type:'bar', data:{ labels:BOT_TYPE.map(t=>BOT[t[0]]), datasets:[{data:BOT_TYPE.map(t=>t[1]),backgroundColor:accent,borderRadius:3}] }, options:hbarOpts(grid) }));
    forensicCharts.push(new Chart($('chHair'),{ type:'bar', data:{ labels:HAIR_LEN.map(t=>HAIRL[t[0]]), datasets:[{data:HAIR_LEN.map(t=>t[1]),backgroundColor:accent,borderRadius:3}] }, options:hbarOpts(grid) }));
    forensicCharts.push(new Chart($('chExpr'),{ type:'bar', data:{ labels:EXPR, datasets:[{data:EXPR_DIST,backgroundColor:accent,borderRadius:3}] }, options:hbarOpts(grid) }));
  }

  // ───────── result cards ─────────
  function pChips(p){
    const sw=c=>`<span class="sw" style="background:${cHex(c)}"></span>`;
    return [
      `<span class="p-chip">${p.gender==='F'?'หญิง':'ชาย'}</span>`,
      `<span class="p-chip">${sw(p.upper_color)}${TOP[p.top_category]||''}</span>`,
      `<span class="p-chip">${sw(p.lower_color)}${BOT[p.bottom_category]||''}</span>`,
      `<span class="p-chip">${sw(p.hair_color)}ผม${HAIRL[p.hair_length]||''}</span>`,
    ].join('');
  }
  function renderResults(){
    $('resCount').textContent = RESULTS.length;
    $('resultGrid').innerHTML = RESULTS.map((p,i)=>`
      <div class="p-card" data-idx="${i}">
        <div class="p-thumb" data-action="open" data-idx="${i}">${avatar(p)}<span class="p-conf">${Math.round(p.confidence*100)}%</span></div>
        <div class="p-body">
          <div class="p-meta">${p.time} · ${esc(camName(p.camera_id))}</div>
          <div class="p-chips">${pChips(p)}</div>
          <div class="p-actions">
            <button class="btn btn-secondary" data-action="follow" data-idx="${i}">ตามคนนี้</button>
            <button class="btn btn-secondary" data-action="example" data-idx="${i}">หาคนแบบนี้</button>
          </div>
        </div>
      </div>`).join('') || `<div class="p-empty">ไม่พบบุคคลตามเงื่อนไข</div>`;
  }

  // ───────── search-by-example: autofill filters from a person ─────────
  function searchByExample(p){
    $('fGender').value=p.gender; $('fTop').value=p.top_category; $('fBot').value=p.bottom_category;
    $('fHairLen').value=p.hair_length; $('fAge').value=p.age_group;
    $('fGlass').value=p.glasses?'1':'0'; $('fHat').value=p.hat?'1':'0'; $('fBag').value=p.bag_category||'';
    pickSet('top',p.upper_color); pickSet('bot',p.lower_color); pickSet('hair',p.hair_color);
    document.querySelector('.filter-grid').scrollIntoView({behavior:'smooth',block:'center'});
  }

  // ───────── timeline / follow ─────────
  function camSeq(){ return ['HIK-PT-01','HIK-PT-02','HIK-PT-05','HIK-PT-03','HIK-PT-04']; }
  function renderTimeline(anchor, thr){
    $('timelinePanel').style.display='';
    if (anchor){
      $('tlAnchorWrap').innerHTML = `<div class="tl-anchor">ตามคนนี้: <strong>#${anchor.id}</strong> · ${esc(cTh(anchor.upper_color))}${TOP[anchor.top_category]||''}
        <span class="tl-thr">เกณฑ์ความคล้าย <input type="range" id="tlThr" min="0.4" max="0.9" step="0.05" value="${thr||0.6}"> <span id="tlThrV">${Math.round((thr||0.6)*100)}%</span></span></div>`;
    } else $('tlAnchorWrap').innerHTML = `<span style="font-size:11px;color:var(--text-secondary)">เส้นเวลาตามตัวกรองปัจจุบัน</span>`;
    const seq=camSeq(); const base=18*60+5; const t=thr||0.6;
    const segs=seq.map((cam,i)=>{
      const start=base+i*9; const cnt=Math.max(1,Math.round((4-i*0.5)*(t<0.6?1.4:1)));
      return { cam, t:`${pad(Math.floor(start/60))}:${pad(start%60)}`, dur:3+i, cnt, score:0.94-i*0.06 };
    }).filter(s=>s.score>=t-0.02);
    $('tlSegs').innerHTML = segs.map(s=>`<div class="tl-seg">
      <div class="tl-time">${s.t} น.</div><span class="tl-dot"></span>
      <div class="tl-cam">${esc(camName(s.cam))}<small>อยู่ในเฟรม ~${s.dur} นาที</small></div>
      <div class="tl-cnt">${s.cnt} ครั้ง</div><div class="tl-score">${Math.round(s.score*100)}%</div></div>`).join('')
      || `<div class="p-empty">ไม่พบช่วงที่คล้ายเกินเกณฑ์</div>`;
    $('timelinePanel').scrollIntoView({behavior:'smooth',block:'start'});
  }

  // ───────── detail modal ─────────
  let _cur=null;
  const RECON='<span class="im-deltag">ภาพจริงถูกลบ · สร้างจาก metadata</span>';
  function renderModalBody(p){
    const gone=$('pmSimDeleted')?.checked;
    const sw=c=>`<span class="sw" style="background:${cHex(c)}"></span>`;
    const img = gone ? `<div class="imbox recon">${avatar(p)}${RECON}</div>` : `<div class="imbox">${avatar(p)}</div>`;
    $('personModalBody').innerHTML = `
      <div class="dm-grid">
        ${img}
        <div class="lm-data">
          <div class="lm-drow"><span class="lm-dk">เวลา</span><span class="lm-dv">${p.time} น.</span></div>
          <div class="lm-drow"><span class="lm-dk">กล้อง</span><span class="lm-dv">${esc(camName(p.camera_id))}</span></div>
          <div class="lm-drow"><span class="lm-dk">เพศ</span><span class="lm-dv">${p.gender==='F'?'หญิง':'ชาย'}</span></div>
          <div class="lm-drow"><span class="lm-dk">กลุ่มอายุ</span><span class="lm-dv">${AGE[p.age_group]||'—'}</span></div>
          <div class="lm-drow"><span class="lm-dk">เสื้อ</span><span class="lm-dv">${sw(p.upper_color)}${TOP[p.top_category]||''} · ${cTh(p.upper_color)}</span></div>
          <div class="lm-drow"><span class="lm-dk">ส่วนล่าง</span><span class="lm-dv">${sw(p.lower_color)}${BOT[p.bottom_category]||''} · ${cTh(p.lower_color)}</span></div>
          <div class="lm-drow"><span class="lm-dk">ทรงผม</span><span class="lm-dv">${sw(p.hair_color)}${HAIRL[p.hair_length]||''} · ${cTh(p.hair_color)}</span></div>
          <div class="lm-drow"><span class="lm-dk">แว่นตา</span><span class="lm-dv">${p.glasses?'ใส่แว่น':'ไม่ใส่'}</span></div>
          <div class="lm-drow"><span class="lm-dk">หมวก</span><span class="lm-dv">${p.hat?'สวม':'ไม่สวม'}</span></div>
          <div class="lm-drow"><span class="lm-dk">กระเป๋า</span><span class="lm-dv">${p.bag_category?BAG[p.bag_category]:'—'}</span></div>
          <div class="lm-drow"><span class="lm-dk">ทิศทาง</span><span class="lm-dv">${DIRT[p.direction]||'—'}</span></div>
          <div class="lm-drow"><span class="lm-dk">ความเชื่อมั่น</span><span class="lm-dv">${Math.round(p.confidence*100)}%</span></div>
        </div>
      </div>`;
  }
  function openModal(p){ _cur=p; if($('pmSimDeleted'))$('pmSimDeleted').checked=false;
    $('pmTime').textContent=`วันนี้ ${p.time} น.`; renderModalBody(p); $('personModal').style.display='flex'; }
  function closeModal(){ $('personModal').style.display='none'; }

  // ───────── color swatch picker ─────────
  const PICK_COLORS = ['Black','White','Gray','Blue','Green','Red','Orange','Yellow','Purple','Brown','Beige'];
  const pickState = { top:'', bot:'', hair:'' };
  function buildPickers(){
    [['top','topColorPick'],['bot','botColorPick'],['hair','hairColorPick']].forEach(([key,id])=>{
      const colors = key==='hair' ? ['Black','Brown','Gray','Blonde'] : PICK_COLORS;
      $(id).innerHTML = `<span class="swatch any" data-pick="${key}" data-c="">ทั้งหมด</span>` +
        colors.map(c=>`<span class="swatch" data-pick="${key}" data-c="${c}" title="${esc(cTh(c))}" style="background:${cHex(c)}"></span>`).join('');
    });
    syncPickers();
  }
  function syncPickers(){
    document.querySelectorAll('.swatch').forEach(s=>{ s.classList.toggle('active', (pickState[s.dataset.pick]||'')===s.dataset.c); });
  }
  function pickSet(key,c){ pickState[key]=c||''; syncPickers(); }

  // ───────── selects ─────────
  function fillSelects(){
    const opt=(v,t)=>`<option value="${v}">${t}</option>`;
    $('fCam').innerHTML = opt('','ทั้งหมด')+CAMS.map(c=>opt(c.id,c.name)).join('');
    $('fTop').innerHTML = opt('','ทั้งหมด')+Object.entries(TOP).filter(([k])=>k!=='Unknown').map(([k,v])=>opt(k,v)).join('');
    $('fBot').innerHTML = opt('','ทั้งหมด')+Object.entries(BOT).filter(([k])=>k!=='Unknown').map(([k,v])=>opt(k,v)).join('');
    $('fHairLen').innerHTML = opt('','ทั้งหมด')+Object.entries(HAIRL).map(([k,v])=>opt(k,v)).join('');
    $('fAge').innerHTML = opt('','ทั้งหมด')+Object.entries(AGE).map(([k,v])=>opt(k,v)).join('');
    $('fBag').innerHTML = opt('','ทั้งหมด')+Object.entries(BAG).map(([k,v])=>opt(k,v)).join('');
  }
  function resetFilters(){
    ['fCam','fGender','fTop','fBot','fHairLen','fAge','fGlass','fHat','fBag','fConf','fFrom','fTo'].forEach(id=>{ if($(id))$(id).value=''; });
    pickState.top=pickState.bot=pickState.hair=''; syncPickers();
  }

  // ───────── pickers / theme ─────────
  const ADP_TH={ days:['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'],daysShort:['อา','จ','อ','พ','พฤ','ศ','ส'],daysMin:['อา','จ','อ','พ','พฤ','ศ','ส'],
    months:['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
    monthsShort:['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],today:'วันนี้',clear:'ล้าง',dateFormat:'dd/MM/yyyy',timeFormat:'HH:mm',firstDay:0 };
  function initPickers(){ if(typeof AirDatepicker==='undefined')return; const o={locale:ADP_TH,timepicker:true,dateFormat:'dd/MM/yyyy',timeFormat:'HH:mm',isMobile:window.innerWidth<=768,position:'bottom left'};
    ['fFrom','fTo','pFrom','pTo'].forEach(id=>{if($(id))new AirDatepicker($(id),o);}); }
  function toggleTheme(){ const c=document.documentElement.getAttribute('data-theme'); if(c==='light')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme','light'); renderCharts(); }

  // ───────── bindings ─────────
  $('bodyTabBar').addEventListener('click',e=>{ const b=e.target.closest('.tab[data-tab]'); if(!b)return;
    document.querySelectorAll('#bodyTabBar .tab').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const t=b.dataset.tab; $('tab-overview').style.display=t==='overview'?'':'none'; $('tab-search').style.display=t==='search'?'':'none';
    if(t==='search') renderResults(); });
  $('periodBar').addEventListener('click',e=>{ const b=e.target.closest('button[data-p]'); if(!b)return;
    document.querySelectorAll('#periodBar button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); period=b.dataset.p;
    $('customRange').style.display=period==='custom'?'':'none'; renderKpi(); renderCharts(); });
  $('forensicToggle').addEventListener('click',()=>{ const hd=$('forensicToggle'),bd=$('forensicBody'); const open=!bd.classList.contains('open');
    hd.classList.toggle('open',open); bd.classList.toggle('open',open); if(open&&!forensicBuilt){ forensicBuilt=true; renderForensic(); } });
  $('resultGrid').addEventListener('click',e=>{ const b=e.target.closest('[data-action]'); if(!b)return; const p=RESULTS[+b.dataset.idx];
    if(b.dataset.action==='open') openModal(p);
    else if(b.dataset.action==='follow') renderTimeline(p,0.6);
    else if(b.dataset.action==='example') searchByExample(p); });
  document.querySelector('#tab-search .filter-grid').addEventListener('click',e=>{ const s=e.target.closest('.swatch[data-pick]'); if(!s)return;
    pickSet(s.dataset.pick, pickState[s.dataset.pick]===s.dataset.c?'':s.dataset.c); });
  $('btnSearch').addEventListener('click',renderResults);
  $('btnReset').addEventListener('click',resetFilters);
  $('btnTimeline').addEventListener('click',()=>renderTimeline(null));
  $('tlSegs').parentElement.addEventListener('input',e=>{ if(e.target.id==='tlThr'){ $('tlThrV').textContent=Math.round(e.target.value*100)+'%'; if(_cur)renderTimeline(_cur,parseFloat(e.target.value)); } });
  $('personModalX').addEventListener('click',closeModal);
  $('personModal').addEventListener('click',e=>{ if(e.target.id==='personModal') closeModal(); });
  $('pmSimDeleted').addEventListener('change',()=>{ if(_cur)renderModalBody(_cur); });
  $('pmFollow').addEventListener('click',()=>{ if(_cur){ closeModal(); document.querySelector('#bodyTabBar .tab[data-tab="search"]').click(); renderTimeline(_cur,0.6); } });
  $('pmExample').addEventListener('click',()=>{ if(_cur){ closeModal(); document.querySelector('#bodyTabBar .tab[data-tab="search"]').click(); searchByExample(_cur); } });
  $('pmFace').addEventListener('click',()=>{ alert('สาธิต: เปิดบุคคลนี้ในหน้า "ใบหน้า" (cross-link face↔body)'); });
  $('btnTheme').addEventListener('click',toggleTheme);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeModal(); });

  // ───────── init ─────────
  fillSelects(); buildPickers(); initPickers();
  renderKpi(); renderHbars(); renderAcc(); renderCharts();
})();
