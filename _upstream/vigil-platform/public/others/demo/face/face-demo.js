// Face Redesign — DRAFT demo logic (CSP-compliant external script, no inline handlers)
// Field names mirror prod (/api/faces, /api/face-matches). Rows/charts = mock.
// Face images = synthetic avatars (PDPA: never embed a real face in a demo).
(function(){
  const $ = id => document.getElementById(id);
  const token = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const pad = n => String(n).padStart(2,'0');
  const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const DEMO_USER = 'Dojo-mAn';

  // ───────── REAL prod reference values ─────────
  // Hikvision faceExpression codes → Thai
  const EXPR = [
    { code:'neutral',  th:'เฉย ๆ' },
    { code:'happy',    th:'ยิ้ม / มีความสุข' },
    { code:'sad',      th:'เศร้า' },
    { code:'angry',    th:'โกรธ' },
    { code:'surprise', th:'ตกใจ' },
    { code:'disgust',  th:'รังเกียจ' },
    { code:'fear',     th:'กลัว' },
  ];
  const exprTh = c => (EXPR.find(e=>e.code===c)||{}).th || (c||'—');
  // top/bottom garment (appearance) — Hikvision categories
  const TOP_TYPES = [['LongSleeve','แขนยาว'],['ShortSleeve','แขนสั้น'],['Jacket','แจ็คเก็ต']];
  const BOT_TYPES = [['Trousers','กางเกงขายาว'],['Shorts','กางเกงขาสั้น'],['Skirt','กระโปรง'],['Dress','เดรส']];
  const COLORS = [
    ['Black','ดำ','#1a1a1a'],['White','ขาว','#eef0f2'],['Gray','เทา','#888'],
    ['Blue','น้ำเงิน','#2f6fd0'],['Red','แดง','#d0392f'],['Green','เขียว','#2f9d55'],
    ['Brown','น้ำตาล','#7a4b2b'],['Yellow','เหลือง','#e3b341']];
  const colorTh = c => (COLORS.find(x=>x[0]===c)||[])[1] || c;
  const colorHex = c => (COLORS.find(x=>x[0]===c)||[])[2] || '#888';
  const CAMS = [
    { id:'HIK-FACE01', name:'ทางเข้าหลัก' },
    { id:'HIK-FACE02', name:'ล็อบบี้' },
    { id:'HIK-FACE03', name:'ประตูพนักงาน' },
  ];
  const camName = id => (CAMS.find(c=>c.id===id)||{}).name || id;
  // FD Library groups (camera-side) — blackList = เฝ้าระวัง, whiteList = รู้จัก
  let GROUPS = [
    { id:'suspect',  name:'ผู้ต้องสงสัย', type:'blackList', color:'#ef4444' },
    { id:'banned',   name:'บุคคลต้องห้าม', type:'blackList', color:'#f97316' },
    { id:'vip',      name:'VIP',          type:'whiteList', color:'#22c55e' },
    { id:'staff',    name:'พนักงาน',       type:'whiteList', color:'#5b8def' },
  ];
  const groupById = id => GROUPS.find(g=>g.id===id);

  // ───────── synthetic avatar (no real face) ─────────
  // appearance vocab (mirrors prod _APP_* / _COLOR_HEX in page-snapshots.js)
  const APP_COLOR = { Black:['ดำ','#444'],White:['ขาว','#eee'],Gray:['เทา','#888'],Blue:['น้ำเงิน','#3b7fe0'],
    Green:['เขียว','#3be06a'],Red:['แดง','#e03b3b'],Orange:['ส้ม','#e07a3b'],Yellow:['เหลือง','#e0d43b'],
    Purple:['ม่วง','#7a3be0'],Brown:['น้ำตาล','#8b5c2a'],Beige:['เบจ','#d4c49a'],Blonde:['บลอนด์','#b88b50'] };
  const APP_TOP = { ShortSleeve:'แขนสั้น',LongSleeve:'แขนยาว',Sleeveless:'กล้าม',Jacket:'แจ็คเก็ต',Coat:'โค้ต',Vest:'เสื้อกั๊ก' };
  const APP_BOT = { Trousers:'กางเกงขายาว',Shorts:'กางเกงขาสั้น',Skirt:'กระโปรง',Dress:'ชุดเดรส' };
  const APP_HAIR= { Short:'สั้น',Long:'ยาว',Medium:'กลาง',Bald:'หัวล้าน' };
  const APP_BAG = { ShoulderBag:'กระเป๋าสะพายข้าง',Backpack:'เป้สะพายหลัง',Briefcase:'กระเป๋าเอกสาร' };
  const APP_DIR = { forward:'เข้าหากล้อง',backward:'ออกจากกล้อง',leftward:'ไปทางซ้าย',rightward:'ไปทางขวา' };
  const appHex = c => (APP_COLOR[c]||[])[1] || '#7a8295';
  const appColorTh = c => (APP_COLOR[c]||[])[0] || c;

  // Synthetic avatar (no real face). modes: 'card' head+shoulders · 'face' tight crop ·
  // 'scene' wide CCTV frame · 'body' full-body with garment colors.
  function _faceParts(o){
    const seed=(o.seed|0), female=o.gender==='female';
    const skins=['#e8b48c','#d99a6c','#c8845a','#a9683f','#8a5230'];
    const hairs=['#2b2620','#4a3526','#6b4a2e','#1a1a1a','#5a5550'];
    const skin=skins[seed%skins.length];
    const hair=o.hair_color?appHex(o.hair_color):hairs[(seed*3)%hairs.length];
    const long=o.hair_length==='Long', bald=o.hair_length==='Bald';
    const hairPath = bald ? '' : ((female||long)
      ? `<path d="M22 38 Q22 16 40 16 Q58 16 58 38 L58 52 Q60 30 40 28 Q20 30 22 52 Z" fill="${hair}"/>`
      : `<path d="M24 36 Q24 18 40 18 Q56 18 56 36 L56 40 Q52 28 40 28 Q28 28 24 40 Z" fill="${hair}"/>`);
    const glasses = (o.glass==='yes'||o.glass==='sunglasses')
      ? (o.glass==='sunglasses'
          ? `<g><rect x="27" y="40" width="11" height="8" rx="2" fill="#111"/><rect x="42" y="40" width="11" height="8" rx="2" fill="#111"/><line x1="38" y1="43" x2="42" y2="43" class="fa-glasses"/></g>`
          : `<g class="fa-glasses"><circle cx="32.5" cy="44" r="5.5"/><circle cx="47.5" cy="44" r="5.5"/><line x1="38" y1="44" x2="42" y2="44"/></g>`)
      : '';
    const mask = o.mask==='yes' ? `<path class="fa-mask" d="M28 48 Q40 46 52 48 L50 60 Q40 66 30 60 Z"/>` : '';
    const hat = o.hat==='yes' ? `<path d="M22 30 Q40 12 58 30 L58 33 Q40 26 22 33 Z" fill="#3a4254"/>` : '';
    return { skin, female,
      head:`<ellipse cx="40" cy="48" rx="17" ry="20" fill="${skin}"/>${hairPath}${hat}<circle cx="33" cy="48" r="1.6" fill="#1c1c1c"/><circle cx="47" cy="48" r="1.6" fill="#1c1c1c"/>${glasses}${mask}` };
  }
  function avatar(o, mode){
    o=o||{}; mode=mode||'card';
    const P=_faceParts(o); const bg=P.female?'#241a22':'#161b29';
    if (mode==='scene'){
      return `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <rect width="160" height="100" fill="${bg}"/>
        <rect y="72" width="160" height="28" fill="rgba(255,255,255,.03)"/>
        <line x1="0" y1="72" x2="160" y2="72" stroke="rgba(255,255,255,.07)"/>
        <line x1="55" y1="100" x2="70" y2="72" stroke="rgba(255,255,255,.05)"/><line x1="105" y1="100" x2="90" y2="72" stroke="rgba(255,255,255,.05)"/>
        <g transform="translate(40,2)"><ellipse cx="40" cy="86" rx="26" ry="16" fill="#2a3142"/>${P.head}</g>
        <circle cx="10" cy="10" r="3" fill="#ef4444"/><text x="17" y="13" fill="rgba(255,255,255,.55)" font-size="8" font-family="monospace">REC</text>
      </svg>`;
    }
    if (mode==='body'){
      const jh=appHex(o.jacket_color)||'#3a4254', th=appHex(o.trousers_color)||'#2b3242';
      return `<svg viewBox="0 0 80 150" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="150" fill="${bg}"/>
        <rect x="30" y="96" width="9" height="48" rx="2" fill="${th}"/><rect x="41" y="96" width="9" height="48" rx="2" fill="${th}"/>
        <path d="M27 50 Q40 43 53 50 L57 98 L23 98 Z" fill="${jh}"/>
        <path d="M27 52 L19 86 L24 89 L31 58 Z" fill="${jh}"/><path d="M53 52 L61 86 L56 89 L49 58 Z" fill="${jh}"/>
        <rect x="36" y="40" width="8" height="11" fill="${P.skin}"/>
        <g transform="translate(0,-16) scale(.66)" transform-origin="40 48">${P.head}</g>
      </svg>`;
    }
    const vb = mode==='face' ? '15 27 50 46' : '0 0 80 100'; // 'face' = tight crop
    return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <rect x="-10" y="-10" width="120" height="140" fill="${bg}"/>
      <ellipse cx="40" cy="88" rx="30" ry="20" fill="#2a3142"/>${P.head}
    </svg>`;
  }
  // body-appearance chips (mirrors prod _matchBodyChips fields)
  function bodyChips(m){
    const sw = c => c ? `<span class="bd-sw" style="background:${appHex(c)}"></span>` : '';
    const col = c => c ? `<span class="bd-c">${appColorTh(c)}</span>` : '';
    const rows=[];
    if (m.jacket_type||m.jacket_color) rows.push(['เสื้อ', `${sw(m.jacket_color)}${APP_TOP[m.jacket_type]||''}${col(m.jacket_color)}`]);
    if (m.trousers_type||m.trousers_color) rows.push(['ส่วนล่าง', `${sw(m.trousers_color)}${APP_BOT[m.trousers_type]||''}${col(m.trousers_color)}`]);
    if (m.hair_length||m.hair_color) rows.push(['ทรงผม', `${sw(m.hair_color)}${APP_HAIR[m.hair_length]||''}${col(m.hair_color)}`]);
    rows.push(['แว่นตา', m.glass==='sunglasses'?'แว่นกันแดด':m.glass==='yes'?'ใส่แว่น':'ไม่ใส่']);
    if (m.mask==='yes') rows.push(['หน้ากาก','สวม']);
    if (m.hat==='yes') rows.push(['หมวก','สวม']);
    if (m.bag) rows.push(['กระเป๋า', APP_BAG[m.bag]||m.bag]);
    if (m.direction) rows.push(['ทิศทาง', APP_DIR[m.direction]||m.direction]);
    return rows;
  }
  const refDoc = label => `<div class="lpr-imggone" style="border-style:solid"><div class="ig-cap">${esc(label)}<br><small>รูปอ้างอิงจาก FD Library</small></div></div>`;
  const imgGone = () => `<div class="lpr-imggone"><div class="ig-cap">ภาพถูกลบแล้ว (เกินอายุเก็บรูป)<br><small>ข้อมูล metadata ยังอยู่ในระบบ</small></div></div>`;

  // ───────── mock rows ─────────
  const THAI_F = ['สมหญิง','วราภรณ์','ณัฐริกา','พิมพ์ชนก','อรอุมา'];
  const THAI_M = ['สมชาย','อนุชา','ธีรพงษ์','กิตติศักดิ์','ภาณุพงศ์'];
  const LAST = ['ใจดี','รักไทย','ศรีสุข','พงษ์พันธ์','มั่นคง','วงศ์ทอง'];
  function mkFace(i){
    const g = i % 3 === 0 ? 'female' : 'male';
    const age = 18 + (i*7 % 50);
    const expr = EXPR[(i*3) % EXPR.length].code;
    const glass = ['no','no','yes','sunglasses'][i%4];
    const mask = i%5===0 ? 'yes':'no';
    const hat = i%6===0 ? 'yes':'no';
    const TOPS=['LongSleeve','ShortSleeve','Jacket','Vest','Coat'];
    const BOTS = g==='female' ? ['Trousers','Skirt','Dress','Shorts'] : ['Trousers','Shorts','Trousers'];
    const JC=['Black','White','Gray','Blue','Red','Green','Brown','Beige'];
    const HAIRL=['Short','Medium','Long','Short'];
    return {
      id:1000+i, gender:g, age:String(age), expression:expr, glass, mask, hat,
      camera_id: CAMS[i%CAMS.length].id,
      stay_duration: String(1500 + (i*430 % 6000)),
      face_score: String(82 + (i*7 % 17)),
      time: ['01:42','01:38','01:31','01:24','01:18','01:05'][i] || ('00:'+pad(59-(i%59))),
      // body appearance (mixedTargetDetection)
      jacket_type:TOPS[i%TOPS.length], jacket_color:JC[i%JC.length],
      trousers_type:BOTS[i%BOTS.length], trousers_color:JC[(i*3)%JC.length],
      hair_length:HAIRL[i%HAIRL.length], hair_color:['Black','Brown','Black','Blonde'][i%4],
      bag: i%3===0?'Backpack':i%4===0?'ShoulderBag':null,
      direction:['forward','leftward','rightward','backward'][i%4],
      seed: i+1,
    };
  }
  let LATEST = Array.from({length:5}, (_,i)=>mkFace(i));
  const SEARCH = Array.from({length:42}, (_,i)=>mkFace(i));

  // recognition matches (FaceRecognition) — hits (named) + misses (no match)
  function mkMatch(i, mode){
    const gid = ['suspect','banned','vip','staff'][i%4];
    const g = groupById(gid);
    const female = i%3===0;
    const first = (female?THAI_F:THAI_M)[i%5];
    const name = `${female?'น.ส.':'นาย'}${first} ${LAST[i%LAST.length]}`;
    const f = mkFace(i);
    f.gender = female ? 'female':'male';
    if (mode==='miss'){
      return { ...f, id:5000+i, person_name:null, list_type:null, fd_lib_name:null, similarity:null,
        time:['02:11','02:03','01:55','01:40','01:22'][i]||('00:'+pad(50-i)) };
    }
    return { ...f, id:5000+i, person_name:name, list_type:g.type, fd_lib_name:g.name, group:gid,
      similarity: (0.74 + (i*5%24)/100),
      note: g.type==='blackList' ? ['หมายจับเลขที่ 412/2567 — โจรกรรมทรัพย์สิน','บุคคลต้องห้ามเข้าพื้นที่ตามคำสั่ง','ผู้ต้องสงสัยคดีบุกรุก'][i%3] : 'บุคคลในบัญชีขาว (อนุญาตให้ผ่าน)',
      time:['02:11','02:03','01:55','01:40','01:22'][i]||('00:'+pad(50-i)) };
  }
  const HITS  = Array.from({length:11}, (_,i)=>mkMatch(i,'hit'));
  const MISSES= Array.from({length:7},  (_,i)=>mkMatch(i,'miss'));

  // ───────── period data ─────────
  const PERIODS = {
    hour:      { total:42,   recog:6,  watch:1, miss:5,  label:'ชั่วโมงนี้', bucket:'hour' },
    today:     { total:684,  recog:128,watch:4, miss:112,label:'วันนี้',     bucket:'hour' },
    yesterday: { total:612,  recog:118,watch:2, miss:103,label:'เมื่อวาน',   bucket:'hour' },
    week:      { total:4120, recog:806,watch:9, miss:701,label:'สัปดาห์นี้', bucket:'dow' },
    month:     { total:17640,recog:3410,watch:31,miss:2980,label:'เดือนนี้',  bucket:'dom' },
    custom:    { total:980,  recog:190,watch:3, miss:165,label:'กำหนดเอง',    bucket:'hour' },
  };
  let period = 'today';

  function renderKpi(){
    const d = PERIODS[period];
    const items = [
      { ka:'var(--accent)', label:'ใบหน้าทั้งหมด', val:d.total.toLocaleString(),
        sub:period==='today'?'▲ 12% เทียบเมื่อวาน':'ช่วง '+d.label, subc:period==='today'?'var(--status-ok)':'var(--text-secondary)',
        icon:'<circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>' },
      { ka:'var(--purple)', label:'จดจำได้ (รู้จัก)', val:d.recog.toLocaleString(),
        sub:Math.round(d.recog/d.total*100)+'% ของทั้งหมด', subc:'var(--text-secondary)',
        icon:'<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>' },
      { ka:'var(--status-bad)', label:'บุคคลเฝ้าระวังที่พบ', val:d.watch.toLocaleString(),
        sub:'ช่วง '+d.label, subc:d.watch?'var(--status-bad)':'var(--text-secondary)',
        icon:'<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="15.5" r=".6"/>' },
      { ka:'var(--warn)', label:'ไม่พบในระบบ', val:d.miss.toLocaleString(),
        sub:'บุคคลแปลกหน้า', subc:'var(--text-secondary)',
        icon:'<circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M3 3l18 18" stroke-opacity=".5"/>' },
    ];
    $('kpiGrid').innerHTML = items.map(k=>`
      <div class="kpi" style="--ka:${k.ka}">
        <div class="ki" style="color:${k.ka}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${k.icon}</svg></div>
        <div class="kl">${k.label}</div>
        <div class="kv">${k.val}</div>
        <div class="ks" style="color:${k.subc}">${k.sub}</div>
      </div>`).join('');
  }

  // ───────── charts ─────────
  let charts = [];
  const DOW = ['จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์','อาทิตย์'];
  function peakSeries(){
    const b = PERIODS[period].bucket;
    if (b==='hour'){
      const labels = Array.from({length:24},(_,h)=>pad(h));
      const data = labels.map((_,h)=> Math.round(6 + 38*Math.exp(-Math.pow((h-18)/4,2)) + 10*Math.exp(-Math.pow((h-8)/3,2)) + (h%3)));
      return { labels, data, fmt:l=>l+':00 น.', word:'ช่วงเวลา' };
    }
    if (b==='dow'){
      const data = [120,135,128,142,168,96,72];
      return { labels:DOW, data, fmt:l=>'วัน'+l, word:'วัน' };
    }
    const labels = Array.from({length:30},(_,d)=>String(d+1));
    const data = labels.map((_,d)=> Math.round(80 + 70*Math.exp(-Math.pow((d-25)/4,2)) + (d*7%30)));
    return { labels, data, fmt:l=>'วันที่ '+l, word:'วันที่' };
  }
  function renderCharts(){
    charts.forEach(c=>c.destroy()); charts = [];
    if (typeof Chart === 'undefined') return;
    const dim = token('--text-secondary') || '#888';
    const grid = 'rgba(128,128,128,.12)';
    const accent = token('--accent') || '#5b8def';
    const bad = token('--status-bad') || '#ef4444';
    Chart.defaults.color = dim;
    Chart.defaults.font.family = token('--ui-font-family') || 'sans-serif';
    const noLegend = { plugins:{legend:{display:false}}, maintainAspectRatio:false, responsive:true };

    // peak — bar, peak bucket red
    const ps = peakSeries();
    const peakIdx = ps.data.indexOf(Math.max(...ps.data));
    charts.push(new Chart($('chPeak'), { type:'bar',
      data:{ labels:ps.labels, datasets:[{ data:ps.data,
        backgroundColor:ps.data.map((_,i)=> i===peakIdx? bad : accent),
        borderRadius:3, barPercentage:.85, categoryPercentage:.9 }] },
      options:{ ...noLegend, scales:{ x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:12}}, y:{grid:{color:grid},beginAtZero:true} } } }));
    $('peakNote').textContent = `พบมากสุด: ${ps.fmt(ps.labels[peakIdx])} (${ps.data[peakIdx].toLocaleString()} ใบหน้า)`;

    // gender doughnut
    charts.push(new Chart($('chGender'), { type:'doughnut',
      data:{ labels:['ชาย','หญิง'], datasets:[{ data:[62,38], backgroundColor:[accent,'#d65db1'], borderWidth:0 }] },
      options:{ ...noLegend, cutout:'62%', plugins:{legend:{display:true,position:'bottom'}} } }));

    // age bar
    charts.push(new Chart($('chAge'), { type:'bar',
      data:{ labels:['0-19','20-29','30-39','40-49','50-59','60+'],
        datasets:[{ data:[58,182,164,121,86,73], backgroundColor:accent, borderRadius:3 }] },
      options:{ ...noLegend, scales:{ x:{grid:{display:false}}, y:{grid:{color:grid},beginAtZero:true} } } }));

    // expression doughnut
    const exprData = [288,156,74,42,58,18,12];
    charts.push(new Chart($('chExpr'), { type:'doughnut',
      data:{ labels:EXPR.map(e=>e.th), datasets:[{ data:exprData,
        backgroundColor:['#8a93a5','#22c55e','#5b8def','#ef4444','#f59e0b','#a855f7','#14b8a6'], borderWidth:0 }] },
      options:{ ...noLegend, cutout:'58%', plugins:{legend:{display:true,position:'right',labels:{boxWidth:10,font:{size:10}}}} } }));
  }

  // ───────── face card ─────────
  function faceCard(f, src, idx, enter){
    const wear = [];
    if (f.glass==='sunglasses') wear.push('แว่นกันแดด'); else if (f.glass==='yes') wear.push('แว่นตา');
    if (f.mask==='yes') wear.push('หน้ากาก');
    if (f.hat==='yes') wear.push('หมวก');
    const wearHtml = wear.length ? wear.map(w=>`<span class="f-chip">${w}</span>`).join('')
      : `<span class="f-chip">ไม่สวมใส่</span>`;
    const ageBucket = (()=>{ const a=+f.age; if(a<=19)return '13-19 ปี'; if(a>=60)return '60+ ปี'; const lo=Math.floor(a/10)*10; return `${lo}-${lo+9} ปี`; })();
    return `<div class="f-card ${enter?'enter':''}" data-src="${src}" data-idx="${idx}">
      <div class="f-thumb">${avatar(f)}<span class="f-score">${f.face_score}%</span></div>
      <div class="f-body">
        <div class="f-demo">${f.time} · ${esc(camName(f.camera_id))}</div>
        <div class="f-chips">
          <span class="f-chip accent">${f.gender==='female'?'หญิง':'ชาย'}</span>
          <span class="f-chip">${ageBucket}</span>
          <span class="f-chip">${exprTh(f.expression)}</span>
        </div>
        <div class="f-chips">${wearHtml}</div>
      </div>
    </div>`;
  }
  function renderLatest(){ $('latestGrid').innerHTML = LATEST.map((f,i)=>faceCard(f,'latest',i,f._new)).join(''); }

  // ───────── search ─────────
  const PER = 18; let searchPage = 1, _searchPages = 1;
  function renderSearch(){
    const total = SEARCH.length;
    _searchPages = Math.max(1, Math.ceil(total/PER));
    searchPage = Math.min(searchPage, _searchPages);
    const slice = SEARCH.slice((searchPage-1)*PER, searchPage*PER);
    $('resCount').textContent = total;
    $('searchGrid').innerHTML = slice.map((f,i)=>faceCard(f,'search',(searchPage-1)*PER+i)).join('') || `<div class="f-empty">ไม่พบใบหน้าตามตัวกรอง</div>`;
    renderFaceSummary();
    renderSearchPager(total);
  }
  function renderFaceSummary(){
    const s = { total:684, male:424, female:260, age_teen:58, age_young:346, age_mid:207, age_senior:73, masked:96 };
    const pct = n => Math.round(n/s.total*100);
    const stat = (v,l)=>`<div class="fs-stat"><div class="fs-val">${v}</div><div class="fs-lbl">${l}</div></div>`;
    $('faceSummary').innerHTML =
      stat(s.total.toLocaleString(),'ทั้งหมด') + stat(`${s.male} · ${pct(s.male)}%`,'ชาย') +
      stat(`${s.female} · ${pct(s.female)}%`,'หญิง') + stat(s.age_teen,'วัยรุ่น (<20)') +
      stat(s.age_young,'20–39') + stat(s.age_mid,'40–59') + stat(s.age_senior,'60+') +
      stat(`${s.masked} · ${pct(s.masked)}%`,'สวมหน้ากาก');
  }
  function pagerHtml(page, pages){
    if (pages<=1) return '';
    const btn = (v,lbl,dis,act)=>`<button data-pg="${v}" ${dis?'disabled':''} class="${act?'active':''}">${lbl}</button>`;
    let nums=''; for(let p=1;p<=pages;p++){ if(p===1||p===pages||Math.abs(p-page)<=1) nums+=btn(p,p,false,p===page);
      else if(Math.abs(p-page)===2) nums+='<span class="pg-gap">…</span>'; }
    return `<div class="pg-info">หน้า ${page} / ${pages}</div><div class="pg-btns">${btn('prev','‹',page===1)}${nums}${btn('next','›',page===pages)}</div>`;
  }
  function renderSearchPager(total){ $('searchPager').innerHTML = pagerHtml(searchPage,_searchPages); }

  // ───────── recognition feed ─────────
  const RPER = 15; let recogPage = 1, _recogPages = 1, recogFilter='all', recogSearch='';
  const RFILTERS = [['all','ทั้งหมด'],['blackList','เฝ้าระวัง'],['whiteList','รู้จัก'],['miss','ไม่พบในระบบ']];
  function renderRecogFilter(){
    $('recogFilterBar').innerHTML = RFILTERS.map(([k,l])=>`<button data-rf="${k}" class="${k===recogFilter?'active':''}">${l}</button>`).join('');
  }
  function recogRows(){
    let rows = recogFilter==='miss' ? MISSES.slice()
      : recogFilter==='all' ? HITS.concat(MISSES)
      : HITS.filter(h=>h.list_type===recogFilter);
    if (recogSearch){ const q=recogSearch.toLowerCase();
      rows = rows.filter(r => (r.person_name||'ไม่พบในระบบ').toLowerCase().includes(q) || (r.fd_lib_name||'').toLowerCase().includes(q) || camName(r.camera_id).toLowerCase().includes(q)); }
    return rows;
  }
  function renderRecog(){
    renderRecogFilter();
    const rows = recogRows();
    _recogPages = Math.max(1, Math.ceil(rows.length/RPER));
    recogPage = Math.min(recogPage, _recogPages);
    const slice = rows.slice((recogPage-1)*RPER, recogPage*RPER);
    $('recogCount').textContent = `${rows.length} รายการ`;
    $('recogFeed').innerHTML = slice.map(r=>{
      const black = r.list_type==='blackList';
      const gc = black?'var(--status-bad)': r.list_type==='whiteList'?'var(--status-ok)':'var(--text-secondary)';
      const badge = r.list_type ? `<span class="alert-badge" style="background:${gc}">${black?'เฝ้าระวัง':'รู้จัก'}</span>` : `<span class="alert-badge" style="background:var(--text-secondary)">ไม่พบ</span>`;
      const sim = r.similarity!=null ? `<span class="alert-sim">${Math.round(r.similarity*100)}%</span>` : '';
      const name = r.person_name ? esc(r.person_name) : 'ไม่พบในระบบ';
      const acked = r._ackBy ? `style="opacity:.5"`:'';
      const ackBtn = black ? (r._ackBy ? `<button class="alert-ack" disabled>รับทราบแล้ว</button>` : `<button class="alert-ack" data-ack>รับทราบ</button>`) : '';
      const gid = HITS.indexOf(r)>=0 ? 'h'+HITS.indexOf(r) : 'm'+MISSES.indexOf(r);
      return `<div class="alert-row ${black?'urgent':''}" ${acked} style="--gc:${gc}" data-row="${gid}">
        <div class="alert-thumb">${avatar(r)}</div>
        <div class="alert-body">
          <div class="alert-l1">${badge}<span class="alert-name">${name}</span>${sim}</div>
          <div class="alert-l2">${r.fd_lib_name?esc(r.fd_lib_name)+' · ':''}${esc(camName(r.camera_id))} · ${r.time} น.</div>
        </div>
        <div class="alert-side">
          <span class="alert-time">${r.time}</span>
          ${ackBtn}
        </div>
      </div>`;
    }).join('') || `<div class="f-empty">ไม่มีรายการ</div>`;
    $('recogPager').innerHTML = pagerHtml(recogPage,_recogPages);
  }
  function rowByGid(gid){ return gid[0]==='h' ? HITS[+gid.slice(1)] : MISSES[+gid.slice(1)]; }
  function renderRecogBadge(){ const b=$('recogTabBadge'); const n=HITS.filter(h=>h.list_type==='blackList').length; if(b) b.textContent = n||''; }
  function renderAlarmStrip(){
    const hits = HITS.filter(h=>h.list_type==='blackList').slice(0,5);
    $('alarmStrip').innerHTML = hits.length ? hits.map(r=>{
      const gc='var(--status-bad)';
      return `<div class="alarm-card" style="--gc:${gc}" data-alarm="h${HITS.indexOf(r)}">
        <div class="alarm-av">${avatar(r)}</div>
        <div class="alarm-info">
          <div class="alarm-row1"><span class="alarm-dot"></span><span class="alarm-grp">${esc(r.fd_lib_name)}</span><span class="alarm-time">${r.time}</span></div>
          <div class="alarm-name">${esc(r.person_name)}</div>
          <div class="alarm-meta">${Math.round(r.similarity*100)}% · ${esc(camName(r.camera_id))}</div>
        </div>
      </div>`; }).join('') : `<div class="alarm-empty">ยังไม่พบบุคคลเฝ้าระวังในช่วงนี้</div>`;
  }

  // ───────── modals ─────────
  function dataRows(pairs){ return pairs.filter(p=>p[1]!=null && p[1]!=='').map(([k,v])=>`<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join(''); }
  function wearText(f){ const w=[]; if(f.glass==='sunglasses')w.push('แว่นกันแดด');else if(f.glass==='yes')w.push('แว่นตา'); if(f.mask==='yes')w.push('หน้ากาก'); if(f.hat==='yes')w.push('หมวก'); return w.join(' · ')||'ไม่สวมใส่'; }
  function ageBucket(a){ a=+a; if(a<=19)return '13-19 ปี'; if(a>=60)return '60+ ปี'; const lo=Math.floor(a/10)*10; return `${lo}-${lo+9} ปี`; }
  function durTxt(ms){ const s=Math.round((+ms||0)/1000); return s<60?`${s} วินาที`:`${Math.floor(s/60)} นาที ${s%60} วินาที`; }

  function bodyChipsHtml(m){
    const chips = bodyChips(m); if(!chips.length) return '';
    return `<div class="body-sec"><div class="body-hd">รูปพรรณ / Body Appearance</div>
      <div class="body-grid">${chips.map(([k,v])=>`<div class="body-chip"><span class="bd-k">${k}</span><span class="bd-v">${v}</span></div>`).join('')}</div></div>`;
  }
  // image box. When the original photo is purged (retention), the real prod
  // image is gone — but the attribute metadata persists, so we re-render a
  // synthetic avatar from it (gender / hat / glasses / sunglasses / mask) with
  // a "reconstructed" tag, instead of a blank placeholder.
  const RECON_TAG = '<span class="im-deltag">ภาพจริงถูกลบ · สร้างจาก metadata</span>';
  function box(cls, f, mode, gone){
    return `<div class="imbox ${cls}${gone?' recon':''}">${avatar(f,mode)}${gone?RECON_TAG:''}</div>`;
  }
  // crop (primary face) + scene (thumbnail beneath). No body crop — full scene
  // already carries body context, and storing a 2nd full-body crop wastes storage.
  function capturedCol(f, gone){
    return `${box('crop tall', f, 'face', gone)}
      <div class="im-sub">ภาพจากกล้อง (ฉากเต็ม)</div>
      ${box('scenethumb', f, 'scene', gone)}`;
  }

  let _faceCur = null;
  function renderFaceBody(f){
    const gone = $('faceSimDeleted')?.checked;
    const scene = box('scene', f, 'scene', gone);
    const crop  = box('crop tall', f, 'face', gone);
    $('faceModalBody').innerHTML = `
      <div class="rm-top">
        <div class="im-cap-wrap"><div class="lm-cap">ภาพฉากเต็ม (snapshot)</div>${scene}</div>
        <div class="im-cap-wrap"><div class="lm-cap">ใบหน้า (crop)</div>${crop}</div>
      </div>
      <div class="lm-data">
        ${dataRows([
          ['กล้อง', esc(camName(f.camera_id))],['เพศ', f.gender==='female'?'หญิง':'ชาย'],
          ['อายุ (ประมาณ)', ageBucket(f.age)],['สีหน้า / อารมณ์', exprTh(f.expression)],
          ['การสวมใส่', wearText(f)],['ระยะเวลาที่อยู่ในเฟรม', durTxt(f.stay_duration)],
          ['คุณภาพใบหน้า', f.face_score+'%'],
        ])}
      </div>
      ${bodyChipsHtml(f)}`;
  }
  function openFaceModal(f){
    _faceCur=f; if($('faceSimDeleted')) $('faceSimDeleted').checked=false;
    $('fmTime').textContent = `วันนี้ ${f.time} น.`;
    renderFaceBody(f);
    $('faceModal').style.display='flex';
  }
  function closeFaceModal(){ $('faceModal').style.display='none'; }

  let _recogCur = null;
  function renderRecogBody(r){
    const black=r.list_type==='blackList';
    const gone = $('rmSimDeleted')?.checked;
    const ref = r.person_name
      ? `<div class="imbox crop tall">${avatar({...r,seed:r.seed+40},'face')}</div>
         <div class="im-refnote">ภาพลงทะเบียนฝั่งกล้อง (FD Library)</div>`
      : `<div class="imbox crop tall">${refDoc('ไม่มีรูปอ้างอิง')}</div>`;
    $('recogModalBody').innerHTML = `
      <div class="rm-top">
        <div class="im-cap-wrap"><div class="lm-cap">ภาพใบหน้า (ที่ตรวจพบ)</div>${capturedCol(r,gone)}</div>
        <div class="im-cap-wrap"><div class="lm-cap">ภาพอ้างอิง (FD Library)</div>${ref}</div>
      </div>
      <div class="lm-data">
        ${dataRows([
          ['บุคคล', `<strong>${r.person_name?esc(r.person_name):'ไม่พบในระบบ'}</strong>`],
          ['กลุ่ม FD Library', r.fd_lib_name?esc(r.fd_lib_name):'—'],
          ['ประเภท', r.list_type?(black?'บัญชีดำ (เฝ้าระวัง)':'บัญชีขาว (รู้จัก)'):'—'],
          ['ความเหมือน', r.similarity!=null?Math.round(r.similarity*100)+'%':'—'],
          ['กล้อง', esc(camName(r.camera_id))],['เพศ', r.gender==='female'?'หญิง':'ชาย'],
          ['อายุ', ageBucket(r.age)],['สีหน้า / อารมณ์', exprTh(r.expression)],
        ])}
      </div>
      ${bodyChipsHtml(r)}`;
  }
  function openRecogModal(r){
    _recogCur=r;
    const black=r.list_type==='blackList';
    const gc=black?'var(--status-bad)':r.list_type==='whiteList'?'var(--status-ok)':'var(--text-secondary)';
    $('rmBadge').textContent = r.list_type?(black?'เฝ้าระวัง':'รู้จัก'):'ไม่พบ'; $('rmBadge').style.background=gc;
    $('rmName').textContent = r.person_name || 'ไม่พบในระบบ';
    $('rmTime').textContent = `วันนี้ ${r.time} น.`;
    if ($('rmSimDeleted')) $('rmSimDeleted').checked=false;
    renderRecogBody(r);
    $('rmAck').style.display = black?'':'none';
    $('rmAck').disabled = !!r._ackBy;
    $('rmAck').textContent = r._ackBy?'รับทราบแล้ว':'รับทราบ';
    $('rmAckLog').textContent = r._ackBy ? `รับทราบโดย ${r._ackBy} เมื่อ ${r._ackAt}` : '';
    $('rmNoteInput').value = r._opNote || '';
    $('rmNoteSaved').textContent = r._opNoteAt ? `บันทึกโดย ${r._opNoteBy} เมื่อ ${r._opNoteAt}` : '';
    $('recogModal').style.display='flex';
  }
  function saveRecogNote(){ const r=_recogCur; if(!r) return; const n=new Date();
    r._opNote = $('rmNoteInput').value.trim(); r._opNoteBy=DEMO_USER; r._opNoteAt=`${pad(n.getHours())}:${pad(n.getMinutes())}`;
    $('rmNoteSaved').textContent = `บันทึกแล้ว โดย ${r._opNoteBy} เมื่อ ${r._opNoteAt}`; }
  function closeRecogModal(){ $('recogModal').style.display='none'; }
  function ackRecog(){ const r=_recogCur; if(!r||r._ackBy) return; const n=new Date(); r._ackBy=DEMO_USER; r._ackAt=`${pad(n.getHours())}:${pad(n.getMinutes())}`;
    $('rmAck').disabled=true; $('rmAck').textContent='รับทราบแล้ว'; $('rmAckLog').textContent=`รับทราบโดย ${r._ackBy} เมื่อ ${r._ackAt}`; renderRecog(); }
  function openLightbox(html){ $('ilInner').innerHTML=html; $('imgLightbox').style.display='flex'; }

  function fillSelects(){
    const opt=(v,t)=>`<option value="${v}">${t}</option>`;
    $('fExpr').innerHTML = `<option value="">ทั้งหมด</option>`+EXPR.map(e=>opt(e.code,e.th)).join('');
    $('fCam').innerHTML = `<option value="">ทั้งหมด</option>`+CAMS.map(c=>opt(c.id,c.name)).join('');
    const colorOpts = `<option value="">ทั้งหมด</option>`+COLORS.map(c=>opt(c[0],c[1])).join('');
    $('fTopColor').innerHTML = colorOpts; $('fBottomColor').innerHTML = colorOpts;
    $('fTopType').innerHTML = `<option value="">ทั้งหมด</option>`+TOP_TYPES.map(t=>opt(t[0],t[1])).join('');
    $('fBottomType').innerHTML = `<option value="">ทั้งหมด</option>`+BOT_TYPES.map(t=>opt(t[0],t[1])).join('');
  }
  function resetSearch(){ ['fGender','fAge','fExpr','fGlass','fMask','fHat','fCam','fTopColor','fBottomColor','fTopType','fBottomType','fFrom','fTo'].forEach(id=>{ if($(id))$(id).value=''; }); searchPage=1; renderSearch(); }

  // ───────── settings ─────────
  function renderSettings(){
    $('recogSettings').innerHTML = `
      <div class="set-row"><div><div class="k">เกณฑ์ความเหมือนขั้นต่ำ</div><div class="d">ต่ำกว่านี้ถือว่า "ไม่พบในระบบ"</div></div>
        <div class="ctl"><input class="form-input" type="number" value="80" min="50" max="99"> %</div></div>
      <div class="set-row"><div><div class="k">เก็บข้อมูลใบหน้า (วัน)</div><div class="d">เกินกำหนดจะลบรูป คงไว้เฉพาะ metadata</div></div>
        <div class="ctl"><input class="form-input" type="number" value="30" min="1" max="730"></div></div>
      <div class="set-row"><div><div class="k">แสดงสีหน้า / อารมณ์</div><div class="d">ปิดได้หากไม่ต้องการในรายงานผู้บริหาร</div></div>
        <label class="switch-row ctl"><input type="checkbox" checked> เปิด</label></div>
      <div class="set-row"><div><div class="k">แจ้งเตือน LINE เมื่อพบบัญชีดำ</div><div class="d">ส่งทันทีพร้อมรูปเทียบ</div></div>
        <label class="switch-row ctl"><input type="checkbox" checked> เปิด</label></div>`;
    $('camList').innerHTML = CAMS.map(c=>`
      <div class="cam-row">
        <div><div class="nm">${esc(c.name)}</div><div class="code">${esc(c.id)}</div></div>
        <label class="switch-row" style="margin-left:auto;padding:0"><input type="checkbox" checked> บันทึก</label>
        <label class="switch-row" style="padding:0"><input type="checkbox" ${c.id!=='HIK-FACE02'?'checked':''}> จดจำ</label>
      </div>`).join('');
  }

  // ───────── live tick ─────────
  function tick(){
    if ($('tab-overview').style.display==='none') return;
    const f = mkFace(Math.floor(Math.random()*42)); f._new=true;
    const now=new Date(); f.time=`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    LATEST.unshift(f); LATEST=LATEST.slice(0,8); renderLatest();
    setTimeout(()=>{ f._new=false; },500);
  }

  // ───────── pickers / theme ─────────
  const ADP_TH = { days:['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'],
    daysShort:['อา','จ','อ','พ','พฤ','ศ','ส'], daysMin:['อา','จ','อ','พ','พฤ','ศ','ส'],
    months:['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
    monthsShort:['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
    today:'วันนี้', clear:'ล้าง', dateFormat:'dd/MM/yyyy', timeFormat:'HH:mm', firstDay:0 };
  function initPickers(){ if(typeof AirDatepicker==='undefined')return;
    const o={ locale:ADP_TH, timepicker:true, dateFormat:'dd/MM/yyyy', timeFormat:'HH:mm', isMobile:window.innerWidth<=768, position:'bottom left' };
    ['fFrom','fTo','pFrom','pTo'].forEach(id=>{ if($(id)) new AirDatepicker($(id),o); }); }
  function toggleTheme(){ const cur=document.documentElement.getAttribute('data-theme');
    if(cur==='light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','light'); renderCharts(); }

  // ───────── bindings ─────────
  $('faceTabBar').addEventListener('click', e=>{
    const b=e.target.closest('.tab[data-tab]'); if(!b)return;
    document.querySelectorAll('#faceTabBar .tab').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const t=b.dataset.tab; ['overview','recog','search','settings'].forEach(n=>{ $('tab-'+n).style.display = n===t?'':'none'; });
    if(t==='recog') renderRecog(); if(t==='search') renderSearch();
  });
  $('alarmBlock').addEventListener('click', e=>{
    const c=e.target.closest('[data-alarm]'); if(c){ openRecogModal(rowByGid(c.dataset.alarm)); return; }
    if(e.target.closest('[data-goto-recog]')){ document.querySelector('#faceTabBar .tab[data-tab="recog"]').click(); }
  });
  $('periodBar').addEventListener('click', e=>{ const b=e.target.closest('button[data-p]'); if(!b)return;
    document.querySelectorAll('#periodBar button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); period=b.dataset.p;
    $('customRange').style.display=period==='custom'?'':'none'; renderKpi(); renderCharts(); });
  $('latestGrid').addEventListener('click', e=>{ const c=e.target.closest('.f-card[data-idx]'); if(c) openFaceModal(LATEST[+c.dataset.idx]); });
  $('searchGrid').addEventListener('click', e=>{ const c=e.target.closest('.f-card[data-idx]'); if(c) openFaceModal(SEARCH[+c.dataset.idx]); });
  $('recogFilterBar').addEventListener('click', e=>{ const b=e.target.closest('button[data-rf]'); if(!b)return; recogFilter=b.dataset.rf; recogPage=1; renderRecog(); });
  let _rsT; $('recogSearch').addEventListener('input', e=>{ recogSearch=e.target.value; recogPage=1; clearTimeout(_rsT); _rsT=setTimeout(renderRecog,200); });
  $('recogFeed').addEventListener('click', e=>{
    const a=e.target.closest('[data-ack]');
    const row=e.target.closest('.alert-row[data-row]'); if(!row)return; const r=rowByGid(row.dataset.row);
    if(a){ e.stopPropagation(); const n=new Date(); r._ackBy=DEMO_USER; r._ackAt=`${pad(n.getHours())}:${pad(n.getMinutes())}`; renderRecog(); return; }
    openRecogModal(r);
  });
  $('recogPager').addEventListener('click', e=>{ const b=e.target.closest('button[data-pg]'); if(!b||b.disabled)return; const v=b.dataset.pg;
    recogPage = v==='prev'?Math.max(1,recogPage-1):v==='next'?Math.min(_recogPages,recogPage+1):+v; renderRecog(); $('recogFeed').scrollIntoView({block:'start',behavior:'smooth'}); });
  $('searchPager').addEventListener('click', e=>{ const b=e.target.closest('button[data-pg]'); if(!b||b.disabled)return; const v=b.dataset.pg;
    searchPage = v==='prev'?Math.max(1,searchPage-1):v==='next'?Math.min(_searchPages,searchPage+1):+v; renderSearch(); $('searchGrid').scrollIntoView({block:'start',behavior:'smooth'}); });
  $('faceModalX').addEventListener('click', closeFaceModal);
  $('faceModal').addEventListener('click', e=>{ if(e.target.id==='faceModal') closeFaceModal(); });
  $('faceSimDeleted').addEventListener('change', ()=>{ if(_faceCur) renderFaceBody(_faceCur); });
  $('recogModalX').addEventListener('click', closeRecogModal);
  // recog modal: X only closes (no backdrop close — per alert spec)
  $('rmSimDeleted').addEventListener('change', ()=>{ if(_recogCur) renderRecogBody(_recogCur); });
  $('rmAck').addEventListener('click', ackRecog);
  $('rmNoteSave').addEventListener('click', saveRecogNote);
  $('rmViewFull').addEventListener('click', ()=>{ if(!_recogCur) return; openLightbox(box('scene',_recogCur,'scene',$('rmSimDeleted')?.checked)); });
  $('rmViewRef').addEventListener('click', ()=>{ if(!_recogCur) return; openLightbox(`<div class="imbox crop tall">${_recogCur.person_name?avatar({..._recogCur,seed:_recogCur.seed+40},'face'):refDoc('ไม่มีรูปอ้างอิง')}</div>`); });
  $('imgLightbox').addEventListener('click', ()=>{ $('imgLightbox').style.display='none'; });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeFaceModal(); closeRecogModal(); $('imgLightbox').style.display='none'; } });
  $('btnTheme').addEventListener('click', toggleTheme);
  $('btnSearch').addEventListener('click', ()=>{ searchPage=1; renderSearch(); });
  $('btnReset').addEventListener('click', resetSearch);

  // ───────── init ─────────
  fillSelects(); initPickers();
  renderKpi(); renderCharts(); renderLatest(); renderAlarmStrip(); renderRecogBadge();
  renderSettings();
  setInterval(tick, 3000);
})();
