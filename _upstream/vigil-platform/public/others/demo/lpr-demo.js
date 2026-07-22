// LPR Redesign — DRAFT demo logic (CSP-compliant external script, no inline handlers)
// Filter OPTIONS reflect REAL DB values (queried 2026-06-19). Table ROWS are mock.
(function(){
  const $ = id => document.getElementById(id);
  const token = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  // ───────── REAL DB reference values ─────────
  // 77 จังหวัด + ไม่ทราบ (from src/routes/lpr.js TH_PROVINCE)
  const PROVINCES = ['กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','พะเยา','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยะลา','ยโสธร','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อุดรธานี','อุทัยธานี','อุตรดิตถ์','อุบลราชธานี','อำนาจเจริญ'];

  // vehicle_type — real distinct codes + live counts (Hikvision raw → Thai label)
  const VTYPES = [
    { code:'twoWheelVehicle',   th:'จักรยานยนต์',          n:122, on:true },
    { code:'SUVMPV',            th:'รถอเนกประสงค์ (SUV/MPV)', n:117, on:true },
    { code:'buggy',             th:'รถเล็ก/บักกี้',         n:48,  on:true },
    { code:'van',               th:'รถตู้',                 n:46,  on:true },
    { code:'vehicle',           th:'รถยนต์ (ทั่วไป)',        n:39,  on:true },
    { code:'truck',             th:'รถบรรทุก',              n:29,  on:true },
    { code:'pickupTruck',       th:'รถกระบะ',               n:20,  on:true },
    { code:'largeBus',          th:'รถบัส',                 n:4,   on:true },
    { code:'threeWheelVehicle', th:'รถสามล้อ',              n:2,   on:true },
    { code:'pedestrian',        th:'คนเดินเท้า',            n:1,   on:false }, // ไม่ใช่รถ → ปิด default
  ];
  // vehicle_color — real: black/unknown/gray/white
  const VCOLORS = [
    { code:'black', th:'ดำ',  hex:'#1a1a1a', n:201 },
    { code:'gray',  th:'เทา', hex:'#888',    n:59 },
    { code:'white', th:'ขาว', hex:'#f0f0f0', n:43 },
    { code:'unknown', th:'ไม่ทราบ', hex:null, n:125 },
  ];
  // plateColor (raw_json) — Thai plate background colors; 'unknown' ∪ NULL = ไม่ทราบ
  const PCOLORS = [
    { code:'white',  th:'ป้ายขาว (ส่วนบุคคล)', plate:'#f3f4ef', ink:'#16181d', n:345 },
    { code:'yellow', th:'ป้ายเหลือง (รับจ้าง)', plate:'#f2c200', ink:'#16181d', n:2 },
    { code:'green',  th:'ป้ายเขียว',            plate:'#1f7a3d', ink:'#fff',     n:4 },
    { code:'red',    th:'ป้ายแดง (รถใหม่)',     plate:'#f3f4ef', ink:'#c62828', border:'#c62828', n:2 }, // DLT: พื้นขาว ตัว+กรอบแดง
    { code:'__unknown', th:'ไม่ทราบ', plate:'#3a3f4b', ink:'#cfd3dc', n:75 }, // 21 'unknown' + 54 null
  ];
  const LANES = ['1','2','3'];           // real laneNo values
  const CAMS  = ['HIK-V_LPR01'];          // real camera_id

  function vtypeLabel(code){ const v = VTYPES.find(x=>x.code===code); return v ? v.th : code; }

  // ───────── Direction config — per-camera (operator tags each LPR cam = เข้า/ออก) ─────────
  // like Events/category mapping: assign direction per camera, not per lane.
  // default: all 'none' → no direction shown; chart falls back to "ผ่าน" total.
  let LPR_CAMS = [
    { id:'HIK-V_LPR01', name:'ประตูหลัก', dir:'none', hr:[18,24,31,28,22,26,30,27] },
    { id:'HIK-V_LPR02', name:'ประตูหลัง', dir:'none', hr:[ 9,12,14,11,16,13,18,15] },
    { id:'HIK-V_LPR03', name:'ลานจอด B',  dir:'none', hr:[13,17,20,18,15,19,22,16] },
  ];

  // ───────── mock rows ─────────
  const PROV_PREFIX = ['กท','1กข','ภก','2ขค','พง','3งจ'];
  function mkRow(i){
    const vt = VTYPES[i % 7];
    const vc = VCOLORS[i % VCOLORS.length];
    const pc = PCOLORS[i % PCOLORS.length];
    const reg = [ 'ภูเก็ต','พังงา','ไม่ทราบ','กรุงเทพมหานคร','สตูล','กระบี่' ][i % 6];
    return {
      prov: PROV_PREFIX[i % PROV_PREFIX.length], num: String(1000 + ((i*137) % 8999)),
      region: reg, vtype: vt.code, vcolor: vc, pcolor: pc, lane: LANES[i % 3],
      brand: '', conf: 88 + (i*7 % 12), cam:'HIK-V_LPR01',
      time: ['01:42','01:38','01:31','01:24','01:18','01:05'][i] || ('00:'+(59-i)),
      flagged: i === 1,
    };
  }
  let   LATEST  = Array.from({length:5},  (_,i)=>mkRow(i));
  const RESULTS = Array.from({length:12}, (_,i)=>mkRow(i));

  // fresh arrival generator (demo: simulate a new plate every 3s)
  let _tick = 5;
  function mkFresh(){
    const r = mkRow(Math.floor(Math.random()*7) + _tick++);
    const now = new Date();
    r.time = now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
    r.flagged = Math.random() < 0.15;
    return r;
  }

  // ───────── Overview KPIs (item 1 period-aware, item 4 no-plate) ─────────
  const PERIOD_DATA = {
    hour:      { total:18,  uniq:17,  noplate:1,  watch:0, label:'ชั่วโมงนี้' },
    today:     { total:342, uniq:289, noplate:23, watch:2, label:'วันนี้' },
    yesterday: { total:318, uniq:271, noplate:19, watch:1, label:'เมื่อวาน' },
    week:      { total:1980,uniq:1456,noplate:122,watch:6, label:'สัปดาห์นี้' },
    month:     { total:8124,uniq:5980,noplate:540,watch:21,label:'เดือนนี้' },
    custom:    { total:512, uniq:430, noplate:34, watch:3, label:'กำหนดเอง' },
  };
  let period = 'today';

  function renderKpi(){
    const d = PERIOD_DATA[period];
    const items = [
      { ka:'var(--accent)', label:'ป้ายทั้งหมด', val:d.total.toLocaleString(), sub:period==='today'?'▲ 8% เทียบเมื่อวาน':'ช่วง '+d.label, subc:period==='today'?'var(--status-ok)':'var(--text-secondary)',
        icon:'<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="7" y1="12" x2="11" y2="12"/><line x1="13" y1="12" x2="18" y2="12"/>' },
      { ka:'var(--purple)', label:'ป้ายไม่ซ้ำ', val:d.uniq.toLocaleString(), sub:Math.round(d.uniq/d.total*100)+'% ของทั้งหมด', subc:'var(--text-secondary)',
        icon:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>' },
      { ka:'var(--warn)', label:'รถไม่ติดป้ายทะเบียน', val:d.noplate.toLocaleString(), sub:'⚠ ต้องเพิ่ม ingestion', subc:'var(--warn)',
        icon:'<path d="M3 3l18 18M10.5 5H19a2 2 0 0 1 2 2v8M5 7v10a2 2 0 0 0 2 2h11"/>' },
      { ka:'var(--status-bad)', label:'ตรงเฝ้าระวัง', val:d.watch.toLocaleString(), sub:'ช่วง '+d.label, subc:d.watch?'var(--status-bad)':'var(--text-secondary)',
        icon:'<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>' },
    ];
    $('kpiGrid').innerHTML = items.map(k=>`
      <div class="kpi" style="--ka:${k.ka}">
        <div class="ki" style="color:${k.ka}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${k.icon}</svg></div>
        <div class="kl">${k.label}</div>
        <div class="kv">${k.val}</div>
        <div class="ks" style="color:${k.subc}">${k.sub}</div>
      </div>`).join('');
  }

  // ───────── synthetic plate plaque (no real crop loaded on grid) ─────────
  // motorcycle/3-wheel = square 2-line; others = wide single-line. Colors per DLT.
  function isMoto(r){ return r.vtype==='twoWheelVehicle' || r.vtype==='threeWheelVehicle'; }
  function provKnown(r){ return r.region && r.region !== 'ไม่ทราบ'; }
  // showProv: add province line (modal only) — authentic to real plates; hidden when ไม่ทราบ
  // Delegate to the PRODUCTION plaque renderer (/lpr-plaque.js) — single source of
  // truth so the demo can never drift from prod (e.g. real Thai motorcycle layout:
  // prefix top / province middle / number bottom, fixed in commit c279e7d).
  function plaqueHtml(r, big, showProv){
    if (typeof window.lprPlaque === 'function') {
      return window.lprPlaque(`${r.prov}${r.num}`, {
        vehicleType: r.vtype,
        plateColor: r.pcolor.code === '__unknown' ? 'unknown' : r.pcolor.code,
        region: r.region,
        big: !!big, showProv: !!showProv,
      });
    }
    // fallback (prod renderer not served): plain single-line
    const brd = r.pcolor.border ? `;border-color:${r.pcolor.border};border-width:2px` : '';
    return `<span class="lpr-plaque${big?' big':''}" style="background:${r.pcolor.plate};color:${r.pcolor.ink}${brd}">${r.prov} ${r.num}</span>`;
  }

  // ───────── plate card ─────────
  function plateCard(r, enter, src, idx){
    const dot = r.vcolor.hex ? `<span class="cdot" style="background:${r.vcolor.hex}"></span>` : '';
    return `<div class="lpr-card ${r.flagged?'flagged':''} ${enter?'enter':''}" data-src="${src}" data-idx="${idx}">
      <div class="lpr-thumb">
        ${r.flagged?'<span class="lpr-flag">⚠ เฝ้าระวัง</span>':''}
        ${plaqueHtml(r, false)}
      </div>
      <div class="lpr-body">
        <div class="lpr-plate"><span class="prov">${r.prov}</span> ${r.num}</div>
        <div class="lpr-region">${r.region}</div>
        <div class="lpr-tags">
          <span class="lpr-tag accent">${vtypeLabel(r.vtype)}</span>
          <span class="lpr-tag">${dot}${r.vcolor.th}</span>
          <span class="lpr-tag">เลน ${r.lane}</span>
          <span class="lpr-tag">${r.conf}%</span>
        </div>
        <div class="lpr-meta"><span>${r.cam}</span><span>${r.time}</span></div>
      </div>
    </div>`;
  }
  function renderLatest(animateFirst){
    $('latestGrid').innerHTML = LATEST.map((r,i)=>plateCard(r, animateFirst && i===0, 'latest', i)).join('');
  }
  function renderSearch(){ $('searchGrid').innerHTML = RESULTS.map((r,i)=>plateCard(r,false,'search',i)).join(''); }
  function renderCards(){ renderLatest(false); renderSearch(); }

  // ───────── retention fallback (RF4) — image deleted after lpr_image_retention_days (7d) ─────────
  // DB row (plate + metadata) kept longer (lpr_retention_days, 30d) but JPGs pruned.
  // real-plate-crop → readable plaque; full-scene → vehicle silhouette by type.
  // Vehicle vector comes from the shared /lpr-plaque.js (window.lprVehicleSvg) so the
  // demo can't drift from prod. Identical layout is ported to prod (page-lpr.js).
  function vehicleSvg(r){ return (typeof window.lprVehicleSvg === 'function') ? window.lprVehicleSvg(r.vtype) : ''; }
  function sceneGone(r){
    const c = r.vcolor.th && r.vcolor.th!=='ไม่ทราบ' ? ` · สี${r.vcolor.th}` : '';
    return `<div class="lpr-imggone"><div class="ig-veh">${vehicleSvg(r)}</div>
      <div class="ig-cap">ภาพขนาดเต็มถูกลบแล้ว<br><small>นโยบายเก็บรูป 7 วัน · ${vtypeLabel(r.vtype)}${c}</small></div></div>`;
  }
  function realGone(r){
    return `<div class="lpr-imggone plate"><div class="ig-plaque">${plaqueHtml(r, false, false)}</div>
      <div class="ig-cap">ภาพป้ายจริงถูกลบแล้ว · แสดงทะเบียนที่อ่านได้</div></div>`;
  }

  // ───────── detail modal — real crop / plaque / scene (with retention fallback) ─────────
  let _lastModalR = null;
  function renderModalMedia(r){
    const gone = $('lmSimDeleted') && $('lmSimDeleted').checked;
    $('lmReal').innerHTML  = gone ? realGone(r)  : `<div class="lm-realcrop">ภาพป้ายจริงจากกล้อง<br><small>${r.prov} ${r.num}</small></div>`;
    $('lmPlaque').innerHTML = plaqueHtml(r, true, true);
    $('lmScene').innerHTML = gone ? sceneGone(r) : `<div class="lm-scenebox">Snapshot ฉากเต็ม<br><small>${r.cam} · ${r.time}</small></div>`;
  }
  function openModal(r){
    _lastModalR = r;
    const dot = r.vcolor.hex ? `<span class="cdot" style="background:${r.vcolor.hex}"></span>` : '';
    renderModalMedia(r);
    const rows = [
      ['ป้ายทะเบียน', `${r.prov} ${r.num}`],
      ['จังหวัด', r.region],
      ['ประเภทรถ', vtypeLabel(r.vtype)],
      ['สีรถ', `${dot}${r.vcolor.th}`],
      ['สีป้าย', `<span class="lm-pswatch" style="background:${r.pcolor.plate}${r.pcolor.border?`;border-color:${r.pcolor.border}`:''}"></span>${r.pcolor.th}`],
      ['เลน', r.lane],
      ['ความมั่นใจ', r.conf + '%'],
      ['กล้อง', r.cam],
      ['เวลา', r.time],
    ];
    $('lmData').innerHTML = rows.map(([k,v])=>`<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join('');
    _modalOpen = true;
    $('lprModal').style.display = 'flex';
  }
  function closeModal(){ _modalOpen = false; $('lprModal').style.display = 'none'; }

  // auto-refresh: prepend a fresh plate every 3s while overview tab is visible
  let _modalOpen = false;
  function tickRefresh(){
    if (document.hidden) return;
    if (_modalOpen) return;                                  // pause while viewing detail
    if ($('tab-overview').style.display === 'none') return;
    LATEST.unshift(mkFresh());
    LATEST = LATEST.slice(0, 5);
    renderLatest(true);
  }

  // ───────── charts ─────────
  let charts = [];
  function renderCharts(){
    charts.forEach(c=>c.destroy()); charts = [];
    const acc = token('--accent'), grid = token('--border-hairline'), dim = token('--text-secondary');
    Chart.defaults.color = dim;
    Chart.defaults.font.family = token('--ui-font-family') || 'sans-serif';
    const noLegend = { plugins:{legend:{display:false}}, maintainAspectRatio:false };

    charts.push(new Chart($('chHourly'), { type:'bar',
      data:{ labels:Array.from({length:24},(_,i)=>i+':00'),
        datasets:[{ data:[4,2,1,1,3,9,22,38,31,24,19,21,26,23,18,20,27,34,29,17,12,9,6,4],
          backgroundColor:acc, borderRadius:3, barPercentage:.8 }] },
      options:{ ...noLegend, scales:{ x:{grid:{display:false},ticks:{maxTicksLimit:8,font:{size:10}}}, y:{grid:{color:grid},ticks:{font:{size:10}}} } } }));

    // direction chart — aggregate per-camera direction (operator-assigned)
    const HRS = ['08','09','10','11','12','13','14','15'];
    const sumHr = cams => HRS.map((_, h) => cams.reduce((s, c) => s + c.hr[h], 0));
    const ins  = LPR_CAMS.filter(c => c.dir === 'in');
    const outs = LPR_CAMS.filter(c => c.dir === 'out');
    const dirOpts = { x:{grid:{display:false},ticks:{font:{size:10}}}, y:{grid:{color:grid},ticks:{font:{size:10}}} };
    if (ins.length || outs.length) {
      const ds = [];
      if (ins.length)  ds.push({ label:'เข้า', data:sumHr(ins),  borderColor:token('--status-ok'), backgroundColor:'transparent', tension:.35, pointRadius:0, borderWidth:2 });
      if (outs.length) ds.push({ label:'ออก', data:sumHr(outs), borderColor:token('--warn'),      backgroundColor:'transparent', tension:.35, pointRadius:0, borderWidth:2 });
      charts.push(new Chart($('chDir'), { type:'line', data:{ labels:HRS, datasets:ds },
        options:{ maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}}}, scales:dirOpts } }));
      $('dirNote').innerHTML = (ins.length && outs.length) ? ''
        : `กำหนดทิศเดียว (${ins.length ? 'ขาเข้า' : 'ขาออก'}) — กำหนดอีกฝั่งได้ที่แท็บ <b>ตั้งค่า</b>`;
    } else {
      charts.push(new Chart($('chDir'), { type:'line',
        data:{ labels:HRS, datasets:[{ label:'ผ่าน', data:sumHr(LPR_CAMS), borderColor:acc, backgroundColor:'transparent', tension:.35, pointRadius:0, borderWidth:2 }] },
        options:{ ...noLegend, scales:dirOpts } }));
      $('dirNote').innerHTML = 'ยังไม่กำหนดทิศทางกล้อง → แสดงยอด "ผ่าน" รวม · กำหนดได้ที่แท็บ <b>ตั้งค่า</b>';
    }

    // province (replaces brand) — real top regions
    charts.push(new Chart($('chProvince'), { type:'bar',
      data:{ labels:['ภูเก็ต','พังงา','ไม่ทราบ','กรุงเทพฯ','สตูล','กระบี่'], datasets:[{ data:[115,85,68,47,28,12], backgroundColor:acc, borderRadius:3, barPercentage:.7 }] },
      options:{ ...noLegend, indexAxis:'y', scales:{ x:{grid:{color:grid},ticks:{font:{size:10}}}, y:{grid:{display:false},ticks:{font:{size:11}}} } } }));

    // vehicle type donut — only enabled types
    const shown = VTYPES.filter(v=>v.on);
    const palette = [acc, token('--purple'), token('--status-ok'), token('--warn'), token('--status-bad'), '#14b8a6', '#e879a6', '#f59e0b', '#64748b'];
    charts.push(new Chart($('chType'), { type:'doughnut',
      data:{ labels:shown.map(v=>v.th), datasets:[{ data:shown.map(v=>v.n), backgroundColor:shown.map((_,i)=>palette[i%palette.length]), borderWidth:0 }] },
      options:{ maintainAspectRatio:false, cutout:'60%', plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10}}}} } }));
  }

  // ───────── Watchlist (เฝ้าระวัง) — items 10-13 ─────────
  let WGROUPS = [
    { id:'suspect', name:'รถผู้ต้องสงสัย', color:'#f59e0b' },
    { id:'warrant', name:'รถตามหมายจับ',  color:'#ef4444' },
    { id:'vip',     name:'รถ VIP',         color:'#22c55e' },
  ];
  let WL = [
    { plate:'1กข 1234', region:'กรุงเทพมหานคร', group:'warrant', mode:'plate', note:'หมายจับ 124/2569 — ปล้นทรัพย์', img:true, instant:true },
    { plate:'ภก 5678',  region:'ภูเก็ต',        group:'suspect', mode:'plate_region', note:'ต้องสงสัยคดียาเสพติด', img:false, instant:true },
    { plate:'8ฒฬ 7788', region:'',              group:'vip',     mode:'plate', note:'เปิดไม้กั้นอัตโนมัติ', img:false, instant:false },
  ];
  let wlFilter = 'all';
  function groupById(id){ return WGROUPS.find(g=>g.id===id); }

  // ───────── Watchlist-hit alarms (overview strip + การแจ้งเตือน tab) ─────────
  // A detected vehicle that matched a watchlist entry. In prod = anprAlarm events
  // ⨝ lpr_watchlist (a new /api/lpr/alerts endpoint + WS push); here = mock.
  const _NOW = new Date();
  const _ALARM_GRP = ['warrant','suspect','suspect','vip','warrant','suspect','warrant','suspect','vip','suspect'];
  function _pad(n){ return String(n).padStart(2,'0'); }
  function _alarmNote(g,i){
    if(g==='warrant') return `หมายจับ ${100+(i*7)%300}/2569 — ${['ปล้นทรัพย์','ลักทรัพย์','ฉ้อโกง','ทำร้ายร่างกาย','คดียาเสพติด'][i%5]}`;
    if(g==='suspect') return `ต้องสงสัย${['คดียาเสพติด','ค้ามนุษย์','อาวุธเถื่อน','คดีอุกฉกรรจ์'][i%4]}`;
    return 'รถ VIP — เปิดไม้กั้นอัตโนมัติ';
  }
  // 100 mock hits, full plate data (for modal) + group/note/mode/ref + real timestamp
  // spread over ~28 days. prod = anprAlarm ⨝ lpr_watchlist (/api/lpr/alerts + WS).
  function mkAlarmHit(i){
    const base = mkRow(i % 12);
    const g = _ALARM_GRP[i % _ALARM_GRP.length];
    const ts = new Date(_NOW.getTime() - Math.floor(i/3.6)*86400000 - ((i*37)%1440)*60000);
    const hm = `${_pad(ts.getHours())}:${_pad(ts.getMinutes())}`;
    return Object.assign({}, base, {
      plate:`${base.prov} ${base.num}`, group:g, note:_alarmNote(g,i),
      mode: i%3===0 ? 'plate_region' : 'plate', ref: i%4===0, ts, hm,
      timeStr:`${_pad(ts.getDate())}/${_pad(ts.getMonth()+1)} ${hm}`,
    });
  }
  let ALARM_HITS = Array.from({length:100}, (_,i)=>mkAlarmHit(i)).sort((a,b)=>b.ts-a.ts);
  let alertFilter='all', alertPeriod='all', alertSearch='';

  function alarmPlaque(h){
    const pc = (h.pcolor && h.pcolor.code==='__unknown') ? 'unknown' : (h.pcolor && h.pcolor.code) || 'white';
    return (typeof window.lprPlaque==='function')
      ? window.lprPlaque(h.plate.replace(/\s/g,''), { vehicleType:h.vtype, plateColor:pc, region:h.region })
      : `<span>${h.plate}</span>`;
  }
  // overview strip — 4 latest, compact (click → การแจ้งเตือน tab)
  function renderAlarmStrip(){
    const wrap = $('alarmStrip'); if(!wrap) return;
    const hits = ALARM_HITS.slice(0,4);
    if(!hits.length){ wrap.innerHTML = `<div class="alarm-empty">ไม่มีการแจ้งเตือนเฝ้าระวัง</div>`; return; }
    wrap.innerHTML = hits.map(h=>{ const g=groupById(h.group)||{name:'',color:'#888'};
      return `<div class="alarm-card${h.group==='warrant'?' urgent':''}" style="--gc:${g.color}" data-goto-alerts>
        <div class="alarm-row1"><span class="alarm-dot"></span><span class="alarm-grp">${g.name}</span><span class="alarm-time">${h.hm}</span></div>
        <div class="alarm-plate">${h.plate}</div>
        <div class="alarm-meta">${h.region || vtypeLabel(h.vtype)}</div>
      </div>`;
    }).join('');
  }
  function renderAlertFilter(){
    const bar = $('alertFilterBar'); if(!bar) return;
    const counts = ALARM_HITS.reduce((m,h)=>{m[h.group]=(m[h.group]||0)+1;return m;},{});
    let html = `<button class="${alertFilter==='all'?'active':''}" data-af="all">ทั้งหมด <b>${ALARM_HITS.length}</b></button>`;
    html += WGROUPS.map(g=>`<button class="${alertFilter===g.id?'active':''}" data-af="${g.id}"><span class="wl-gdot" style="background:${g.color}"></span>${g.name} <b>${counts[g.id]||0}</b></button>`).join('');
    bar.innerHTML = html;
  }
  function renderAlertPeriod(){
    const bar = $('alertPeriodBar'); if(!bar) return;
    bar.innerHTML = [['all','ทั้งหมด'],['today','วันนี้'],['yesterday','เมื่อวาน'],['week','สัปดาห์นี้'],['month','เดือนนี้']]
      .map(([k,l])=>`<button class="${alertPeriod===k?'active':''}" data-ap="${k}">${l}</button>`).join('');
  }
  function _alertInPeriod(ts){
    const now=_NOW, dayMs=86400000, sameDay=(a,b)=>a.toDateString()===b.toDateString();
    if(alertPeriod==='today') return sameDay(ts,now);
    if(alertPeriod==='yesterday') return sameDay(ts,new Date(now.getTime()-dayMs));
    if(alertPeriod==='week') return (now-ts)<=7*dayMs;
    if(alertPeriod==='month') return (now-ts)<=30*dayMs;
    return true;
  }
  const ALERT_PER = 15; let alertPage = 1, _alertPages = 1;
  function renderAlertPager(total){
    const el = $('alertPager'); if(!el) return;
    if(_alertPages<=1){ el.innerHTML=''; return; }
    const start=(alertPage-1)*ALERT_PER+1, end=Math.min(alertPage*ALERT_PER,total);
    let nums='';
    for(let i=1;i<=_alertPages;i++){
      if(i===1||i===_alertPages||Math.abs(i-alertPage)<=2) nums+=`<button class="${i===alertPage?'active':''}" data-pg="${i}">${i}</button>`;
      else if(Math.abs(i-alertPage)===3) nums+='<span class="pg-gap">…</span>';
    }
    el.innerHTML = `<span class="pg-info">${start}–${end} จาก ${total}</span>
      <div class="pg-btns">
        <button data-pg="prev" ${alertPage===1?'disabled':''}>‹</button>${nums}<button data-pg="next" ${alertPage===_alertPages?'disabled':''}>›</button>
      </div>`;
  }
  function renderAlerts(){
    renderAlertFilter(); renderAlertPeriod();
    const el = $('alertFeed'); if(!el) return;
    const q = alertSearch.trim().toLowerCase();
    const rows = ALARM_HITS.filter(h => (alertFilter==='all'||h.group===alertFilter) && _alertInPeriod(h.ts)
      && (!q || (h.plate+' '+h.region+' '+h.note).toLowerCase().includes(q)));
    const cnt = $('alertCount'); if(cnt) cnt.textContent = `${rows.length} รายการ`;
    _alertPages = Math.max(1, Math.ceil(rows.length/ALERT_PER));
    if(alertPage>_alertPages) alertPage=_alertPages;
    if(!rows.length){ el.innerHTML = `<div class="alarm-empty" style="padding:30px">ไม่พบการแจ้งเตือนตามเงื่อนไข</div>`; renderAlertPager(0); return; }
    const pageRows = rows.slice((alertPage-1)*ALERT_PER, alertPage*ALERT_PER);
    el.innerHTML = pageRows.map(h=>{ const g=groupById(h.group)||{name:'',color:'#888'}; const idx=ALARM_HITS.indexOf(h); const acked=!!h._ackBy;
      return `<div class="alert-row${h.group==='warrant'?' urgent':''}" style="--gc:${g.color}${acked?';opacity:.45':''}" data-alert="${idx}">
        <div class="alert-thumb">${alarmPlaque(h)}</div>
        <div class="alert-body">
          <div class="alert-l1"><span class="alert-badge" style="background:${g.color}">${g.name}</span><span class="alert-plate">${h.plate}</span></div>
          <div class="alert-l2">${[h.region, vtypeLabel(h.vtype), h.cam].filter(Boolean).join(' · ')}</div>
          ${h.note?`<div class="alert-note">${h.note}</div>`:''}
        </div>
        <div class="alert-side"><div class="alert-time">${h.timeStr}</div><button class="alert-ack" data-ack ${acked?'disabled':''}>${acked?'รับทราบแล้ว':'รับทราบ'}</button></div>
      </div>`;
    }).join('');
    renderAlertPager(rows.length);
  }
  // detail popup — dedicated #alertModal: captured (left) vs reference (right)
  // side-by-side compare, data grid, note at bottom, acknowledge button.
  // prod: reference image = arrest-warrant photo uploaded to lpr_watchlist;
  // ack = depend on logged-in user (recorded server-side).
  const DEMO_USER = 'Dojo-mAn';                 // prod: current logged-in operator
  let _alertCur = null;                          // hit being viewed (for toggle re-render)
  function alertRefBox(h){
    if(!h.ref) return `<div class="am-ref-empty">ยังไม่มีรูปอ้างอิง<br><small>ผู้แจ้งยังไม่อัปโหลดภาพจากหมายจับ</small></div>`;
    const g = groupById(h.group)||{color:'#888'};
    return `<div class="am-ref-doc" style="--gc:${g.color}">
      <div class="am-ref-veh">${vehicleSvg(h)}</div>
      <div class="am-ref-tag">${h.plate}</div>
      <div class="am-ref-cap">ภาพแนบจากหมายจับ · อัปโหลดโดยผู้แจ้ง</div></div>`;
  }
  function renderAlertMedia(h){
    const gone = $('amSimDeleted') && $('amSimDeleted').checked;
    $('amCaptured').innerHTML = gone ? sceneGone(h)
      : `<div class="lm-scenebox">Snapshot ขนาดเต็ม<br><small>${h.cam} · ${h.timeStr}</small></div>`;
    $('amReal').innerHTML = gone ? realGone(h)
      : `<div class="lm-realcrop">ภาพป้ายจริงจากกล้อง<br><small>${h.prov} ${h.num}</small></div>`;
    $('amPlaque').innerHTML = plaqueHtml(h, true, true);
    $('amRef').innerHTML = alertRefBox(h);
  }
  function openLightbox(html){ $('ilInner').innerHTML = html; $('imgLightbox').style.display = 'flex'; }
  function openAlertModal(h){
    _alertCur = h; _modalOpen = true;
    const g = groupById(h.group)||{name:'',color:'#888'};
    $('amBadge').textContent = g.name; $('amBadge').style.background = g.color;
    $('amPlate').textContent = h.plate;
    $('amTime').textContent = h.timeStr;
    if($('amSimDeleted')) $('amSimDeleted').checked = false;
    renderAlertMedia(h);
    const dot = h.vcolor.hex ? `<span class="cdot" style="background:${h.vcolor.hex}"></span>` : '';
    const rows = [
      ['ตรงเฝ้าระวัง', `<span class="alert-badge" style="background:${g.color}">${g.name}</span>`],
      ['โหมดจับคู่', h.mode==='plate_region' ? 'ป้าย + จังหวัด (ตรงทั้งคู่)' : 'ป้ายอย่างเดียว'],
      ['จังหวัด', h.region],
      ['ประเภทรถ', vtypeLabel(h.vtype)],
      ['สีรถ', `${dot}${h.vcolor.th}`],
      ['เลน', h.lane],
      ['ความมั่นใจ', h.conf + '%'],
      ['กล้อง', h.cam],
      ['เวลา', h.timeStr],
    ];
    $('amData').innerHTML = rows.map(([k,v])=>`<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join('');
    $('amNote').innerHTML = `<span class="am-note-k">หมายเหตุ / หมายจับ</span><span class="am-note-v">${h.note || '—'}</span>`;
    // acknowledge state
    const ack = $('amAck'), log = $('amAckLog');
    if(h._ackBy){ ack.disabled = true; ack.textContent = 'รับทราบแล้ว';
      log.textContent = `รับทราบโดย ${h._ackBy} · ${h._ackAt}`; }
    else { ack.disabled = false; ack.textContent = 'รับทราบ'; log.textContent = ''; }
    $('alertModal').style.display = 'flex';
  }
  function closeAlertModal(){ _modalOpen = false; _alertCur = null; $('alertModal').style.display = 'none'; }
  function ackAlert(){
    const h = _alertCur; if(!h || h._ackBy) return;
    const now = new Date();
    h._ackBy = DEMO_USER;
    h._ackAt = `${_pad(now.getHours())}:${_pad(now.getMinutes())}`;
    $('amAck').disabled = true; $('amAck').textContent = 'รับทราบแล้ว';
    $('amAckLog').textContent = `รับทราบโดย ${h._ackBy} · ${h._ackAt}`;
    renderAlerts();                              // reflect acked state in the list
  }
  function renderAlertBadge(){
    const b = $('alertTabBadge'); if(!b) return;
    const today = ALARM_HITS.filter(h=>h.ts.toDateString()===_NOW.toDateString()).length;
    b.textContent = today; b.style.display = today ? '' : 'none';
  }
  function gotoAlertsTab(){
    document.querySelectorAll('#lprTabBar .tab').forEach(x=>x.classList.remove('active'));
    document.querySelector('#lprTabBar .tab[data-tab="alerts"]').classList.add('active');
    ['overview','alerts','search','watchlist','settings'].forEach(n=>{ $('tab-'+n).style.display = n==='alerts' ? '' : 'none'; });
    alertPage=1; renderAlerts();
  }

  function renderWGroupBar(){
    const counts = WL.reduce((m,w)=>{ m[w.group]=(m[w.group]||0)+1; return m; }, {});
    const all = el('div');
    let html = `<span class="wl-gchip ${wlFilter==='all'?'active':''}" data-wg="all" ${wlFilter==='all'?'style="background:var(--accent)"':''}>ทั้งหมด <b>${WL.length}</b></span>`;
    html += WGROUPS.map(g=>`<span class="wl-gchip ${wlFilter===g.id?'active':''}" data-wg="${g.id}" ${wlFilter===g.id?`style="background:${g.color};border-color:${g.color}"`:''}>
      <span class="wl-gdot" style="background:${g.color}"></span>${g.name} <b>${counts[g.id]||0}</b></span>`).join('');
    html += `<span class="wl-gchip" data-wg="__add" style="border-style:dashed">+ เพิ่มกลุ่ม</span>`;
    $('wlGroupBar').innerHTML = html;
  }
  function renderWL(){
    renderWGroupBar();
    const rows = WL.filter(w=>wlFilter==='all'||w.group===wlFilter);
    $('wlList').innerHTML = rows.length ? rows.map((w)=>{
      const g = groupById(w.group) || {name:w.group,color:'#888'};
      const i = WL.indexOf(w);
      const modeTxt = w.mode==='plate_region' ? 'ป้าย + จังหวัด' : 'ป้ายอย่างเดียว';
      return `<div class="wl-row">
        <div class="wl-ref">${w.img?'รูป':'—'}</div>
        <span class="wl-plate">${w.plate}</span>
        <div class="wl-info">
          <div class="l1">
            <span class="wl-badge" style="background:${g.color};color:#fff">${g.name}</span>
            <span class="wl-mode">จับคู่: ${modeTxt}</span>
            ${w.region?`<span class="wl-mode">${w.region}</span>`:''}
            ${w.instant?'<span class="wl-mode" style="border-color:var(--status-bad);color:var(--status-bad)">LINE ทันที</span>':''}
          </div>
          <div class="note">${w.note||''}</div>
        </div>
        <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;color:var(--status-bad)" data-wl-del="${i}">ลบ</button>
      </div>`;
    }).join('') : '<div style="color:var(--text-secondary);font-size:13px;padding:10px 0">ไม่มีรายการในกลุ่มนี้</div>';
  }
  function wlAdd(){
    const p = $('wlPlate').value.trim(); if(!p){ $('wlPlate').focus(); return; }
    WL.unshift({ plate:p.toUpperCase(), region:$('wlRegion').value, group:$('wlGroup').value,
      mode:$('wlMode').value, note:$('wlNote').value.trim(), img:false, instant:$('wlInstant').checked });
    $('wlPlate').value=''; $('wlNote').value=''; renderWL();
  }

  // ───────── Settings (ตั้งค่าระบบป้ายทะเบียน) — items 2, 3 ─────────
  // renders the per-camera direction assignment list (id kept as 'gateList')
  function renderGates(){
    $('gateList').innerHTML = LPR_CAMS.map(c=>`
      <div class="lane-rule">
        <span class="lane-name">${c.name} <small style="color:var(--text-secondary);font-weight:400">${c.id}</small></span>
        <div class="seg sm" data-dirseg="${c.id}">
          <button data-v="in"   class="${c.dir==='in'?'active':''}">ขาเข้า</button>
          <button data-v="out"  class="${c.dir==='out'?'active':''}">ขาออก</button>
          <button data-v="none" class="${c.dir==='none'?'active':''}">ไม่กำหนด</button>
        </div>
      </div>`).join('');
  }
  function renderVTypes(){
    $('vtypeList').innerHTML = VTYPES.map(v=>`
      <div class="vtype-row">
        <input type="checkbox" data-vton="${v.code}" ${v.on?'checked':''}>
        <span class="code">${v.code}</span>
        <input class="form-input" value="${v.th}" data-vtth="${v.code}">
        <span class="vtype-count">${v.n} รายการ</span>
      </div>`).join('');
  }
  // populates the search-tab camera filter (cosmetic) from LPR_CAMS
  function refreshGateSelectors(){
    $('fGate').innerHTML = `<option value="">ทั้งหมด</option>` + LPR_CAMS.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  }

  // ───────── filters / selects ─────────
  function opt(v, label){ return `<option value="${v}">${label}</option>`; }
  function fillSearchSelects(){
    $('fCam').innerHTML = opt('','ทั้งหมด') + CAMS.map(c=>opt(c,c)).join('');
    $('fRegion').innerHTML = opt('','ทั้งหมด') + opt('ไม่ทราบ','ไม่ทราบ') + PROVINCES.map(p=>opt(p,p)).join('');
    $('fType').innerHTML = opt('','ทั้งหมด') + VTYPES.map(v=>opt(v.code, v.th)).join('') + opt('__null','ไม่ทราบ');
    $('fVColor').innerHTML = opt('','ทั้งหมด') + VCOLORS.map(c=>opt(c.code, c.th)).join('');
    $('fPColor').innerHTML = opt('','ทั้งหมด') + PCOLORS.map(c=>opt(c.code, c.th)).join('');
    $('fLane').innerHTML = opt('','ทั้งหมด') + LANES.map(l=>opt(l,'เลน '+l)).join('');
  }
  function fillWatchlistSelects(){
    $('wlRegion').innerHTML = opt('','— ไม่ระบุ —') + opt('ไม่ทราบ','ไม่ทราบ') + PROVINCES.map(p=>opt(p,p)).join('');
    $('wlGroup').innerHTML = WGROUPS.map(g=>opt(g.id, g.name)).join('');
  }
  function resetSearch(){ ['fPlate','fCam','fRegion','fType','fVColor','fPColor','fHasPlate','fLane','fGate','fFrom','fTo'].forEach(id=>{ if($(id)) $(id).value=''; }); }

  // ───────── pickers ─────────
  const ADP_TH = { days:['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'],
    daysShort:['อา','จ','อ','พ','พฤ','ศ','ส'], daysMin:['อา','จ','อ','พ','พฤ','ศ','ส'],
    months:['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
    monthsShort:['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
    today:'วันนี้', clear:'ล้าง', dateFormat:'dd/MM/yyyy', timeFormat:'HH:mm', firstDay:0 };
  function initPickers(){
    if (typeof AirDatepicker === 'undefined') return;
    const opts = { locale:ADP_TH, timepicker:true, dateFormat:'dd/MM/yyyy', timeFormat:'HH:mm',
      isMobile: window.innerWidth<=768, position:'bottom left' };
    ['fFrom','fTo','pFrom','pTo'].forEach(id=>{ if($(id)) new AirDatepicker($(id), opts); });
  }

  function toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme');
    if (cur === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme','light');
    renderCharts();
  }

  // ───────── bindings ─────────
  $('lprTabBar').addEventListener('click', e=>{
    const b = e.target.closest('.tab[data-tab]'); if(!b) return;
    document.querySelectorAll('#lprTabBar .tab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const t = b.dataset.tab;
    ['overview','alerts','search','watchlist','settings'].forEach(n=>{ $('tab-'+n).style.display = n===t ? '' : 'none'; });
    if(t==='alerts') renderAlerts();
  });
  $('alarmBlock').addEventListener('click', e=>{ if(e.target.closest('[data-goto-alerts]')) gotoAlertsTab(); });
  $('alertFilterBar').addEventListener('click', e=>{ const b=e.target.closest('button[data-af]'); if(!b) return; alertFilter=b.dataset.af; alertPage=1; renderAlerts(); });
  $('alertPeriodBar').addEventListener('click', e=>{ const b=e.target.closest('button[data-ap]'); if(!b) return; alertPeriod=b.dataset.ap; alertPage=1; renderAlerts(); });
  let _alSearchT; $('alertSearch').addEventListener('input', e=>{ alertSearch=e.target.value; alertPage=1; clearTimeout(_alSearchT); _alSearchT=setTimeout(renderAlerts,200); });
  $('alertPager').addEventListener('click', e=>{
    const b=e.target.closest('button[data-pg]'); if(!b||b.disabled) return;
    const v=b.dataset.pg;
    alertPage = v==='prev' ? Math.max(1,alertPage-1) : v==='next' ? Math.min(_alertPages,alertPage+1) : +v;
    renderAlerts();
    $('alertFeed').scrollIntoView({block:'start',behavior:'smooth'});
  });
  $('alertFeed').addEventListener('click', e=>{
    const a=e.target.closest('.alert-ack');
    if(a){ e.stopPropagation(); const row=a.closest('.alert-row[data-alert]'); const h=ALARM_HITS[+row.dataset.alert];
      const now=new Date(); h._ackBy=DEMO_USER; h._ackAt=`${_pad(now.getHours())}:${_pad(now.getMinutes())}`;
      row.style.opacity='.45'; a.textContent='รับทราบแล้ว'; a.disabled=true; return; }
    const row=e.target.closest('.alert-row[data-alert]'); if(row) openAlertModal(ALARM_HITS[+row.dataset.alert]);
  });
  $('alertModalX').addEventListener('click', closeAlertModal);
  // NO backdrop click-close — only the X button closes (per spec)
  { const sd=$('amSimDeleted'); if(sd) sd.addEventListener('change', ()=>{ if(_alertCur) renderAlertMedia(_alertCur); }); }
  $('amAck').addEventListener('click', ackAlert);
  $('amViewFull').addEventListener('click', ()=>{ if(_alertCur) openLightbox($('amCaptured').innerHTML); });
  $('amViewRef').addEventListener('click', ()=>{ if(_alertCur) openLightbox($('amRef').innerHTML); });
  $('imgLightbox').addEventListener('click', ()=>{ $('imgLightbox').style.display='none'; });
  $('periodBar').addEventListener('click', e=>{
    const b = e.target.closest('button[data-p]'); if(!b) return;
    document.querySelectorAll('#periodBar button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); period = b.dataset.p;
    $('customRange').style.display = period==='custom' ? '' : 'none';
    renderKpi(); renderCharts();
  });
  function cardClick(e){
    const c = e.target.closest('.lpr-card[data-src]'); if(!c) return;
    const arr = c.dataset.src === 'latest' ? LATEST : RESULTS;
    const r = arr[+c.dataset.idx]; if (r) openModal(r);
  }
  $('latestGrid').addEventListener('click', cardClick);
  $('searchGrid').addEventListener('click', cardClick);
  $('lprModalX').addEventListener('click', closeModal);
  { const sd = $('lmSimDeleted'); if (sd) sd.addEventListener('change', ()=>{ if (_lastModalR) renderModalMedia(_lastModalR); }); }  // RF4 demo: toggle deleted-image state
  $('lprModal').addEventListener('click', e=>{ if(e.target.id==='lprModal') closeModal(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
  $('btnTheme').addEventListener('click', toggleTheme);
  $('btnSearch').addEventListener('click', ()=>{});
  $('btnReset').addEventListener('click', resetSearch);
  $('btnWlAdd').addEventListener('click', wlAdd);
  $('wlGroupBar').addEventListener('click', e=>{
    const c = e.target.closest('[data-wg]'); if(!c) return;
    const id = c.dataset.wg;
    if (id==='__add'){ const name = prompt('ชื่อกลุ่มเฝ้าระวังใหม่'); if(name){ const gid='g'+Date.now(); WGROUPS.push({id:gid,name,color:'#5b8def'}); fillWatchlistSelects(); renderWL(); } return; }
    wlFilter = id; renderWL();
  });
  $('wlList').addEventListener('click', e=>{
    const dl = e.target.closest('[data-wl-del]'); if(dl){ WL.splice(+dl.dataset.wlDel,1); renderWL(); }
  });
  $('gateList').addEventListener('click', e=>{
    const seg = e.target.closest('[data-dirseg] button');
    if (seg){ const id = seg.parentElement.dataset.dirseg; const c = LPR_CAMS.find(x=>x.id===id);
      if (c){ c.dir = seg.dataset.v; renderGates(); renderCharts(); } }
  });
  $('vtypeList').addEventListener('change', e=>{
    const cb = e.target.closest('[data-vton]'); if(cb){ VTYPES.find(v=>v.code===cb.dataset.vton).on=cb.checked; renderCharts(); }
  });
  $('vtypeList').addEventListener('input', e=>{
    const nm = e.target.closest('[data-vtth]'); if(nm){ VTYPES.find(v=>v.code===nm.dataset.vtth).th=nm.value; }
  });

  // ───────── init ─────────
  fillSearchSelects(); fillWatchlistSelects(); refreshGateSelectors();
  initPickers();
  renderKpi(); renderCards(); renderCharts();
  renderWL(); renderGates(); renderVTypes();
  renderAlarmStrip(); renderAlertBadge();
  setInterval(tickRefresh, 3000);
})();
