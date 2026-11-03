// ============================================================
// Vigil Platform — LPR Gallery Page
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

// ============================================================
// LPR / ANPR Gallery — card grid of license plate captures
// ============================================================
// Hikvision vehicleLogoRecog numeric ID → brand name (from official ANPR SDK mapping table)
var _LPR_BRAND = {
  "0":"ไม่ทราบ",
  "1024":"Others","1025":"AC Schnitzer","1026":"Alfa Romeo","1027":"Aston Martin","1028":"AUDI","1029":"La Joya","1030":"PORSCHE","1031":"Buick","1032":"BAIC","1033":"BAW",
  "1034":"BAIC Weiwang","1035":"BAIC Yinxiang","1036":"BENZ","1037":"BMW","1038":"Baojun","1039":"Baolong","1040":"BENTLEY","1041":"Brabus","1042":"BUGATTI","1043":"HONDA",
  "1044":"PEUGEOT","1045":"BYD","1046":"Changhe","1047":"Changfeng Leopaard","1048":"Changcheng","1049":"Changan Saloon","1050":"DS","1051":"SOUTHEAST","1053":"Volkswagen","1054":"DADI",
  "1055":"Detroit Electric","1056":"DODGE","1057":"Dadi","1059":"Dafa","1060":"TOYOTA","1061":"Fuqi","1062":"FORMASARI","1063":"FERRARI","1064":"FORD","1066":"FODAY",
  "1067":"FIAT","1068":"Fisker","1069":"Mitsuoka","1070":"Mercury","1071":"Trumpchi","1073":"Guangsheng","1074":"Qoros","1075":"Huabei","1076":"Huapu","1077":"Huatai",
  "1078":"Huafei","1079":"HUMMER","1080":"Haima","1081":"Hongqi","1083":"GEELY","1084":"JEEP","1085":"JAGUAR","1086":"Jiangnan","1088":"CHRYSLER","1089":"CADILLAC",
  "1090":"CARISSON","1091":"KANDI","1092":"KOENIGSEGG","1093":"Lamborghini","1094":"Lifan","1095":"Rolls-Royce","1096":"Lincoln","1097":"Linian","1098":"LOTUS","1099":"Lancia",
  "1100":"Lotus","1101":"LAND ROVER","1102":"SUZUKI","1103":"LAND WIND","1104":"LEXUS","1105":"RENAULT","1106":"MG","1107":"MINI","1108":"MASERATI","1109":"Meiya",
  "1110":"McLaren","1111":"Maybach","1112":"Mazda","1113":"Morgan","1114":"LUXGEN","1115":"Nanjing Jinlong","1116":"OPEL","1117":"ACURA","1118":"PGO","1119":"Venucia",
  "1120":"CHERY","1121":"KIA","1122":"Qiantu","1123":"Nissan","1124":"RIICH","1125":"ROEWE","1126":"RUF","1127":"SMART","1128":"Mitsubishi","1129":"MAXUS",
  "1130":"SPYKER","1131":"Shuanghuan","1132":"Shuanglong","1133":"SUBARU","1134":"SKODA","1135":"SAAB","1136":"CIIMO","1137":"STARTECH","1138":"Tianma","1139":"Tesla",
  "1140":"TechArt","1141":"Denza","1142":"Wiesmann","1143":"Rely","1144":"VOLVO","1145":"Weichai Enranger","1146":"Xinkai","1147":"Xin Da Di","1148":"SOYAT","1149":"Hyundai",
  "1150":"SEAT","1151":"CHEVROLET","1152":"CITROEN","1154":"Jonway","1155":"Eterniti","1156":"Infiniti","1157":"MUSTANG","1158":"Youxia","1159":"Yogomo","1160":"Zhongxing",
  "1161":"Zhonghua","1162":"ZK Huabei","1163":"ZOTYE","1164":"Zhidou","1165":"Kaiyi","1166":"Huasong","1167":"Isuzu","1168":"Borgward","1169":"Tongjia","1170":"Hanjiang",
  "1171":"Zhinuo","1172":"GreenWheel","1173":"Hanteng","1174":"LEVDEO","1175":"Changjiang","1176":"SWM","1177":"FQT Motor","1178":"QOROS","1179":"JMC","1180":"BISU",
  "1181":"CAKY","1182":"Haima","1183":"Ourui","1537":"Ankai","1538":"Ayvip","1539":"Beijing Nongyong","1540":"Beiben","1541":"NORTH Bus","1544":"Balong","1546":"Succeeded",
  "1547":"Changlong","1548":"Chunlan Motor","1549":"Changan Commercial","1552":"Dongfeng","1554":"Daewoo","1555":"Dayun","1556":"Dima","1557":"Dongwo","1559":"FOTON","1561":"GMC",
  "1562":"GAC GONOW","1563":"Hino Light Truck","1564":"Hino Heavy Truck","1566":"CAMC","1568":"CHTC","1569":"Hentong Bus","1570":"Huizhong","1571":"Higer","1573":"Haiou","1574":"Hangtian Yuantong",
  "1575":"SPACE AUTO","1576":"Huanghai","1577":"Heibao","1578":"Jiulong","1579":"JAC","1580":"Jianghuan","1581":"JMC","1582":"JMC","1583":"GOLDEN DRAGON","1584":"Jinbei",
  "1585":"KING LONG","1586":"Kama","1587":"Kawei","1588":"Karry","1590":"UAES","1592":"MAN","1594":"Agricultural Vehicle","1595":"NAVECO","1596":"Nanjun","1597":"Isuzu",
  "1598":"Youngman Bus","1599":"Sany Heavy Industry","1600":"Tri-Ring Shitong","1602":"Tricycle","1603":"Hongyan","1604":"Shangrao Bus","1605":"Shili Bus","1606":"Shaolin Bus","1607":"Forland","1608":"Shifeng",
  "1609":"SUNWIN","1610":"Shenlong","1611":"Shenye","1612":"Shuchi Bus","1613":"Shaanxi Auto","1614":"Scania","1615":"Tangjun","1616":"Taihu Bus","1618":"Tongxin Bus","1619":"Wanfeng",
  "1620":"Wuzheng","1621":"SGMW","1622":"Wuyi","1624":"Wuhuan","1626":"Xugong","1629":"FAW","1630":"Yaxing","1631":"Iveco","1632":"Youyi Bus","1633":"Yutong",
  "1634":"Yangzi","1635":"Yantai","1636":"Yuejin","1637":"Yingtian","1639":"CNHTC","1641":"Zhongtong Bus","1642":"Polarsun Motor","1643":"CDW","1644":"Zonda","1645":"Zonda",
  "1646":"Jinggong Heavy Truck","1647":"Wu Zhou Long","1648":"Bus","1649":"Light Truck","1650":"Heavy Truck","1651":"Pickup Truck","1652":"Mudan","1653":"Chufeng Motor","1654":"Jijiang","1655":"SAIC Yizheng",
  "1656":"Yuexi","1657":"Shenma","1658":"Jiangxi Xiaofang","1659":"Shunfeng","1660":"Hengshan","1674":"Dong Fang Hong Motor","1675":"NEOPLAN","1676":"Qingqi","1677":"Truck","1678":"Special Vehicle",
  "1679":"Trailer","1681":"Wanda Bus","1682":"Chang'an Suzuki","1683":"Guilin","1684":"Sichuan Hyundai","1685":"Aochi","1686":"Denway Bus","1687":"FAW-Liut","1688":"Wanxiang","1690":"Sojen",
  "1691":"Changan","1692":"Zoomlion","1693":"Yinlong","1694":"Jiachuan Auto","1695":"Yixing","1697":"Yangtse","1698":"Suitong","1701":"Qingdao Jiefang","1702":"ZTRV","1703":"Wanda",
  "1704":"Shangrao","1705":"ZEV","1706":"EVCRRC","1707":"Zhongtong","1708":"Gonglu Bus","1709":"BAIC","1710":"Beifang","1711":"Neoplan","1712":"Huachuan","1713":"Youyi",
  "1714":"Tongxin","1715":"MG","1716":"Jiachuan","1717":"Nvshen","1718":"Shili","1719":"Shaolin","1720":"Chuanjiao","1721":"Chuanma","1722":"GAC","1723":"Hino",
  "1724":"Kandi","1725":"CHTC","1726":"Hentong","1727":"Forta","1728":"NLM","1729":"Chunlan","1730":"Chufeng","1731":"JMMC","1732":"JMC","1733":"Seagull",
  "1734":"Mudan","1735":"Liebao","1736":"Shenlong","1737":"FORLAND","1738":"Hongxing","1739":"Shuchi","1740":"Shudu","1741":"Hengshan","1742":"Yuexi","1743":"Yuancheng",
  "1744":"Golden Dragon","1745":"Changan Oushang","1746":"YOUNGMAN","1747":"Lynk & Co","1748":"Feidie","1749":"Feichi","1750":"Lishan","1751":"Denway","1752":"Nanjing Auto",
  "1753":"Dahan","1754":"Chunzhou","1755":"Dearcc","1756":"Wanshan","1757":"Central Europe Benz RV","1758":"Yudo","1759":"Junma","1760":"Guojin","1761":"Weltmeiter","1762":"Ora",
  "1763":"NIO","1764":"Lada","1765":"JETOUR","1766":"FORO","1767":"HICOM","1768":"JAC","1769":"JEEP","1770":"Jeep","1771":"Perodua","1772":"UD",
  "1773":"Toyota","1774":"Toyota","1775":"Isuzu","1776":"Rohens","1777":"Beiben Heavy Truck","1778":"SSANG YONG","1779":"SSANG YONG","1780":"Haval","1781":"Daihatsu","1782":"Daewoo",
  "1783":"Proton","1784":"Proton","1785":"Proton","1786":"Emgrand","1787":"Hino","1788":"Unknown","1789":"KIA","1790":"KIA","1791":"KIA Borrego","1792":"Alfa",
  "1793":"Equus","1794":"Renault Samsung","1795":"Malaysia Unknown","1796":"Oushang","1797":"BONLUCK","1798":"Qiling","1799":"Wanxiang","1800":"SATE","1801":"FLM","1802":"SRMXinyuan",
  "1803":"Geometry","1804":"New Baojun","1805":"NETA","1806":"XPENG","1807":"JETTA","1808":"Leading Ideal","1809":"Baic Yunnan Ruili","1810":"RMarvel","1811":"GAC Group","1812":"SOL",
  "1813":"Maple","1814":"Celis","1815":"Expedition","1816":"LEAPMOTOR","1817":"HiPhi","1818":"Nissan","1819":"NOVAT","1820":"EXEED","1821":"AIWAYS","1822":"Fuda",
  "1823":"Hongqi","1824":"Skyworth","1825":"Beijing Hyundai","1826":"ZEDRIV","1827":"Guangzhou Honda","1828":"Ouling","1829":"Zhengzhou Nissan","1830":"Changan Lincoln","1831":"Changan Auto","1832":"FAW Linghe",
  "1833":"SGMW","1834":"Fxauto","1835":"BAIC Off-Road","1836":"Huachen Xinri","1837":"HYCAN","1838":"DORCEN","1839":"Dayun Motor","1840":"ISUZU","1841":"SITECH DEV","1842":"JAC",
  "1843":"Changan Kaicheng","1844":"Artega","1845":"Faralli Mazzanti","1846":"GTA","1847":"KTM","1848":"LUMMA","1849":"MINI Coupe","1850":"Noble","1851":"WEY","1852":"YAMAHA",
  "1853":"BEIJING","1854":"FAW-Xiali","1855":"Besturn","1856":"SAIC Tangshan Bus","1857":"SAIC MAXUS","1858":"SAIC Hongyan","1859":"CNHTC Wangpai","1860":"Toyota Crown","1861":"Leshi","1862":"PGO",
  "1863":"Lingbao","1864":"Lifan Junma","1865":"Lorinser","1866":"BAIC Ruixiang","1867":"NAC Changda","1868":"Geely Gleagle","1869":"Geely Emgrand","1870":"Geely Englon","1871":"Taihu","1872":"Lantu",
  "1873":"Pagani","1874":"Guangma","1875":"Hengrui Auto","1876":"Genesis","1877":"MAN","1878":"Ranz","1879":"Songsan","1880":"Polestar","1881":"ZEEKR","1882":"ARCFOX",
  "1883":"BYD Yuan","1884":"BYD Tang","1885":"BYD Song","1886":"BYD Han","1887":"BYD Qin","1888":"Bike","1889":"Weichai","1890":"Ford Mustang","1891":"Koenigsegg","1892":"Yulu",
  "1893":"SALEEN","1894":"MANSORY","1895":"Suda","1896":"Mustang EV","1897":"GWM Huaguan","1898":"LongRiverEV","1899":"IAT","1900":"Feifan","1901":"LinkTour","1902":"Feishen",
  "1903":"Qilu","1904":"Apollo","1905":"Caterham","1906":"Conquest","1907":"Dacia","1908":"Zenvo","1909":"BAICLITE","1910":"AUX","1911":"Proton","1912":"SEAT",
  "1913":"BLUECAR","1914":"NOMA","1915":"Suzuki","1916":"Tankar","1917":"Valle","1918":"VeiculoLongo","1919":"TATA","1920":"Ashok Leyland","1921":"Mahindra","1922":"Eicher",
  "1923":"BharatBenz","1924":"Force Motors","1925":"SML ISUZU","1926":"MAN Trucks","1927":"POCCO","1928":"ASTON MARTIN","1929":"YOGOMO","1930":"BAIC Huansu","1931":"Dongfeng Huashen","1932":"DMC",
  "1933":"Dongfeng Fengshen","1934":"CNHTC Haoman","1935":"DORCEN","1936":"Nanjun Bus","1937":"Hyundai Truck & Bus","1938":"SHACMAN Commercial","1939":"SHACMAN Light Truck","1940":"C&C Trucks","1941":"Horki","1942":"Oulang",
  "1943":"ASTON MARTIN","1944":"GWM Haval","1945":"SHACMAN Heavy Truck","1946":"Diandongwu","1947":"Dongfeng Liuqi Chenglong","1948":"GWM WEY","1950":"GAC AION","1951":"FAW Jiefang","1953":"Skyworth","1954":"Xinyuan",
  "1956":"Feifan","1957":"Dongfeng Fukang","1958":"Geely Jialong","1959":"Dongfeng Ruitaite","1960":"AC SCHNITZER","1961":"HENNESSEY","1962":"FAW Jilin","1963":"CNHTC Shandeka","1964":"FAW Hongta","1965":"Dongfeng Xiaokang",
  "1966":"FAW General Motors","1967":"Dongfeng Fengguang","1968":"FOTON ROWOR","1969":"Dongfeng Fengdu","1970":"FAW Jiefang Light Truck","1971":"SCION","1972":"Jijiang Bus","1973":"Smart","1974":"Beijing","1975":"AITO",
  "1976":"NETA","1977":"RADAR","1978":"Weltmeister","1979":"Dark Blue","1980":"IM","1981":"NEW GONOW","1982":"Ruilan","1983":"RADAR","1984":"DFPV","1985":"TANK",
  "1986":"Modern","1987":"Gleagle","1988":"Ruichi EV","1989":"AVATR","1990":"FUSO","1991":"Bedford","1992":"SOJEN","1993":"HONDA","1994":"BAIC BJEV","1995":"HINO",
  "1996":"MITSUBISHI","1997":"LEXUS","1998":"Chery New Energy","1999":"MAZDA","2000":"BMW","2001":"TESLA","2002":"TOYOTA","2003":"MERCEDES-BENZ","2004":"Geely Yinhe",
};

// ════════════════ Phase F redesign — overview / search / watchlist ════════════════

const _LPR_VTYPE = {
  twoWheelVehicle: 'จักรยานยนต์', motorcycle: 'จักรยานยนต์', motorbike: 'จักรยานยนต์',
  threeWheelVehicle: 'รถสามล้อ', SUVMPV: 'รถอเนกประสงค์ (SUV/MPV)', van: 'รถตู้',
  pickupTruck: 'รถกระบะ', truck: 'รถบรรทุก', vehicle: 'รถยนต์', car: 'รถยนต์',
  buggy: 'รถบรรทุกเล็ก', largeBus: 'รถบัส', bus: 'รถโดยสาร', pedestrian: 'คนเดินเท้า',
};
const _LPR_PCOLOR = { white:'ป้ายขาว (ส่วนบุคคล)', yellow:'ป้ายเหลือง (รับจ้าง)', green:'ป้ายเขียว', red:'ป้ายแดง (รถใหม่)', blue:'ป้ายน้ำเงิน', black:'ป้ายดำ', colorful:'ป้ายประมูล', orange:'ป้ายส้ม' };
const _LPR_PCOLOR_HEX = { white:'#f3f4ef', yellow:'#f2c200', green:'#1f7a3d', red:'#c62828', blue:'#1565c0', black:'#1a1a1a', colorful:'linear-gradient(135deg,#e53935,#fb8c00,#fdd835,#43a047,#1e88e5)', orange:'#e67e00' };
const _LPR_PROVINCES = ['กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','เบตง','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','พะเยา','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยะลา','ยโสธร','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อุดรธานี','อุทัยธานี','อุตรดิตถ์','อุบลราชธานี','อำนาจเจริญ'];

const _LPR_LIMIT = 50;
window._lprRows = [];
window._lprLatestRows = [];
let _lprPage = 1, _lprTotal = 0;
// P1 keyset — cursor cache keyed by page (index = page → {t,id} to fetch that page).
// Navigation is sequential (‹ ›), so cursors are always populated for reachable pages.
let _lprPageCursors = [null, null], _lprHasMore = false, _lprExact = true;
let _lprPeriod = 'today';
let _lprBound = false, _lprModalOpen = false, _lprCountExact = false;
let _lprCountSeq = 0, _lprSeen = 0, _lprCountPending = false, _lprCountKey = '';
let _lprLatestTopId = null, _lprTickTimer = null;
window._lprCharts = [];
var _lprWatchlistSet = new Set();

// Site filter — own state (not shared with Events/Snapshot/Media, and no
// group bar exists on this page to compose with). Watchlist tab is
// deliberately NOT scoped by this — a watched-plate registration isn't
// tied to a camera/site, only detections (Overview/Search/Alerts) are.
let _lprActiveSiteId = null;

function renderLprSitePills() {
  renderSitePills('lprSitePills', _lprActiveSiteId, 'setLprActiveSite');
}

function _lprSiteCameraIds() {
  if (!_lprActiveSiteId) return null;
  return cameras.filter(c => c.site_id === _lprActiveSiteId).map(c => c.camera_id);
}

// 🔴 helper ตัวนี้ถูกใช้ 7 จุด รวมทั้งหน้าภาพรวมและ endpoint ที่ยังไม่รู้จัก `sites`
//    เคยเปลี่ยนให้ส่ง `sites` แทน `cameras` ทั้งหมดแล้วหน้าภาพรวมหยุดกรอง Site ทันที
//    (เลือกหาดใหญ่แต่ได้ตัวเลขของทุก Site — 2026-08-17) · ค่าเริ่มต้นจึงต้องเป็น
//    `cameras` เหมือนเดิมเสมอ · ใครที่ยิงไป endpoint ซึ่งรองรับ `sites` แล้ว
//    (ตอนนี้มีแค่ /api/lpr) ค่อยขอแบบนั้นเป็นรายกรณี
function _lprApplySiteParam(params, opts) {
  if (opts && opts.preferSites) {
    const site = (typeof _sites !== 'undefined' && Array.isArray(_sites))
      ? _sites.find(x => x.id === _lprActiveSiteId) : null;
    if (site && site.code) { params.set('sites', site.code); return; }
  }
  const ids = _lprSiteCameraIds();
  if (ids) params.set('cameras', ids.length ? ids.join(',') : '__none__');
}

function setLprActiveSite(sid) {
  _lprActiveSiteId = sid ? Number(sid) : null;
  renderLprSitePills();
  _populateLprCameras();  // rescope the camera picker to the new site
  const ov = document.getElementById('lprTabOverview');
  const se = document.getElementById('lprTabSearch');
  const al = document.getElementById('lprTabAlerts');
  if (ov && ov.style.display !== 'none') lprLoadOverview();
  else if (se && se.style.display !== 'none') loadLpr(1);
  else if (al && al.style.display !== 'none') loadLprAlerts(1);
}
let _lprGroups = [];

const _t = (k, fb) => (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(k, fb) : fb;
const _tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const _esc = s => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);

// Thai plate: leading digit is part of the prefix, not the number ("7กธ5746" → "7กธ"/"5746")
function _lprParsePlate(p) {
  const s = String(p || '').trim();
  const m = s.match(/^(\d{0,2})\s*([฀-๿A-Za-z]+)\s*(\d+)$/);
  if (m) return { letters: (m[1] || '') + m[2], digits: m[3] };
  const letters = (s.match(/[฀-๿A-Za-z]+/g) || []).join(' ');
  const digits  = (s.match(/[0-9]+/g) || []).join('');
  return { letters, digits };
}
// RF4 — vehicle-type display config (Settings › LPR). Label override + visibility.
window._lprVtypeCfg = window._lprVtypeCfg || {};
async function _loadLprVtypeCfg() {
  try { const r = await fetch(`${API}/api/lpr/vehicle-types`); if (r.ok) window._lprVtypeCfg = (await r.json()) || {}; } catch {}
}
// migration 117 — bbox overlay toggles (Settings › LPR). Vehicle box ships
// opt-out (on by default); plate box + full-image burn-in ship opt-in (off
// by default) — owner request 2026-08-06. page-lpr-settings.js's save
// updates this same window global in place, so a save takes effect on the
// modal's next open without a page reload.
window._lprBboxCfg = window._lprBboxCfg || { vehicle: true, plate: false, fullImage: false };
async function _loadLprBboxCfg() {
  try {
    const r = await fetch(`${API}/api/settings`);
    if (!r.ok) return;
    const st = await r.json();
    window._lprBboxCfg = {
      vehicle:   st.lpr_bbox_vehicle_enabled    ? st.lpr_bbox_vehicle_enabled.value    === '1' : true,
      plate:     st.lpr_bbox_plate_enabled      ? st.lpr_bbox_plate_enabled.value      === '1' : false,
      fullImage: st.lpr_bbox_full_image_enabled ? st.lpr_bbox_full_image_enabled.value === '1' : false,
    };
  } catch {}
}
// 0-1000 normalized grid — shared bail for both the plate and vehicle boxes.
function _lprBboxInRange(x, y, w, h) {
  return w > 0 && h > 0 && x >= 0 && y >= 0 && (x + w) <= 1000 && (y + h) <= 1000;
}
// ครอบตัดกล่องหนึ่งกล่อง (พิกัดต่อพัน) ออกจากรูปเต็ม
//
// เปอร์เซ็นต์ของ background-position อ้างกับ "กล่อง ลบ รูป" ทั้งคู่ สูตร x/(1-w)
// จึงเลื่อนจุดที่ต้องการมาให้พอดีกรอบทุกความละเอียด — ไม่ต้องรู้ขนาด px ของไฟล์
// (สำคัญ เพราะภาพฉากถูกเสิร์ฟผ่าน ?w= ซึ่งเปลี่ยนค่าได้)
//
// 🔴 สองกับดักที่เจอตอนทดสอบจริง (2026-09-09):
//   1) ต้องเป็น url('…') ฟันหนู **เดี่ยว** เท่านั้น — ค่านี้ไปอยู่ใน style="…"
//      ฟันหนูคู่ข้างในจะปิด attribute กลางทาง แล้วกรอบก็ว่างเปล่าเงียบ ๆ
//   2) background-size เป็น % ของ "กรอบ" ไม่ใช่ของรูป ⇒ ถ้าสัดส่วนกล่องที่ครอบ
//      ไม่เท่ากรอบ รถจะถูกยืด · จึงขยายกล่องที่ครอบให้ได้สัดส่วนเท่ากรอบก่อน
//      (ขยาย = ได้ฉากรอบตัวรถติดมาด้วย ซึ่งช่วยให้ดูออกว่าอยู่ตรงไหนของถนน)
// ใช้เมื่อวัดกรอบจริงไม่ได้เท่านั้น (กรอบยังไม่ถูกแสดง = clientWidth เป็น 0)
const LPR_CROP_AR = 4 / 3;
function _lprCropStyle(url, box, imgAR, tileAR) {
  let [fx, fy, fw, fh] = box.map(v => v / 1000);
  const cropAR = (fw / fh) * imgAR;
  const grow = (pos, len, want) => {
    const d = Math.min(want, 1) - len;                     // เกิน 1 = ทั้งภาพ
    return [Math.max(0, Math.min(1 - Math.min(want, 1), pos - d / 2)), Math.min(want, 1)];
  };
  if (cropAR < tileAR) [fx, fw] = grow(fx, fw, tileAR * fh / imgAR);
  else                 [fy, fh] = grow(fy, fh, fw * imgAR / tileAR);
  const pos = (v, f) => (f >= 1 ? 50 : v / (1 - f) * 100);
  return `background-image:url('${url}');background-size:${100 / fw}% ${100 / fh}%;`
       + `background-position:${pos(fx, fw)}% ${pos(fy, fh)}%`;
}
function _lprVtypeVisible(code) {
  const c = window._lprVtypeCfg[code] || window._lprVtypeCfg[String(code).toLowerCase()];
  return !c || c.on !== false;   // default visible
}
function _lprVType(raw) {
  if (!raw) return '';
  const c = window._lprVtypeCfg[raw] || window._lprVtypeCfg[String(raw).toLowerCase()];
  if (c && c.label) return c.label;
  const key = _LPR_VTYPE[raw] ? raw : (_LPR_VTYPE[String(raw).toLowerCase()] ? String(raw).toLowerCase() : null);
  return key ? _t('lpr.vtype.' + key, _LPR_VTYPE[key]) : raw;
}
function _lprBrandLabel(raw) {
  if (!raw) return '';
  if (String(raw) === '0') return _t('lpr.unknown', 'ไม่ทราบ');
  return _LPR_BRAND[String(raw)] || String(raw);
}

function _lprColorBg(name) {
  if (!name) return null;
  const key = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return (typeof _colorBgByName === 'function') ? _colorBgByName(key) : null;
}
function _lprColorDot(name) {
  const bg = _lprColorBg(name);
  if (!bg) return '';
  return `<span class="cdot" style="background:${bg}"></span>`;
}
function _lprColorLang(name) {
  if (!name || String(name).toLowerCase() === 'unknown') return _t('lpr.unknown', 'ไม่ทราบ');
  const key = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'th';
  return (typeof _APP_COLOR !== 'undefined' && _APP_COLOR[key] && _APP_COLOR[key][lang]) || key;
}
// Plate (DLT) colour label — unknown/empty → "ไม่ทราบ" (attribute unknown, not no-read; cf. #208)
function _lprPColorLabel(pc) {
  if (!pc || String(pc).toLowerCase() === 'unknown') return _t('lpr.unknown', 'ไม่ทราบ');
  return _LPR_PCOLOR[pc] ? _t('lpr.pcolor.' + pc, _LPR_PCOLOR[pc]) : pc;
}
function _lprFmtTime(t) {
  const d = new Date(t);
  return d.toLocaleString('th-TH', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// HH:MM only, no date — for the Overview hit-strip's narrow .alarm-time column
// only (mirrors the Face page's own inline formatter for the same card type).
// _lprFmtTime's full date+time stays everywhere else (alert feed, detail
// modals) where reviewing an older case benefits from seeing the date.
function _lprFmtTimeShort(t) {
  return new Date(t).toLocaleString('th-TH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

// ── Page init + tab switching ──────────────────────────────────────
function _lprInitPage() {
  _initLprFilters();
  _loadGroups(() => fillWatchlistSelects());
  // Enhance the 4 LPR datetime inputs with AirDatepicker (project standard; native
  // type=text inputs are listed in _DT_DATETIME_IDS). Idempotent: skips already-bound.
  if (typeof initDateTimePickers === 'function') initDateTimePickers();
  // These date inputs sit at the right edge of the filter grid, so the default
  // 'bottom left' popup overflows the viewport → align to the input's right edge
  // (opens leftward). Period pickers also re-run the overview on pick.
  ['lprFilterFrom', 'lprFilterTo', 'lprPeriodFrom', 'lprPeriodTo', 'lprNoReadFrom', 'lprNoReadTo'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || !el._adp || el._lprAdpTuned) return;
    el._lprAdpTuned = true;
    const isPeriod = id.startsWith('lprPeriod');
    el._adp.update({ position: 'bottom right', ...(isPeriod ? { onSelect: () => lprApplyPeriod() } : {}) });
  });
  if (!_lprBound) {
    _lprBound = true;
    const pb = document.getElementById('lprPeriodBar');
    if (pb) pb.addEventListener('click', e => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      pb.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); _lprPeriod = b.dataset.p;
      const cr = document.getElementById('lprCustomRange');
      if (cr) cr.style.display = _lprPeriod === 'custom' ? '' : 'none';
      if (_lprPeriod !== 'custom') lprLoadOverview();
    });
    // camera MultiPicker → re-run search (replaces the old select's data-change="lprSearch")
    document.getElementById('lprTabSearch')?.addEventListener('mp:change', () => _lprSearchDebounce());
    document.getElementById('lprTabNoRead')?.addEventListener('mp:change', () => loadLprNoRead(1));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      // Front to back: the detail modal sits on top of the list, so one Escape
      // should close the one the operator is actually looking at.
      if (_lprModalOpen) { _lprCloseModal(); lprCloseAlert(); return; }
      if (document.getElementById('lprAlarmListModal')?.style.display === 'flex') lprCloseAlarmList();
    });
    // modal backdrop click (X button is delegated via data-action)
    const modal = document.getElementById('lprModal');
    if (modal) modal.addEventListener('click', e => { if (e.target.id === 'lprModal') _lprCloseModal(); });
    const amodal = document.getElementById('lprAlertModal');
    if (amodal) amodal.addEventListener('click', e => { if (e.target.id === 'lprAlertModal') lprCloseAlert(); });
    // Was 12s. Live reads now arrive by WebSocket (_lprLiveRead), so this is a
    // safety net rather than the update mechanism: it recovers from a dropped
    // socket and refreshes mismatch_level, which is a cross-read comparison a
    // single event cannot carry.
    _lprTickTimer = setInterval(_lprTick, 60000);
  }
  // _lprBound stops the one-time listeners re-binding, but the tick timer IS
  // cleared on leave, so it has to be (re)started on every entry.
  if (!_lprTickTimer) _lprTickTimer = setInterval(_lprTick, 60000);
  _switchLprTab('overview');
  _loadLprVtypeCfg().then(() => lprLoadOverview(), () => lprLoadOverview());
  _loadLprBboxCfg();
  _lprLoadGsMeta();
}

function _switchLprTab(tab) {
  const panels = { overview: 'lprTabOverview', search: 'lprTabSearch', alerts: 'lprTabAlerts', gsalarm: 'lprTabGsAlarm', watchlist: 'lprTabWatchlist', noread: 'lprTabNoRead' };
  document.querySelectorAll('#lprTabBar .tab').forEach(b => b.classList.remove('active'));
  const active = document.querySelector(`#lprTabBar .tab[data-tab="${tab}"]`);
  if (active) active.classList.add('active');
  Object.entries(panels).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.style.display = k === tab ? '' : 'none'; });
  if (tab === 'search' && !window._lprRows.length) loadLpr(1);
  if (tab === 'alerts') loadLprAlerts(1);
  if (tab === 'gsalarm') loadLprGsAlarms(1);
  if (tab === 'watchlist') _renderWatchlistRO();
  if (tab === 'noread') loadLprNoRead(1);
}

// GuruSquare (HKT) "Events Alarm" feed — a SEPARATE tab from Alerts (การแจ้งเตือน)
// because GuruSquare matches on plate only, while a watch-list hit may also
// require province depending on alert_mode; mixing the two counts would make
// the two tabs disagree for no reason a viewer could see (owner decision).
// The tab button itself is hidden until we know the feature applies at all —
// fetched once per page load, not per tab switch.
let _lprGsMetaLoaded = false;
function _lprLoadGsMeta() {
  if (_lprGsMetaLoaded) return;
  _lprGsMetaLoaded = true;
  fetch(`${API}/api/lpr/gs-alarms/meta`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => {
    if (!d) return;
    window._lprGsOwners = Array.isArray(d.owners) ? d.owners : [];
    const btn = document.getElementById('lprTabGsBtn');
    if (btn) btn.style.display = d.enabled ? '' : 'none';
    _populateLprGsOwners();
  }).catch(() => {});
}
function _populateLprGsOwners() {
  const sel = document.getElementById('lprGsOwner');
  if (!sel || sel.options.length > 1) return;
  const owners = window._lprGsOwners || [];
  sel.innerHTML = `<option value="">${_t('common.all', 'ทั้งหมด')}</option>`
    + owners.map(o => `<option value="${_esc(o)}">${_esc(o)}</option>`).join('');
}

function lprGotoAlerts() { _switchLprTab('alerts'); }

// ── No-read (ไม่ทราบทะเบียน) — ANPR events with no license_plates row.
// Reuses the exact same card renderer as the ค้นหา tab (_renderLprGrid/_lprCard
// already handle a null plate_number → "ไม่ระบุ" badge, built for exactly this
// case). Plain offset pagination — no need for the search tab's keyset
// complexity. (ปริมาณจริงวัด 2026-09-05 = ~19,600/วัน ไม่ใช่ ~850/วัน ตามที่เคย
// เขียนไว้ — โตตามปริมาณ anprAlarm; ยังไหวเพราะ default เหลือหน้าต่าง 24 ชม.)
let _lprNoReadPage = 1;
const _LPR_NOREAD_PER = 30;
let _lprNoReadCamPickerSite;
function _populateLprNoReadCameras() {
  const camEl = document.getElementById('lprNoReadCam');
  if (!camEl) return;
  if (camEl.options.length && _lprNoReadCamPickerSite === _lprActiveSiteId) return;
  _lprNoReadCamPickerSite = _lprActiveSiteId;
  const lprCams = (typeof cameras !== 'undefined' ? cameras : []).filter(c => c.cam_role === 'lpr');
  fillCameraSelect('lprNoReadCam', siteScopedCams(lprCams, _lprActiveSiteId), { multiPicker: true });
}
// Filter params for the ไม่ทราบทะเบียน tab — subset of _lprFilterParams(): only
// camera + date range are meaningful here (no license_plates row to filter on).
function _lprNoReadFilterParams() {
  const params = new URLSearchParams();
  const mpv = id => (typeof MultiPicker !== 'undefined') ? MultiPicker.values(id) : [];
  const cams = mpv('lprNoReadCam');
  if (cams.length) params.set('cameras', cams.join(','));
  else _lprApplySiteParam(params);
  const f = (typeof getDtValue === 'function') ? getDtValue('lprNoReadFrom') : '';
  if (f) params.set('from', new Date(f).toISOString());
  const t = (typeof getDtValue === 'function') ? getDtValue('lprNoReadTo') : '';
  if (t) params.set('to', new Date(t).toISOString());
  return params;
}
function lprNoReadSearch() { loadLprNoRead(1); }
function lprNoReadReset() {
  const camEl = document.getElementById('lprNoReadCam');
  if (camEl) { [...camEl.options].forEach(o => o.selected = false); if (typeof MultiPicker !== 'undefined') MultiPicker.refresh('lprNoReadCam'); }
  if (typeof clearDtValue === 'function') { clearDtValue('lprNoReadFrom'); clearDtValue('lprNoReadTo'); }
  loadLprNoRead(1);
}
function _lprNoReadSetRange(from, to) {
  if (typeof setDtValue === 'function') { setDtValue('lprNoReadFrom', from); setDtValue('lprNoReadTo', to); }
  loadLprNoRead(1);
}
function lprNoReadQuick24h() {
  const now = new Date();
  _lprNoReadSetRange(new Date(now - 24 * 3600 * 1000), now);
}
function lprNoReadQuickWeek() {
  const now = new Date(), from = new Date(now);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));  // Monday
  from.setHours(0, 0, 0, 0);
  _lprNoReadSetRange(from, now);
}
function lprNoReadQuickMonth() {
  const now = new Date();
  _lprNoReadSetRange(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0), now);
}
// 🔴 ต้องเช็ค res.ok — เดิม 500 ได้ body {error:…} → Array.isArray เป็น false → แสดง "ไม่พบ"/0 ทั้งที่จริงคือโหลดล้ม
// (คลาสเดียวกับที่แก้ใน loadLpr 2026-08-31 · audit 2026-10-02 · D14) · โยนแล้วให้ .catch ของแต่ละจุดแสดง "โหลดไม่สำเร็จ"
function _lprJsonRows(res) {
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json().then(rows => ({ rows, total: parseInt(res.headers.get('X-Total-Count') || '0', 10) }));
}
const _lprLoadFailHtml = () => `<div class="alarm-empty" style="padding:30px;color:var(--status-bad)">${_t('common.loadFailedShort', 'โหลดไม่สำเร็จ')}</div>`;

function loadLprNoRead(page) {
  if (page) _lprNoReadPage = page;
  let params = _lprNoReadFilterParams();
  // ไม่ได้เลือกช่วงเวลาเลย = server บังคับ default ย้อนหลัง 24 ชม. (ดู /api/lpr/no-read)
  // → เขียนกลับลงช่องวันที่ให้ผู้ใช้เห็นช่วงที่ใช้จริง แล้ว build params ใหม่
  // ⚠️ ห้ามเรียก _lprNoReadSetRange ตรงนี้ — มันเรียก loadLprNoRead ซ้ำ (วน)
  if (!params.get('from') && !params.get('to') && typeof setDtValue === 'function') {
    const now = new Date();
    setDtValue('lprNoReadFrom', new Date(now - 24 * 3600 * 1000));
    setDtValue('lprNoReadTo', now);
    params = _lprNoReadFilterParams();
  }
  const grid = document.getElementById('lprNoReadGrid');
  // Same guard as loadLpr() — a manually-edited range with from > to legitimately
  // matches nothing; say so instead of a silent "no data".
  const rf = params.get('from'), rt = params.get('to');
  if (rf && rt && new Date(rf) > new Date(rt)) {
    const cnt = document.getElementById('lprNoReadCount'); if (cnt) cnt.textContent = '0';
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--status-bad)">${_t('lpr.invalidRange','ช่วงเวลาไม่ถูกต้อง — วันที่ "ตั้งแต่" อยู่หลังวันที่ "ถึง"')}</div>`;
    const pager = document.getElementById('lprNoReadPager'); if (pager) pager.innerHTML = '';
    return;
  }
  params.set('limit', _LPR_NOREAD_PER);
  params.set('offset', (_lprNoReadPage - 1) * _LPR_NOREAD_PER);
  if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-secondary)">${_t('common.loading','กำลังโหลด...')}</div>`;
  fetch(`${API}/api/lpr/no-read?${params}`)
    .then(_lprJsonRows)
    .then(({ rows, total }) => {
      window._lprNoReadRows = Array.isArray(rows) ? rows : [];
      const cnt = document.getElementById('lprNoReadCount'); if (cnt) cnt.textContent = total.toLocaleString();
      _renderLprGrid(window._lprNoReadRows, 'lprNoReadGrid', 'noread');
      renderPagination('lprNoReadPager', _lprNoReadPage, total, _LPR_NOREAD_PER, p => loadLprNoRead(p), _t('lpr.items','รายการ'));
    })
    .catch(() => { if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--status-bad)">${_t('common.loadFailedShort','โหลดไม่สำเร็จ')}</div>`; });
}

// ── RF-ALERT: watch-list hit alerts (การแจ้งเตือน tab) ──────────────
let _lprAlertPage = 1, _lprAlertPeriod = 'all', _lprAlertGroup = '', _lprAlertSearch = '', _lprAlertRows = [], _lprAlertCur = null, _lprAlertTimer = null;
const _LPR_ALERT_PER = 15;

function lprAlertSearchDebounce() {
  clearTimeout(_lprAlertTimer);
  _lprAlertTimer = setTimeout(() => { _lprAlertSearch = (document.getElementById('lprAlertSearch')?.value || '').trim(); loadLprAlerts(1); }, 400);
}
// Factored out of _lprAlertRange() so the Events Alarm (GuruSquare) tab's own
// period seg can reuse it without duplicating the day-math.
function _lprPeriodRange(period) {
  const now = new Date(), sod = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  if (period === 'today')     return { from: sod(now).toISOString() };
  if (period === 'yesterday') return { from: sod(new Date(now - 86400000)).toISOString(), to: sod(now).toISOString() };
  if (period === 'week')      return { from: new Date(now - 7 * 86400000).toISOString() };
  if (period === 'month')     return { from: new Date(now - 30 * 86400000).toISOString() };
  return {};
}
function _lprAlertRange() { return _lprPeriodRange(_lprAlertPeriod); }
function loadLprAlerts(page) {
  if (page) _lprAlertPage = page;
  const params = new URLSearchParams({ limit: _LPR_ALERT_PER, offset: (_lprAlertPage - 1) * _LPR_ALERT_PER });
  if (_lprAlertGroup)  params.set('group_id', _lprAlertGroup);
  if (_lprAlertSearch) params.set('q', _lprAlertSearch);
  const r = _lprAlertRange();
  if (r.from) params.set('from', r.from);
  if (r.to)   params.set('to', r.to);
  _lprApplySiteParam(params);
  _renderLprAlertBars();
  fetch(`${API}/api/lpr/alerts?${params}`)
    .then(_lprJsonRows)
    .then(({ rows, total }) => {
      _lprAlertRows = Array.isArray(rows) ? rows : [];
      const cnt = document.getElementById('lprAlertCount'); if (cnt) cnt.textContent = `${total.toLocaleString()} ${_t('lpr.items','รายการ')}`;
      _renderLprAlertFeed(_lprAlertRows);
      renderPagination('lprAlertPager', _lprAlertPage, total, _LPR_ALERT_PER, p => loadLprAlerts(p), _t('lpr.items','รายการ'));
    }).catch(() => { const f = document.getElementById('lprAlertFeed'); if (f) f.innerHTML = _lprLoadFailHtml(); });
}
function _renderLprAlertBars() {
  const pb = document.getElementById('lprAlertPeriodBar');
  if (pb) pb.innerHTML = [['all',_t('common.all','ทั้งหมด')],['today',_t('lpr.pToday','วันนี้')],['yesterday',_t('lpr.pYesterday','เมื่อวาน')],['week',_t('lpr.pWeek','สัปดาห์นี้')],['month',_t('lpr.pMonth','เดือนนี้')]]
    .map(([k,l]) => `<button class="${_lprAlertPeriod===k?'active':''}" data-action="lprAlertPeriod" data-p="${k}">${_esc(l)}</button>`).join('');
  const gb = document.getElementById('lprAlertGroupBar');
  if (gb) gb.innerHTML = `<button class="${_lprAlertGroup===''?'active':''}" data-action="lprAlertGroup" data-g="">${_t('common.all','ทั้งหมด')}</button>`
    + _lprGroups.map(g => `<button class="${_lprAlertGroup===g.id?'active':''}" data-action="lprAlertGroup" data-g="${_esc(g.id)}"><span class="wl-gdot" style="background:${_esc(g.color)}"></span>${_esc(g.name)}</button>`).join('');
}
function lprAlertSetPeriod(p) { _lprAlertPeriod = p; loadLprAlerts(1); }
function lprAlertSetGroup(g)  { _lprAlertGroup = g;  loadLprAlerts(1); }
function _renderLprAlertFeed(rows) {
  const feed = document.getElementById('lprAlertFeed'); if (!feed) return;
  if (!rows.length) { feed.innerHTML = `<div class="alarm-empty" style="padding:30px">${_t('lpr.alertEmpty','ไม่พบการแจ้งเตือน')}</div>`; return; }
  feed.innerHTML = rows.map((h, idx) => {
    const g = _groupById(h.group_id) || { name: h.group_id || '', color: 'var(--status-bad)' };
    const acked = !!h.acked_by;
    const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate_number) : h.plate_number;
    const meta = [h.region, _lprVType(h.vehicle_type || ''), h.camera_name || h.camera_id].filter(Boolean).join(' · ');
    const thumb = (typeof lprPlaque === 'function') ? lprPlaque(h.plate_number, { vehicleType: h.vehicle_type, region: h.region, plateColor: h.raw_json?.plateColor }) : _esc(plate);
    return `<div class="alert-row${g.id==='warrant'?' urgent':''}" style="--gc:${g.color}${acked?';opacity:.5':''}" data-action="lprOpenAlert" data-idx="${idx}">
      <div class="alert-thumb">${thumb}</div>
      <div class="alert-body">
        <div class="alert-l1"><span class="alert-badge" style="background:${g.color}">${_esc(g.name)}</span><span class="alert-plate">${_esc(plate)}</span></div>
        <div class="alert-l2">${_esc(meta)}</div>
        ${h.wl_label ? `<div class="alert-note">${_esc(h.wl_label)}${h.wl_notes ? ' — ' + _esc(h.wl_notes) : ''}</div>` : ''}
      </div>
      <div class="alert-side"><div class="alert-time">${_lprFmtTime(h.event_time)}</div>
        <button class="alert-ack" data-action="lprAckAlertRow" data-id="${h.id}" data-idx="${idx}"${acked?' disabled':''}>${acked?_t('fmatch.acked','รับทราบแล้ว'):_t('fmatch.ack','รับทราบ')}</button>
      </div>
    </div>`;
  }).join('');
}
function renderLprAlarmStrip() {
  const block = document.getElementById('lprAlarmBlock'), strip = document.getElementById('lprAlarmStrip');
  const headCount = document.getElementById('lprAlarmHeadCount');
  if (!strip) return;
  const params = new URLSearchParams({ limit: '8' });
  _lprApplySiteParam(params);
  fetch(`${API}/api/lpr/alerts?${params}`).then(r => {
    // ล้มแล้วอย่าซ่อนแถบ (เดิม 500 → list ว่าง → ซ่อนแถบ = ดูเหมือน "ไม่มี hit") — โยนให้ catch คงของเดิมไว้ (D14)
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = parseInt(r.headers.get('X-Total-Count'), 10) || 0;
    return r.json().then(rows => ({ rows, total }));
  }).then(({ rows, total }) => {
    const list = Array.isArray(rows) ? rows : [];
    if (block) block.style.display = list.length ? '' : 'none';
    if (headCount) headCount.textContent = total > list.length ? `${list.length} ${_t('lpr.alarmOf','จาก')} ${total}` : '';
    // Same row shape as the Alerts tab's own fetch (/api/lpr/alerts) — share
    // _lprAlertRows so a click here can open the exact same detail modal via
    // the exact same lprOpenAlert(idx), instead of just linking to the tab.
    _lprAlertRows = list;
    strip.innerHTML = list.map((h, idx) => {
      const g = _groupById(h.group_id) || { name: h.group_id || '', color: 'var(--status-bad)' };
      const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate_number) : h.plate_number;
      const thumb = (typeof lprPlaque === 'function')
        ? lprPlaque(h.plate_number, { region: h.region, vehicleType: h.vehicle_type, plateColor: h.raw_json?.plateColor, feed: true })
        : '';
      return `<div class="alarm-card${g.id==='warrant'?' urgent':''}" style="--gc:${g.color}" data-action="lprOpenAlert" data-idx="${idx}">
        ${thumb ? `<div class="alarm-plate-thumb">${thumb}</div>` : ''}
        <div class="alarm-info">
          <div class="alarm-row1"><span class="alarm-head-dot"></span><span class="alarm-grp">${_esc(g.name)}</span><span class="alarm-time">${_lprFmtTimeShort(h.event_time)}</span></div>
          <div class="alarm-name">${_esc(plate)}</div>
          <div class="alarm-meta">${_esc(h.region ? provinceLabel(h.region) : _lprVType(h.vehicle_type || ''))}</div>
        </div>
      </div>`;
    }).join('');
  }).catch(() => {});
}
function loadLprAlertCount() {
  const badge = document.getElementById('lprAlertBadge'); if (!badge) return;
  fetch(`${API}/api/lpr/alerts/count`).then(r => r.json()).then(d => {
    const n = d.unacked || 0;
    badge.textContent = n > 0 ? (n > 99 ? '99+' : n) : '';
    badge.style.display = n > 0 ? '' : 'none';
  }).catch(() => {});
}

// ── Events Alarm (GuruSquare) tab — read-only feed over blacklist.gs_alarms ─
let _lprGsPage = 1, _lprGsPeriod = 'all', _lprGsSearch = '', _lprGsOwner = '', _lprGsRows = [], _lprGsTimer = null;
const _LPR_GS_PER = 15;

function lprGsSearchDebounce() {
  clearTimeout(_lprGsTimer);
  _lprGsTimer = setTimeout(() => { _lprGsSearch = (document.getElementById('lprGsSearch')?.value || '').trim(); loadLprGsAlarms(1); }, 400);
}
function lprGsSetPeriod(p) { _lprGsPeriod = p; loadLprGsAlarms(1); }
function lprGsSetOwner(el) { _lprGsOwner = el.value || ''; loadLprGsAlarms(1); }
function _renderLprGsBars() {
  const pb = document.getElementById('lprGsPeriodBar');
  if (pb) pb.innerHTML = [['all',_t('common.all','ทั้งหมด')],['today',_t('lpr.pToday','วันนี้')],['yesterday',_t('lpr.pYesterday','เมื่อวาน')],['week',_t('lpr.pWeek','สัปดาห์นี้')],['month',_t('lpr.pMonth','เดือนนี้')]]
    .map(([k,l]) => `<button class="${_lprGsPeriod===k?'active':''}" data-action="lprGsPeriod" data-p="${k}">${_esc(l)}</button>`).join('');
}
function loadLprGsAlarms(page) {
  if (page) _lprGsPage = page;
  _populateLprGsOwners();
  const params = new URLSearchParams({ limit: _LPR_GS_PER, offset: (_lprGsPage - 1) * _LPR_GS_PER });
  if (_lprGsSearch) params.set('q', _lprGsSearch);
  if (_lprGsOwner)  params.set('owner', _lprGsOwner);
  const r = _lprPeriodRange(_lprGsPeriod);
  if (r.from) params.set('from', r.from);
  if (r.to)   params.set('to', r.to);
  _renderLprGsBars();
  fetch(`${API}/api/lpr/gs-alarms?${params}`, { credentials: 'include' })
    .then(_lprJsonRows)
    .then(({ rows, total }) => {
      _lprGsRows = Array.isArray(rows) ? rows : [];
      const cnt = document.getElementById('lprGsCount'); if (cnt) cnt.textContent = `${total.toLocaleString()} ${_t('lpr.items','รายการ')}`;
      _renderLprGsFeed(_lprGsRows);
      renderPagination('lprGsPager', _lprGsPage, total, _LPR_GS_PER, p => loadLprGsAlarms(p), _t('lpr.items','รายการ'));
    }).catch(() => { const f = document.getElementById('lprGsFeed'); if (f) f.innerHTML = _lprLoadFailHtml(); });
}
function _renderLprGsFeed(rows) {
  const feed = document.getElementById('lprGsFeed'); if (!feed) return;
  if (!rows.length) { feed.innerHTML = `<div class="alarm-empty" style="padding:30px">${_t('lpr.alertEmpty','ไม่พบการแจ้งเตือน')}</div>`; return; }
  feed.innerHTML = rows.map((h, idx) => {
    const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate) : h.plate;
    // 'ours' captures = our own camera read (snapshot_file via cap.* lateral join);
    // 'lprresult' captures = GuruSquare's own read log photo (capture_image_url,
    // served through the same auth-gated blacklist photo route as the reference
    // image). Neither present → fall back to the synthetic plate plaque.
    const thumbUrl = h.snapshot_file ? `${API}/snapshots/${encodeURIComponent(h.snapshot_file)}?w=${SNAP_W.card}`
      : h.capture_image_url ? `${API}${h.capture_image_url}` : null;
    const thumb = thumbUrl
      ? `<img src="${thumbUrl}" loading="lazy" decoding="async" data-err="hide">`
      : ((typeof lprPlaque === 'function') ? lprPlaque(h.plate, { vehicleType: h.vehicle_type }) : _esc(plate));
    const meta = [h.camera_name, h.province ? provinceLabel(h.province) : ''].filter(Boolean).join(' · ');
    const note = [h.owner, h.detail].filter(Boolean).join(' — ');
    return `<div class="alert-row" style="--gc:var(--accent)" data-action="lprOpenGsAlarm" data-idx="${idx}">
      <div class="alert-thumb">${thumb}</div>
      <div class="alert-body">
        <div class="alert-l1"><span class="alert-badge" style="background:var(--accent)">${_t('lpr.gsBadge','GuruSquare')}</span><span class="alert-plate">${_esc(plate)}</span></div>
        <div class="alert-l2">${_esc(meta)}</div>
        ${note ? `<div class="alert-note">${_esc(note)}</div>` : ''}
      </div>
      <div class="alert-side"><div class="alert-time">${_lprFmtTime(h.alarm_time)}</div>
        ${h.line_status ? `<span class="am-acklog">${_esc(h.line_status)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}
// Row-based opener (mirrors lprOpenAlertRow) — reuses the SAME #lprAlertModal
// markup, just filled from a gs_alarms row shape instead of a watch-list hit
// row shape. `h.plate_number` is set here (gs_alarms only has `.plate`) so
// _lprLoadAlertHistory() — written for the watch-list shape — works unchanged,
// and `h` itself (not a copy) becomes _lprAlertCur so its staleness guard
// still compares correctly. `h.__isGs` lets lprModalBack() (page-lpr.js, the
// sightings drill-in "back" button) reopen THIS modal instead of the
// watch-list one when backing out of a plate-history detail.
function lprOpenGsAlarmRow(h) {
  if (!h) return;
  h.plate_number = h.plate;
  h.__isGs = true;
  _lprAlertCur = h;
  const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate) : h.plate;
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('lprAmBadge', el => { el.textContent = _t('lpr.gsBadge','GuruSquare'); el.style.background = 'var(--accent)'; });
  set('lprAmPlate', el => el.innerHTML = (typeof lprPlaque === 'function')
    ? lprPlaque(h.plate, { vehicleType: h.vehicle_type })
    : _esc(plate));
  set('lprAmTime', el => el.textContent = _lprFmtTime(h.alarm_time));

  const sceneUrl = h.snapshot_file ? `${API}/snapshots/${encodeURIComponent(h.snapshot_file)}` : null;
  set('lprAmCaptured', el => el.innerHTML = sceneUrl
    ? `<img class="am-scene-img" src="${sceneUrl}?w=${SNAP_W.scene}" loading="lazy" decoding="async" data-err="hide">${_lprZoomBtn(sceneUrl)}`
    : (h.capture_image_url
        ? `<img class="am-scene-img" src="${API}${h.capture_image_url}" loading="lazy" decoding="async" data-err="hide">${_lprZoomBtn(`${API}${h.capture_image_url}`)}`
        : `<div class="am-imggone">${(typeof lprPlaque==='function')?lprPlaque(h.plate,{vehicleType:h.vehicle_type}):_esc(plate)}</div>`));
  // No per-plate crop file / bbox on this feed (GuruSquare's alert payload
  // carries no coordinates) — the two-crop row the watch-list modal shows is
  // watch-list-only, so it is left empty here rather than showing "no image"
  // tiles that can never fill in.
  set('lprAmCrops', el => el.innerHTML = '');

  const refUrl = h.ref_image_url ? `${API}${h.ref_image_url}` : null;
  set('lprAmRef', el => el.innerHTML = refUrl
    ? `<img src="${refUrl}" data-err="hide" style="width:100%;border-radius:8px;display:block">${_lprZoomBtn(refUrl)}`
    : `<div class="am-ref-empty">${_t('lpr.amRefEmpty','ยังไม่มีรูปอ้างอิง · ผู้แจ้งยังไม่อัปโหลด')}</div>`);

  // am-sec-cam = "ข้อมูลจากกล้อง" — what THIS detection actually carries, so
  // จังหวัด here is read_region (our camera's own OCR, only present when
  // capture_source='ours'), never the blacklist's registered province — that
  // one belongs in the reference section below, where it can visibly disagree.
  const drows = [
    [_t('lpr.dCam','กล้อง'), _esc(h.camera_name || '—')],
    h.read_region ? [_t('lpr.region','จังหวัด'), _esc(provinceLabel(h.read_region))] : null,
    h.vehicle_type ? [_t('lpr.fType','ประเภทรถ'), _esc(_lprVType(h.vehicle_type) || '—')] : null,
    [_t('lpr.dTime','เวลา'), _lprFmtTime(h.alarm_time)],
  ].filter(Boolean);
  set('lprAmData', el => el.innerHTML = drows.map(([k,v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join(''));

  const nrows = [
    [_t('lpr.gsOwner','หน่วยงาน'), h.owner || '—'],
    [_t('lpr.gsDetail','รายละเอียด'), h.detail || '—'],
    h.carbrand ? [_t('lpr.brand','ยี่ห้อ'), h.carbrand] : null,
    // แปลด้วยตัวเดียวกับโมดัลรายละเอียดบัญชีดำ (บรรทัด ~1016) — ต้นทางส่งมาเป็นอังกฤษ
    h.carcolor ? [_t('lpr.vehicleColor','สีรถ'), _lprColorLang(h.carcolor)] : null,
    h.cartype  ? [_t('lpr.fType','ประเภทรถ'),
                  (typeof _blVehicleType === 'function' ? _lprVType(_blVehicleType(h.cartype)) : '') || h.cartype] : null,
    h.province ? [_t('lpr.region','จังหวัด'), provinceLabel(h.province)] : null,
  ].filter(Boolean);
  set('lprAmNote', el => el.innerHTML = nrows.map(([k,v]) => `<div class="lm-drow"><span class="lm-dk">${_esc(k)}</span><span class="lm-dv">${_esc(v)}</span></div>`).join(''));
  set('lprAmCaseNote', el => el.innerHTML = '');
  set('lprAmHistory', el => el.innerHTML = '');

  // GuruSquare rows have no ack concept — hide, don't disable, so the row reads
  // as "not applicable here" rather than "broken". ส่งเข้า LINE/Telegram ด้วยมือ
  // ใช้ได้เหมือนกันทั้งสองประเภท (2026-09-25) จึงไม่ซ่อน — แค่เปิดปุ่มให้พร้อมกด
  // (ไม่ผูกกับ group_id ซึ่ง GS ไม่มีแนวคิดนี้เลย)
  const ack = document.getElementById('lprAmAck'); if (ack) ack.style.display = 'none';
  const nb = document.getElementById('lprAmNotify');
  if (nb) { nb.style.display = ''; nb.disabled = false; nb.title = ''; }
  const nbTg = document.getElementById('lprAmNotifyTg');
  if (nbTg) nbTg.style.display = '';
  _lprSetTelegramButtonState();
  const log = document.getElementById('lprAmAckLog'); if (log) log.textContent = '';

  _lprModalOpen = true;
  document.getElementById('lprAlertModal').style.display = 'flex';
  _lprLoadAlertHistory(h);
}
function lprOpenGsAlarm(idx) { lprOpenGsAlarmRow(_lprGsRows[idx]); }

// Magnifier overlay for the compare images — same corner button + SVG already
// used on the main LPR detail modal's scene photo (.lm-zoom-btn), just wired to
// whichever URL this image actually is. `data-action="lprViewFull"` is the
// existing global dispatcher (page-nav-bindings.js) — no new click handler needed.
function _lprZoomBtn(url) {
  return `<button type="button" class="lm-zoom-btn" data-action="lprViewFull" data-url="${_esc(url)}" title="${_t('lpr.viewFull','ดูรูปเต็ม')}" aria-label="${_t('lpr.viewFull','ดูรูปเต็ม')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="15.65" y2="15.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg></button>`;
}

// 7-day sightings for the plate in the open alert, plus the way out to the
// full search. Loaded on open rather than behind a click: the question "have we
// seen this bike before?" is the first one asked, and making it a click means it
// mostly does not get asked.
//
// hours=168 and the endpoint's own LIMIT 50 keep this bounded — measured 0.03s
// for a real plate. The row that IS the current alert is dropped so the list
// reads as "before this".
let _lprAlertHistRows = [];
function _lprLoadAlertHistory(h) {
  const el = document.getElementById('lprAmHistory');
  if (!el) return;
  const plate = h.plate_number;
  if (!plate || plate === 'unknown') { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="am-hist"><div class="am-hist-head">${_t('lpr.amHist7d','ที่พบย้อนหลัง 7 วัน')}</div>`
    + `<div class="am-hist-load">${_t('common.loading','กำลังโหลด...')}</div></div>`;
  fetch(`${API}/api/lpr/plate-history?plate=${encodeURIComponent(plate)}&hours=168&limit=50`, { credentials: 'include' })
    .then(r => r.ok ? r.json() : [])
    .then(rows => {
      if (_lprAlertCur !== h) return;                  // another alert opened meanwhile
      const el2 = document.getElementById('lprAmHistory');
      if (!el2) return;
      const past = (rows || []).filter(r => String(r.id) !== String(h.id));
      const btn = `<button class="btn btn-secondary btn-sm am-hist-btn" data-action="lprSearchPlate"
        data-plate="${_esc(plate)}">${_t('lpr.amSearchPlate','ค้นหารถคันนี้ย้อนหลัง')}</button>`;
      _lprAlertHistRows = past;
      const body = past.length
        ? `<div class="am-hist-list">${past.slice(0, 8).map((r, i) => `
            <div class="am-hist-row am-hist-click" data-action="lprAlertHistOpen" data-idx="${i}">
              <span class="am-hist-t">${_lprFmtTime(r.event_time)}</span>
              <span class="am-hist-c">${_esc(r.camera_id || '—')}</span>
            </div>`).join('')}</div>`
          + (past.length > 8 ? `<div class="am-hist-more">${_t('lpr.amHistMore','และอีก')} ${past.length - 8}</div>` : '')
        : `<div class="am-hist-none">${_t('lpr.amHistNone','ไม่พบคันนี้ในรอบ 7 วันที่ผ่านมา (นอกจากครั้งนี้)')}</div>`;
      el2.innerHTML = `<div class="am-hist">
          <div class="am-hist-head">${_t('lpr.amHist7d','ที่พบย้อนหลัง 7 วัน')}
            <span class="am-hist-n">${past.length}</span></div>
          ${body}${btn}
        </div>`;
    })
    .catch(() => { const e2 = document.getElementById('lprAmHistory'); if (e2) e2.innerHTML = ''; });
}

// A sighting row in the alert modal → that read's own detail.
//
// The alert modal has to close first: #lprModal is declared earlier in the DOM
// and both overlays sit at z-index 200, so the detail would otherwise open
// BEHIND the alert. Pushing the alert onto the modal stack is what puts the
// ย้อนกลับ button on the detail and sends it back here.
function lprAlertHistOpen(el) {
  const r = (_lprAlertHistRows || [])[+el.dataset.idx];
  const h = _lprAlertCur;
  if (!r || !h) return;
  const plate = h.plate_number;
  lprCloseAlert();
  _lprOpenRead(r, plate, { __backToAlert: h });
}

// Modal → search tab, filtered to this plate. Reuses the same reset/period/
// switch sequence the KPI shortcuts use so the search lands in a known state.
function lprSearchPlate(el) {
  const plate = el.dataset.plate;
  if (!plate) return;
  lprCloseAlert();
  _lprResetFilters();
  _switchLprTab('search');
  const q = document.getElementById('lprSearchQ');
  if (q) q.value = plate;
  loadLpr(1);
}

// Full list of watch-list hits, in the same compact clickable table the LPR
// detail modal already uses for swap suspects (.lm-mm-table). "ดูทั้งหมด" used
// to switch to the Alerts tab, which threw away whatever the operator was
// looking at on the overview; a modal keeps the page underneath intact.
let _lprAlarmListRows = [];
function lprOpenAlarmList() {
  const m = document.getElementById('lprAlarmListModal');
  const body = document.getElementById('lprAlarmListBody');
  if (!m || !body) return;
  body.innerHTML = `<div class="lm-mm-loading">${_t('common.loading', 'กำลังโหลด...')}</div>`;
  m.style.display = 'flex';
  const params = new URLSearchParams({ limit: '50' });
  _lprApplySiteParam(params);           // the modal obeys the site pills like everything else
  fetch(`${API}/api/lpr/alerts?${params}`, { credentials: 'include' })
    .then(r => {
      const total = parseInt(r.headers.get('X-Total-Count'), 10) || 0;
      return r.json().then(rows => ({ rows, total }));
    })
    .then(({ rows, total }) => {
      const list = Array.isArray(rows) ? rows : [];
      _lprAlarmListRows = list;
      const cnt = document.getElementById('lprAlarmListCount');
      if (cnt) cnt.textContent = total > list.length
        ? `${list.length} ${_t('lpr.alarmOf', 'จาก')} ${total}` : String(total || list.length);
      if (!list.length) {
        body.innerHTML = `<div class="lm-mm-note">${_t('lpr.alarmListNone', 'ยังไม่มีรถเฝ้าระวังที่ตรวจพบ')}</div>`;
        return;
      }
      const hdr = `<div class="lm-mm-row lm-mm-hdr al-row">
          <span class="lm-mm-time">${_t('lpr.dTime', 'เวลา')}</span>
          <span>${_t('bl.category', 'กลุ่ม')}</span><span>${_t('lpr.watchlistPlate', 'ป้ายทะเบียน')}</span>
          <span>${_t('lpr.region', 'จังหวัด')}</span>
          <span class="lm-mm-cam">${_t('lpr.dCam', 'กล้อง')}</span>
        </div>`;
      const rowsHtml = list.map((h, i) => {
        const g = _groupById(h.group_id) || { name: h.group_id || '', color: 'var(--status-bad)' };
        const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate_number) : h.plate_number;
        // Unacknowledged hits carry the group colour; acknowledged ones fade,
        // so a long list still shows at a glance what is left to look at.
        return `<div class="lm-mm-row lm-mm-row-click al-row${h.acked_by ? ' al-acked' : ''}"
             style="--gc:${g.color}" data-action="lprAlarmListOpen" data-idx="${i}">
            <span class="lm-mm-time">${_lprFmtTime(h.event_time)}</span>
            <span class="al-grp"><span class="al-dot"></span>${_esc(g.name)}</span>
            <span class="al-plate">${_esc(plate)}</span>
            <span>${_esc(h.region ? provinceLabel(h.region) : '–')}</span>
            <span class="lm-mm-cam">${_esc(h.camera_name || h.camera_id || '')}</span>
          </div>`;
      }).join('');
      body.innerHTML = `<div class="lm-mm-table">${hdr}${rowsHtml}</div>`;
    })
    .catch(() => {
      body.innerHTML = `<div class="lm-mm-note">${_t('common.loadFailedShort', 'โหลดไม่สำเร็จ')}</div>`;
    });
}

// Deliberately does NOT close the list: the detail modal sits in front (DOM
// order breaks the z-index tie), so closing it drops the operator back into the
// list where they were — which is how you review twenty hits in a row.
function lprAlarmListOpen(el) {
  lprOpenAlertRow(_lprAlarmListRows[+el.dataset.idx]);
}
function lprCloseAlarmList() {
  const m = document.getElementById('lprAlarmListModal');
  if (m) m.style.display = 'none';
}

// Index-based entry point kept for the strip and the alerts tab, which both
// render straight out of _lprAlertRows.
function lprOpenAlert(idx) {
  const h = _lprAlertRows[idx]; if (!h) return;
  lprOpenAlertRow(h);
}

// The list modal below holds its OWN, longer array. Handing it an index into
// _lprAlertRows would open the wrong alert as soon as the strip or the tab
// re-rendered underneath it, so it passes the row itself.
function lprOpenAlertRow(h) {
  if (!h) return;
  _lprAlertCur = h;
  // Undo lprOpenGsAlarmRow()'s hide — a watch-list alert always has these.
  ['lprAmAck', 'lprAmNotify', 'lprAmNotifyTg'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
  _lprSetTelegramButtonState();
  const g = _groupById(h.group_id) || { name: h.group_id || '', color: 'var(--status-bad)' };
  const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate_number) : h.plate_number;
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('lprAmBadge', el => { el.textContent = g.name; el.style.background = g.color; });
  // Real plate plaque, not plain text: the plate's own DLT background colour is
  // an identifying feature an officer reads at a glance (white = ส่วนบุคคล,
  // yellow = รับจ้าง, red = ป้ายแดง...). The colour the CAMERA saw lives in
  // raw_json.plateColor — the same field the alert list thumb and the Events
  // feed already plaque with, so all three now agree. lprPlaque() handles the
  // no-read case itself, which is why plateLabel is only the fallback here.
  set('lprAmPlate', el => el.innerHTML = (typeof lprPlaque === 'function')
    ? lprPlaque(h.plate_number, { vehicleType: h.vehicle_type, region: h.region, plateColor: h.raw_json?.plateColor })
    : _esc(plate));
  set('lprAmTime', el => el.textContent = _lprFmtTime(h.event_time));
  const sceneUrl = h.snapshot_file ? `${API}/snapshots/${encodeURIComponent(h.snapshot_file)}` : (h.plate_image ? `${API}/snapshots/${encodeURIComponent(h.plate_image)}` : null);
  // ปุ่มขยาย/ดาวน์โหลดต้องได้ภาพที่ **ฝังกรอบลงในไฟล์จริง** เมื่อสวิตช์เปิด — ภาพที่
  // ออกจากหน้านี้ไปแล้ว (แท็บใหม่/บันทึกไฟล์) พา SVG overlay ที่วาดบน DOM ไปด้วยไม่ได้
  // เดิมหน้าต่างนี้ส่ง sceneUrl เปล่า ๆ ⇒ เปิดสวิตช์แล้วไม่มีผล เพราะไม่มีใครถาม ?bbox=1
  // (หน้าต่างรายละเอียดป้ายทำถูกอยู่แล้วที่ _lprOpenModal — ที่นี่คือคนละ modal)
  const sceneFull = (sceneUrl && window._lprBboxCfg?.fullImage && h.id)
    ? `${sceneUrl}?bbox=1&eid=${h.id}&alarm=1` : sceneUrl;   // alarm=1 → กรอบที่ฝังเป็นสีแดง
  set('lprAmCaptured', el => el.innerHTML = sceneUrl
    ? `<img class="am-scene-img" src="${sceneUrl}?w=${SNAP_W.scene}" loading="lazy" decoding="async" data-err="hide">${_lprZoomBtn(sceneFull)}`
    : `<div class="am-imggone">${(typeof lprPlaque==='function')?lprPlaque(h.plate_number,{vehicleType:h.vehicle_type,region:h.region}):_esc(plate)}</div>`);

  // 🔴 กรอบของรถเฝ้าระวังเป็น **สีแดง** ไม่ใช่สีน้ำเงินเหมือนรถทั่วไป — คนที่เปิด
  // หน้าต่างนี้กำลังดูรถที่ตรงกับบัญชีเฝ้าระวัง สีจึงต้องบอกสถานะนั้นตั้งแต่แรกเห็น
  // เดิมหน้าต่างนี้ไม่เคยเรียกตัววาดกรอบเลย (มีแต่ที่หน้าต่างรายละเอียดป้าย)
  // และ /api/lpr/alerts ก็ไม่เคยคืนพิกัดมาให้ด้วย — ต้องแก้ทั้งสองฝั่งถึงจะเห็นกรอบ
  const amImg = document.getElementById('lprAmCaptured')?.querySelector('img');
  if (amImg && typeof attachSnapOverlay === 'function') {
    const cfg = window._lprBboxCfg || { vehicle: true, plate: false };
    const RED = 'var(--status-bad)';
    const shapes = [];
    if (cfg.vehicle && _lprBboxInRange(h.vehicle_bbox_x, h.vehicle_bbox_y, h.vehicle_bbox_width, h.vehicle_bbox_height)) {
      shapes.push({ kind: 'bracket', color: RED,
        x1: h.vehicle_bbox_x / 1000, y1: h.vehicle_bbox_y / 1000,
        x2: (h.vehicle_bbox_x + h.vehicle_bbox_width) / 1000,
        y2: (h.vehicle_bbox_y + h.vehicle_bbox_height) / 1000 });
    }
    if (cfg.plate && _lprBboxInRange(h.bbox_x, h.bbox_y, h.bbox_width, h.bbox_height)) {
      shapes.push({ kind: 'box', color: RED,
        x1: h.bbox_x / 1000, y1: h.bbox_y / 1000,
        x2: (h.bbox_x + h.bbox_width) / 1000, y2: (h.bbox_y + h.bbox_height) / 1000 });
    }
    if (shapes.length) attachSnapOverlay(amImg, shapes);
  }

  // ── ภาพครอบตัดสองใบ (เจ้าของสั่ง 2026-09-09) ────────────────────────────
  // ป้ายทะเบียน = ไฟล์จริงที่กล้องส่งมา (plate_image) ไม่ได้ครอบเอง — คมกว่าการ
  // ครอบจากภาพเต็มฉากที่ถูกย่อมาแล้ว · ตัวรถไม่มีไฟล์แยก จึงครอบจากภาพเต็มฉาก
  // ด้วย vehicle_bbox (วัดจริง 2026-09-09: 5,877,095 จาก 5,877,103 แถวใน 7 วัน
  // มีกรอบที่ใช้ได้ — ตัวที่ไม่มีจะขึ้นข้อความแทน ไม่ใช่ครอบมั่ว)
  const plateCropUrl = h.plate_image ? `${API}/snapshots/${encodeURIComponent(h.plate_image)}` : null;
  const vehOk = sceneUrl && _lprBboxInRange(h.vehicle_bbox_x, h.vehicle_bbox_y, h.vehicle_bbox_width, h.vehicle_bbox_height);
  const cropNone = `<div class="am-crop-none">${_t('lpr.amCropNone', 'ไม่มีภาพ')}</div>`;
  set('lprAmCrops', el => {
    el.innerHTML =
      `<div class="am-crop"><span class="am-crop-cap">${_t('lpr.amPlateCrop', 'ป้ายทะเบียน')}</span>`
      + `<div class="am-crop-tile am-crop-plate">${plateCropUrl
          ? `<img src="${plateCropUrl}" loading="lazy" decoding="async" data-err="hide">${_lprZoomBtn(plateCropUrl)}`
          : cropNone}</div></div>`
      + `<div class="am-crop"><span class="am-crop-cap">${_t('lpr.amVehicleCrop', 'ตัวรถ')}</span>`
      // ตัวรถไม่มีไฟล์แยก (ครอบจากภาพเต็มฉากด้วย CSS) — ปุ่มขยายจึงเปิดภาพเต็มฉาก
      // (sceneFull = มีกรอบแดงรอบรถเมื่อเปิดสวิตช์กรอบ) · เจ้าของขอ 2026-09-24
      + `<div class="am-crop-tile am-crop-veh">${vehOk ? _lprZoomBtn(sceneFull) : cropNone}</div></div>`;
    // ต้องรอให้ภาพฉากโหลดก่อน เพราะสูตรขยายกล่องต้องใช้สัดส่วนจริงของไฟล์
    // (ไม่รู้สัดส่วน = เดา 16:9 แล้วรถผิดส่วนกับกล้องที่ไม่ใช่ 16:9)
    if (!vehOk || !amImg) return;
    const tile = el.querySelector('.am-crop-veh');
    const fit = () => {
      if (!amImg.naturalWidth || !amImg.naturalHeight) return;
      const box = [h.vehicle_bbox_x, h.vehicle_bbox_y, h.vehicle_bbox_width, h.vehicle_bbox_height];
      // วัดสัดส่วนของกรอบจาก DOM จริง แทนที่จะผูกค่าไว้กับตัวเลขใน CSS อีกที่หนึ่ง
      // (แก้ความสูงใน index.css แล้วลืมแก้ที่นี่ = รถถูกยืดโดยไม่มีอะไรเตือน)
      const tileAR = (tile.clientWidth && tile.clientHeight)
        ? tile.clientWidth / tile.clientHeight : LPR_CROP_AR;
      tile.style.cssText = _lprCropStyle(amImg.currentSrc || amImg.src, box,
        amImg.naturalWidth / amImg.naturalHeight, tileAR);
    };
    // 🔴 ต้องรอเฟรมถัดไปเสมอ ห้ามเรียก fit() ตรง ๆ — ตอนนี้ modal ยัง display:none
    // (บรรทัด display='flex' อยู่ท้ายฟังก์ชัน) กรอบจึงยังกว้าง 0 วัดสัดส่วนไม่ได้
    // และจะตกไปใช้ค่าสำรอง 4/3 ทำให้รถถูกยืด · เกิดเฉพาะ "ครั้งที่สองที่เปิดใบเดิม"
    // เพราะรูปอยู่ใน cache แล้ว .complete เป็น true ทันทีตั้งแต่ยังไม่แสดงผล
    const later = () => requestAnimationFrame(fit);
    if (amImg.complete) later(); else amImg.addEventListener('load', later, { once: true });
  });

  const refUrl = h.ref_image ? `${API}/snapshots/${encodeURIComponent(h.ref_image)}` : null;
  set('lprAmRef', el => el.innerHTML = refUrl
    ? `<img src="${refUrl}" data-err="hide" style="width:100%;border-radius:8px;display:block">${_lprZoomBtn(refUrl)}`
    : `<div class="am-ref-empty">${_t('lpr.amRefEmpty','ยังไม่มีรูปอ้างอิง · ผู้แจ้งยังไม่อัปโหลด')}</div>`);
  const dot = h.vehicle_color ? _lprColorDot(h.vehicle_color) : '';
  const drows = [
    [_t('lpr.region','จังหวัด'), _esc(h.region ? provinceLabel(h.region) : '—')],
    [_t('lpr.fType','ประเภทรถ'), _esc(_lprVType(h.vehicle_type || '') || '—')],
    h.vehicle_color ? [_t('lpr.vehicleColor','สีรถ'), `${dot}${_esc(_lprColorLang(h.vehicle_color))}`] : null,
    [_t('lpr.dCam','กล้อง'), _esc(h.camera_name || h.camera_id || '—')],
    [_t('lpr.dTime','เวลา'), _lprFmtTime(h.event_time)],
  ].filter(Boolean);
  set('lprAmData', el => el.innerHTML = drows.map(([k,v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join(''));
  // Reference-side detail: same structured rows (Vehicle Type, Colour, Plate
  // Colour, Brand, Reported by, Source, Imported at) the Details modal already
  // shows for this master — reused via _blLprRecordRows (page-blacklist.js)
  // rather than a flat notes string, which is all lpr_watchlist itself carries.
  // Falls back to that flat text for hand-added plates with no blacklist_master_id.
  set('lprAmNote', el => el.innerHTML =
    `<span class="am-note-k">${_t('lpr.amNote','หมายเหตุ / หมายจับ')}</span><span class="am-note-v">${_esc(h.wl_notes || h.wl_label || '—')}</span>`);
  // Case narrative (case number / free-text details) only ever comes from the
  // blacklist master fetch below — clear any leftover from a previously-open
  // alert so a hand-added plate (no master) doesn't show a stale case note.
  set('lprAmCaseNote', el => el.innerHTML = '');
  set('lprAmHistory', el => el.innerHTML = '');
  // ปุ่มส่งเข้า LINE เอง — เปิดได้เฉพาะป้ายที่อยู่ในกลุ่มเฝ้าระวัง (ไม่มีกลุ่ม = ไม่มีผู้รับ)
  const nb = document.getElementById('lprAmNotify');
  if (nb) {
    nb.disabled = !h.group_id;
    nb.title = h.group_id ? '' : _t('lpr.amNotifyNoGroup', 'ป้ายนี้ไม่ได้อยู่ในกลุ่มเฝ้าระวัง จึงไม่มีผู้รับให้ส่งถึง');
  }
  const ack = document.getElementById('lprAmAck'), log = document.getElementById('lprAmAckLog');
  if (ack && log) {
    if (h.acked_by) { ack.disabled = true; ack.textContent = _t('fmatch.acked','รับทราบแล้ว'); log.textContent = `${_t('fmatch.ackedBy','รับทราบโดย')} ${_esc(h.acked_by)} · ${_lprFmtTime(h.acked_at)}`; }
    else { ack.disabled = false; ack.textContent = _t('fmatch.ack','รับทราบ'); log.textContent = ''; }
  }
  _lprModalOpen = true;
  document.getElementById('lprAlertModal').style.display = 'flex';
  if (h.blacklist_master_id) _lprLoadAlertMasterDetail(h);
  _lprLoadAlertHistory(h);
}

// Reference-side detail, loaded async: the SAME structured rows (Vehicle Type,
// Colour, Plate Colour, Brand, Reported by, Source, Imported at) the Details
// modal shows for this master, reused via _blLprRecordRows (page-blacklist.js)
// instead of duplicating that field mapping here. Falls back to the flat
// label/notes text already on screen if there is no master, no lpr record on
// it, or the fetch fails — a slow network must not leave the panel blank.
//
// `h` (not just its id) is the staleness guard: clicking through alerts faster
// than this resolves must not let a late response overwrite whichever alert is
// open by the time it lands — reference equality against _lprAlertCur, set
// synchronously before this is ever called, is enough.
function _lprLoadAlertMasterDetail(h) {
  const note = document.getElementById('lprAmNote');
  if (note) note.innerHTML = `<span class="am-note-k">${_t('common.loading', 'กำลังโหลด...')}</span>`;
  fetch(`${API}/api/blacklist/master/${encodeURIComponent(h.blacklist_master_id)}`, { credentials: 'include' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (_lprAlertCur !== h) return; // a different alert is open now
      const el = document.getElementById('lprAmNote');
      if (!el) return;
      const recs = (d && d.records) || [];
      // Prefer whichever linked record has a photo — the same "richest wins"
      // signal the bridge itself uses when it decides what to show at all.
      const best = recs.find(r => r.data_type === 'lpr' && r.photo_path) || recs.find(r => r.data_type === 'lpr');
      if (!best || typeof _blLprRecordRows !== 'function') return; // flat fallback stays on screen
      const rj = best.raw_json || {};
      const pt = (typeof _blParsePlateType === 'function') ? _blParsePlateType(rj.platetype) : { label: '', color: '' };
      const vtypeLabel = (typeof _blVehicleType === 'function' && typeof _lprVType === 'function')
        ? (_lprVType(_blVehicleType(rj.cartype)) || rj.cartype || '') : (rj.cartype || '');
      const colorName = rj.carcolor || '';
      const colorDot = colorName && typeof _lprColorDot === 'function' ? _lprColorDot(colorName) : '';
      const colorLabel = colorName && typeof _lprColorLang === 'function' ? _lprColorLang(colorName) : colorName;
      const pcHex = (typeof _LPR_PCOLOR_HEX !== 'undefined' && _LPR_PCOLOR_HEX[pt.color]) || 'var(--surface-overlay)';
      const province = rj.province || '';
      const provLabel = province && typeof provinceLabel === 'function' ? provinceLabel(province) : province;
      const rows = _blLprRecordRows(best, {
        province, provLabel, vtypeLabel, colorName, colorDot, colorLabel, pt, pcHex,
        plate: (best.plate_numbers && best.plate_numbers[0]) || '',
      });
      el.innerHTML = `<div class="lm-data">${rows.map(([k, v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join('')}</div>`;
      // Case narrative — GuruSquare carries it in raw_json.owner_detail, DSS
      // Pro vehicle in raw_json.remark; case_note is the last-resort fallback
      // (brand/colour there duplicate rows already shown above, but the free
      // text tail is the only place this narrative exists for some sources).
      const cnEl = document.getElementById('lprAmCaseNote');
      // remark first, matching the Blacklist record card (2026-08-01): it is the
      // instruction — "พบเห็นสกัดจับ (เฉพาะ โกลก)" — while owner_detail says what
      // kind of case it is. At a roadside stop the instruction is what matters.
      const caseNote = (rj.remark || rj.owner_detail || best.case_note || '').trim();
      const kind = rj.remark ? (rj.owner_detail || '').trim() : '';
      // How stale is this? A warrant edited two days ago and one untouched for a
      // year deserve different confidence, and the alert never said which.
      const srcUpd = rj.last_update
        ? `<div class="am-srcmeta"><span>${_t('bl.srcUpdated', 'ต้นทางแก้ล่าสุด')}</span><b>${_lprFmtTime(rj.last_update)}</b></div>`
        : '';
      if (cnEl) cnEl.innerHTML =
        (caseNote ? `<div class="bl-rec-note"><span class="bl-rec-note-k">${_t('bl.caseNote', 'หมายเหตุ / คดี')}</span>${_esc(caseNote)}</div>` : '')
        + (kind ? `<div class="bl-rec-note bl-rec-note-sub"><span class="bl-rec-note-k">${_t('bl.caseKind', 'ประเภทคดี')}</span>${_esc(kind)}</div>` : '')
        + srcUpd;
    })
    .catch(() => { /* keep the flat-note fallback already on screen */ });
}
// ── Telegram: สถานะการเชื่อมต่อ (เปิดอยู่/มี token ไหม) — cache สั้น ๆ ต่อการเปิดหน้า
// GET /api/telegram-config เป็น requireAdminOrAuditor เท่านั้น — auditor/ผู้ใช้ทั่วไป
// จะได้ 403 ⇒ ต้องอ่านว่าเป็น "ไม่รู้สถานะ" (ปุ่มเปิดไว้ ให้เซิร์ฟเวอร์ตัดสินตอนกด)
// ไม่ใช่ "ยังไม่ได้เชื่อมต่อ" (CLAUDE.md: ห้ามเดาแทนเซิร์ฟเวอร์)
let _lprTgConfig = null;
async function _lprTelegramConfig() {
  if (_lprTgConfig) return _lprTgConfig;
  try {
    const r = await fetch(`${API}/api/telegram-config`, { credentials: 'include' });
    if (!r.ok) return null;
    _lprTgConfig = await r.json();
    return _lprTgConfig;
  } catch { return null; }
}
async function _lprSetTelegramButtonState() {
  const btn = document.getElementById('lprAmNotifyTg');
  if (!btn) return;
  const cfg = await _lprTelegramConfig();
  const notConnected = !!cfg && (!cfg.enabled || !cfg.has_token);
  btn.disabled = notConnected;
  btn.title = notConnected ? _t('lpr.amNotifyTgDisabled', 'ยังไม่ได้เชื่อมต่อ Telegram') : '';
}

// ส่งการแจ้งเตือนของเหตุการณ์นี้ด้วยมือ — ใช้ร่วมกันทั้งป้ายเฝ้าระวัง (LPR alerts) และ
// GuruSquare Events Alarm (โมดัลเดียวกัน คนละ endpoint เท่านั้น — h.__isGs บอกว่าอันไหน)
// channel: 'line' | 'telegram' — ข้ามตัวกันเสมอ (cooldown/เพดาน/ปิดรายกลุ่ม) แต่
// **ไม่ข้าม** การคัดผู้รับ และติดป้าย "ส่งด้วยตนเองโดย <ชื่อ>" ที่ต้นข้อความเสมอ
async function _lprSendManual(channel) {
  const h = _lprAlertCur;
  if (!h || !h.id) return;
  const isGs = !!h.__isGs;
  const isTg = channel === 'telegram';

  // เลือกผู้รับเฉพาะครั้งนี้ได้ (2026-08-27, ขยายรองรับ Telegram 2026-09-25) — จุดนี้
  // คือทางที่ใช้ได้จริงเวลาอยากดูการ์ดของ "คันไหนก็ได้ที่กล้องเคยเห็น" ต่างจากปุ่ม
  // ทดสอบในหน้าตั้งค่าที่ส่งซ้ำได้แต่การแจ้งเตือนล่าสุดใบเดียว
  let all = [];
  try {
    const r = await fetch(`${API}${isTg ? '/api/telegram-config' : '/api/line-config'}`, { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      all = isTg
        ? (d.chats || []).map(c => ({ id: String(c.chat_id), name: c.name, type: c.type, enabled: c.enabled }))
        : (d.recipients || []);
    }
  } catch { /* ไม่มีรายชื่อก็ยังส่งแบบปกติได้ */ }

  const plateLabel = h.plate_number || h.plate || '';
  const pick = await RecipientPicker.open({
    title: _t(isTg ? 'lpr.amNotifyTgTitle' : 'lpr.amNotifyTitle', isTg ? 'ส่งเข้า Telegram' : 'ส่งเข้า LINE')
      + (plateLabel ? ` · ${plateLabel}` : ''),
    subtitle: _t(isTg ? 'lpr.amNotifyTgConfirm' : 'lpr.amNotifyConfirm',
      isTg ? 'ข้อความจะติดป้ายว่า "ส่งด้วยตนเอง" พร้อมชื่อผู้ส่ง · ระบบจะข้ามการเว้นระยะเตือนซ้ำ'
           : 'ข้อความจะติดป้ายว่า "ส่งด้วยตนเอง" พร้อมชื่อผู้ส่ง · ระบบจะข้ามการเว้นระยะเตือนซ้ำ'),
    recipients: all,
    // GS: ห้ามติ๊กผู้รับ LPR ไว้ล่วงหน้า — ผู้รับ LPR มีกลุ่มตำรวจอยู่ด้วย แต่ช่องทาง
    // gs_alarm ตั้งใจส่งเฉพาะทีมเรา (เลือกเอง = ติ๊กเองทีละคน)
    defaultIds: (isTg || isGs) ? [] : all.filter(r => r.enabled !== false && r.lpr_enabled !== false).map(r => r.id),
    // ผู้รับจริงของ LPR ถูกกรองด้วยไซต์/กลุ่มของเหตุการณ์อีกชั้นตอนส่ง จำนวนที่เห็น
    // จึงเป็นเพดาน ไม่ใช่จำนวนที่จะได้รับแน่ ๆ
    defaultLabel: isGs
      ? _t('rcp.useConfigured', 'ผู้รับจริงของช่องทางนี้')
      : _t(isTg ? 'lpr.amNotifyTgDefault' : 'lpr.amNotifyDefault',
          isTg ? 'แชทที่ตั้งไว้ของไซต์/กลุ่มนี้' : 'ตามการตั้งค่าจริง (ไซต์/กลุ่มของคันนี้)'),
  });
  if (pick === null) return;

  const btnId = isTg ? 'lprAmNotifyTg' : 'lprAmNotify';
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = true;

  const base = isGs ? `/api/lpr/gs-alarms/${h.id}` : `/api/lpr/alerts/${h.id}`;
  const path = `${base}/notify${isTg ? '-telegram' : ''}`;
  const bodyKey = isTg ? 'telegram_chat_ids' : 'recipient_ids';
  fetch(`${API}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pick.length ? { [bodyKey]: pick } : {}),
  })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'ส่งไม่สำเร็จ'); return d; })
    .then(d => {
      const n = d.result?.recipientCount ?? d.result?.n ?? null;
      alert(_t(isTg ? 'lpr.amNotifyTgSent' : 'lpr.amNotifySent', isTg ? 'ส่งเข้า Telegram แล้ว' : 'ส่งเข้า LINE แล้ว')
        + (n != null ? ` (${n})` : ''));
    })
    .catch(e => alert(_t(isTg ? 'lpr.amNotifyTgFailed' : 'lpr.amNotifyFailed', 'ส่งไม่สำเร็จ: ') + e.message))
    .finally(() => {
      if (!btn) return;
      // ปุ่ม LINE บนแท็บป้ายเฝ้าระวัง (ไม่ใช่ GS) ปิดเมื่อไม่มีกลุ่ม — เหมือนเดิม
      // ปุ่ม Telegram คืนสถานะตามการเชื่อมต่อ (ไม่ผูกกับ group_id ซึ่ง GS ไม่มี)
      if (isTg) _lprSetTelegramButtonState();
      else btn.disabled = !isGs && !h.group_id;
    });
}
function lprNotifyAlert()    { return _lprSendManual('line'); }
function lprNotifyTelegram() { return _lprSendManual('telegram'); }

function lprCloseAlert() { _lprModalOpen = false; const m = document.getElementById('lprAlertModal'); if (m) m.style.display = 'none'; }
function _lprDoAck(id, h) {
  fetch(`${API}/api/lpr/alerts/${id}/ack`, { method: 'POST' }).then(r => r.ok ? r.json() : null).then(a => {
    if (a) { h.acked_by = a.acked_by; h.acked_at = a.acked_at; loadLprAlertCount(); }
  }).catch(() => {});
}
function lprAckAlert() {
  const h = _lprAlertCur; if (!h || h.acked_by) return;
  _lprDoAck(h.id, h);
  const ack = document.getElementById('lprAmAck'); if (ack) { ack.disabled = true; ack.textContent = _t('fmatch.acked','รับทราบแล้ว'); }
}
function lprAckAlertRow(el) {
  const h = _lprAlertRows[+el.dataset.idx]; if (!h || h.acked_by) return;
  _lprDoAck(el.dataset.id, h);
  el.disabled = true; el.textContent = _t('fmatch.acked','รับทราบแล้ว');
  el.closest('.alert-row')?.style.setProperty('opacity', '.5');
}

// Debounced, because this is wired twice on purpose and fires far more often
// than an operator changes their mind: `data-change` on both date inputs (which
// is what catches typing) AND AirDatepicker's onSelect (which is what catches
// clicking). onSelect fires on every step of picking a datetime — the day, then
// the hour, then the minute — so choosing a from/to pair produced ten or more
// overview loads, two requests each.
//
// That is survivable on a warmed period and not on a custom one: a 31-day range
// materialises 5.4M rows and takes 33s measured, each holding a pool connection
// out of 15. Enough of them at once and the rest fail, which is exactly what a
// burst of "โหลดสถิติป้ายทะเบียนไม่สำเร็จ" toasts was — ten failures inside the
// five seconds a toast lives.
//
// 500ms matches _lprSearchDebounce on the search tab; both inputs settle well
// inside it and the datepicker's own steps collapse into one load.
let _lprPeriodTimer = null;
function lprApplyPeriod() {
  if (_lprPeriod !== 'custom') return;
  clearTimeout(_lprPeriodTimer);
  _lprPeriodTimer = setTimeout(() => lprLoadOverview(), 500);
}

// ── Overview: KPI + charts + latest ────────────────────────────────
// Bumped on every overview load so a slow reply for a period the operator has
// already left cannot overwrite the current one.
let _lprStatsGen = 0;
// The generation counter stops a stale reply from painting over a newer one,
// but the request itself kept running to completion — 33s of database work and
// a held connection for an answer nobody would look at. Abort it instead: the
// operator who moves on should stop costing the server anything.
let _lprStatsAbort = null;
let _lprKpiState = {};
function lprLoadOverview() {
  const params = new URLSearchParams({ period: _lprPeriod });
  if (_lprPeriod === 'custom') {
    const f = (typeof getDtValue === 'function') ? getDtValue('lprPeriodFrom') : '';
    const t = (typeof getDtValue === 'function') ? getDtValue('lprPeriodTo') : '';
    if (f) params.set('from', new Date(f).toISOString());
    if (t) params.set('to', new Date(t).toISOString());
  }
  _lprApplySiteParam(params);

  // Two requests, not one. The KPI numbers come from a query that skips the
  // 3M-row temp table the charts need — measured 2.9s vs 14.6s on a 25-day
  // range — so the header fills in while the charts are still being built.
  // A generation counter drops late replies: switching period mid-flight used
  // to let the old window's numbers land on top of the new one's.
  const gen = ++_lprStatsGen;
  if (_lprStatsAbort) _lprStatsAbort.abort();
  const ac = new AbortController();
  _lprStatsAbort = ac;
  // คำตอบแต่ละก้อนมีฟิลด์ไม่ครบ (kpi / plates / noplates) — รวมทับกันทีละก้อน ไม่ให้ก้อนที่มาทีหลัง
  // ลบค่าที่ก้อนก่อนให้ไว้ · การ์ดที่ยังไม่มีค่าแสดง "…" (ดู _renderLprKpi)
  _lprKpiState = {};
  const show = (d) => { if (gen !== _lprStatsGen) return; _lprKpiState = { ..._lprKpiState, ...d }; _renderLprKpi(_lprKpiState); };
  const get = (qs) => fetch(`${API}/api/lpr/stats?${params}${qs}`, { signal: ac.signal })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
  const fail = (err) => {
    // An abort is this code cancelling its own request, not a failure — it
    // must never reach the operator as "the server errored".
    if (err.name === 'AbortError' || gen !== _lprStatsGen) return;
    // Don't swallow: a 500 used to render as fake zeros, hiding real outages
    // (e.g. Postgres /dev/shm exhaustion). Surface it instead.
    console.error('[lpr] stats load failed:', err.message);
    if (typeof showToast === 'function') {
      showToast({ title: _t('lpr.statsErr', 'โหลดสถิติป้ายทะเบียนไม่สำเร็จ'), sub: _t('lpr.statsErrSub', 'เซิร์ฟเวอร์ตอบ error — ลองรีเฟรชอีกครั้ง'), page: 'lpr' });
    }
  };
  if (_lprPeriod === 'custom') {
    // ช่วง custom ไม่มี warmer — กราฟ+KPI (ตารางสรุป ~2–3 วิ) ไม่ต้องรอตัวเลขระดับป้าย
    // (ป้ายซ้ำ/ไม่ซ้ำ/รถ-ป้ายไม่ตรงกัน · ~20 วิที่ 30 วัน) ซึ่งมาแยกทาง part=plates
    get('&noplates=1').then(d => { show(d); if (gen === _lprStatsGen) _renderLprCharts(d); }).catch(fail);
    get('&part=plates').then(show).catch(fail);
  } else {
    get('&part=kpi').then(show)
      .catch(() => { /* the full request below reports failures — don't toast twice */ });
    get('').then(d => { show(d); if (gen === _lprStatsGen) _renderLprCharts(d); }).catch(fail);
  }
  _loadWatchlistSet();
  loadLprLatest(false);
  renderLprAlarmStrip();   // RF-ALERT — overview alarm strip
  loadLprAlertCount();     // RF-ALERT — nav badge
}

function _renderLprKpi(d) {
  const el = document.getElementById('lprKpi'); if (!el) return;
  // ยังไม่ได้ตัวเลขระดับป้าย (มาทีหลังจาก part=plates หรือคำขอเต็ม) — แสดง "…" ไม่ใช่ 0 หลอก
  const pendPlates = d.local == null, pendMis = d.mismatch == null;
  // distinct readable = local (≥2, ในพื้นที่) + visitor (=1, ต่างถิ่น)
  const distinct   = (d.local ?? 0) + (d.visitor ?? 0);
  const localPct   = distinct ? Math.round((d.local   / distinct) * 100) : 0;
  const visitorPct = distinct ? Math.round((d.visitor / distinct) * 100) : 0;
  const ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const items = [
    { ka: 'var(--accent)', label: _t('lpr.kpiTotal', 'ป้ายทั้งหมด'), val: (d.total ?? 0).toLocaleString(), sub: '', subc: 'var(--text-secondary)',
      icon: ic('<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="7" y1="12" x2="11" y2="12"/><line x1="13" y1="12" x2="18" y2="12"/>') },
    { ka: 'var(--status-ok)', label: _t('lpr.kpiLocal', 'ป้ายซ้ำ'), val: pendPlates ? '…' : d.local.toLocaleString(), sub: pendPlates ? '' : d.local ? _t('lpr.viewList', 'ดูรายการ →') : `${localPct}% ${_t('lpr.inArea','ในพื้นที่')}`, subc: d.local ? 'var(--status-ok)' : 'var(--text-secondary)',
      action: d.local ? 'lprGotoLocal' : '',
      icon: ic('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>') },
    { ka: 'var(--accent)', label: _t('lpr.kpiVisitor', 'ป้ายไม่ซ้ำ'), val: pendPlates ? '…' : (d.visitor ?? 0).toLocaleString(), sub: pendPlates ? '' : `${visitorPct}% ${_t('lpr.outArea','ต่างถิ่น')}`, subc: 'var(--text-secondary)',
      icon: ic('<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>') },
    // ตัวหารคือ d.vehicles = จำนวน anprAlarm ทั้งหมด ไม่ใช่ d.total —
    // d.total นับแถวใน license_plates ซึ่งไม่มีรถของ Dahua ที่อ่านป้ายไม่ออกอยู่เลย
    // ⚠️ ว่างไว้เมื่อยังไม่มีตัวหาร (ช่วง rollup ที่ยังไม่ backfill n_anpr_ev คืน null)
    //    ปล่อยให้หารจะได้ NaN% ขึ้นจอ — การ์ดอื่นก็ใช้ sub ว่างเป็นสถานะปกติอยู่แล้ว
    { ka: 'var(--warn)', label: _t('lpr.kpiNoRead', 'ไม่ระบุ'), val: (d.noread ?? 0).toLocaleString(),
      sub: (d.vehicles > 0)
        ? `${((d.noread ?? 0) / d.vehicles * 100).toFixed(1)}% ${_t('lpr.ofVehicles', 'ของรถที่ตรวจได้')}`
        : '',
      subc: 'var(--text-secondary)',
      icon: ic('<path d="M3 3l18 18M10.5 5H19a2 2 0 0 1 2 2v8M5 7v10a2 2 0 0 0 2 2h11"/>') },
    { ka: 'var(--status-bad)', label: _t('lpr.kpiWatch', 'ตรงเฝ้าระวัง'), val: (d.watch ?? 0).toLocaleString(),
      sub: d.watch ? _t('lpr.viewSuspects', 'ดูรายการ →') : '', subc: d.watch ? 'var(--status-bad)' : 'var(--text-secondary)',
      action: d.watch ? 'lprGotoAlerts' : '',
      icon: ic('<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>') },
    // รถ-ป้ายไม่ตรงกัน — a review flag (not an accusation): clickable → search tab.
    // Amber + magnifier tone: many are just OCR plate/type misreads, so it reads as
    // "worth a look", not "system caught a crime".
    { ka: 'var(--warn)', label: _t('lpr.kpiMismatch', 'รถ-ป้ายไม่ตรงกัน'), val: pendMis ? '…' : d.mismatch.toLocaleString(),
      sub: d.mismatch ? _t('lpr.viewSuspects', 'ดูรายการ →') : '', subc: d.mismatch ? 'var(--warn)' : 'var(--text-secondary)',
      action: d.mismatch ? 'lprGotoMismatch' : '',
      icon: ic('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>') },
      // เลขเดียว (เจ้าของสั่ง 2026-08-27) — ยอดที่ยังไม่กรองถูกถอดออกจากทุกหน้า
      // เหตุผล: เราไม่ใช่คนตัดสินว่าหลักฐานใช้ได้ไหม และส่วนต่างที่กรองออกก็เอาไป
      // ทำอะไรต่อไม่ได้อยู่ดี (ไม่รู้ทะเบียน = แจ้งใครไม่ได้)
      //
      // ตัวเลขนี้ตรงกับที่ปุ่ม "ดูรายการ" จะกรองให้ และตรงกับหน้ากวดขันวินัยจราจร
      // เพราะทั้งสามอ่าน traffic_hourly_stats ก้อนเดียวกันแล้ว (2026-08-27)
      { ka: 'var(--status-bad)', label: 'ไม่สวมหมวก · พร้อมข้อมูลทะเบียน',
        val: (d.no_helmet_ok ?? 0).toLocaleString(),
        sub: d.no_helmet_ok ? _t('lpr.viewSuspects', 'ดูรายการ →') : '',
        subc: d.no_helmet_ok ? 'var(--status-bad)' : 'var(--text-secondary)',
        note: (() => {
          // เวลาที่ตัวเลขถูกคำนวณจริง — ตารางสรุปตามหลังของสดได้ถึง 15 นาที
          // บอกเวลาไว้ ผู้ใช้จะเห็นเองว่าเป็นภาพ ณ นาทีไหน ไม่ใช่ขัดกับหน้าอื่น
          const at = d.generated_at ? new Date(d.generated_at) : null;
          const stamp = (at && !isNaN(at))
            ? ` · ${_t('lpr.dataAsOf', 'ข้อมูล ณ')} ${at.toLocaleTimeString('th-TH',
                { hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
          // เหลือแค่เวลาที่คำนวณ — คำอธิบายถูกถอดออก 2026-08-27
          return stamp.replace(/^ · /, '');
        })(),
        action: d.no_helmet_ok ? 'lprGotoHelmet' : '',
      icon: ic('<path d="M3 13a9 9 0 0 1 18 0z"/><path d="M2 13h20"/>') },
    // ซ้อน 3+ — clickable → search filtered to rider_count>=3 (Dahua ITC431-only).
    { ka: 'var(--status-bad)', label: _t('lpr.kpiOverload', 'ซ้อน 3+'), val: (d.overload ?? 0).toLocaleString(),
      sub: d.overload ? _t('lpr.viewSuspects', 'ดูรายการ →') : '', subc: d.overload ? 'var(--status-bad)' : 'var(--text-secondary)',
      action: d.overload ? 'lprGotoOverload' : '',
      icon: ic('<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><circle cx="18" cy="8" r="3"/>') },
  ];
  el.innerHTML = items.map(k => `
    <div class="kpi${k.action ? ' kpi-clickable' : ''}" style="--ka:${k.ka}"${k.action ? ` data-action="${k.action}"` : ''}>
      <div class="ki" style="color:${k.ka}">${k.icon}</div>
      <div class="kl">${_esc(k.label)}</div>
      <div class="kv">${_esc(k.val)}</div>
      <div class="ks" style="color:${k.subc}">${_esc(k.sub)}</div>
      ${k.note ? `<div class="ks" style="color:var(--text-secondary)">${_esc(k.note)}</div>` : ''}
    </div>`).join('');
}

// Translate overview period (_lprPeriod) → set lprFilterFrom/To so KPI-drill searches
// use the same time window the KPI was counting. Without this, no from/to = all-time query.
function _lprApplyKpiPeriod() {
  if (typeof setDtValue !== 'function') return;
  const now = new Date();
  let from;
  switch (_lprPeriod) {
    case 'hour':      from = new Date(now - 3600 * 1000); break;
    case 'yesterday': { const y = new Date(now); y.setHours(0,0,0,0); const d = new Date(y); d.setDate(d.getDate()-1); setDtValue('lprFilterFrom', d); setDtValue('lprFilterTo', y); return; }
    case 'week':      { from = new Date(now); from.setDate(from.getDate() - ((from.getDay()+6)%7)); from.setHours(0,0,0,0); break; }
    case 'month':     from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0); break;
    case 'custom':    {
      const f = getDtValue('lprPeriodFrom'), t = getDtValue('lprPeriodTo');
      if (f) setDtValue('lprFilterFrom', new Date(f));
      if (t) setDtValue('lprFilterTo',   new Date(t));
      return;
    }
    default:          { from = new Date(now); from.setHours(0,0,0,0); }  // today
  }
  setDtValue('lprFilterFrom', from);
  setDtValue('lprFilterTo', now);
}

// KPI "สงสัยสวมทะเบียน" click → search tab filtered to mismatch suspects.
function lprGotoMismatch() {
  _lprResetFilters();
  _lprApplyKpiPeriod();
  _switchLprTab('search');
  const sel = document.getElementById('lprFilterMismatch');
  if (sel) sel.value = '1';
  loadLpr(1);
}

// KPI "ไม่ใส่หมวก" click → search filtered to no-helmet riders.
function lprGotoHelmet() {
  _lprResetFilters();
  _lprApplyKpiPeriod();
  _switchLprTab('search');
  const sel = document.getElementById('lprFilterHelmet');
  if (sel) sel.value = 'no';
  loadLpr(1);
}

// KPI "ซ้อน 3+" click → search filtered to rider_count>=3.
function lprGotoOverload() {
  _lprResetFilters();
  _lprApplyKpiPeriod();
  _switchLprTab('search');
  const sel = document.getElementById('lprFilterPassenger');
  if (sel) sel.value = '3plus';
  loadLpr(1);
}

// KPI "ป้ายซ้ำ" click → search filtered to local (duplicate) plates.
function lprGotoLocal() {
  _lprResetFilters();
  _lprApplyKpiPeriod();
  _switchLprTab('search');
  const sel = document.getElementById('lprFilterDup');
  if (sel) sel.value = 'local';
  loadLpr(1);
}

// Quick-date presets
function _lprSetRange(from, to) {
  if (typeof setDtValue === 'function') { setDtValue('lprFilterFrom', from); setDtValue('lprFilterTo', to); }
  loadLpr(1);
}
function lprQuick24h() {
  const now = new Date();
  _lprSetRange(new Date(now - 24 * 3600 * 1000), now);
}
function lprQuickWeek() {
  const now = new Date(), from = new Date(now);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));  // Monday
  from.setHours(0, 0, 0, 0);
  _lprSetRange(from, now);
}
function lprQuickMonth() {
  const now = new Date();
  _lprSetRange(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0), now);
}

// iOS Safari clips Thai y-axis tick labels to ~2 characters on horizontal bar
// charts — confirmed on-device via a 3-round diagnostic (dashboard/_diag*.html,
// deleted after this fix). Ruled out: font-loading race, missing Chart.defaults
// font family, afterFit scale.width override (set the width, clipping unchanged
// — Chart.js ignored it). Root cause: Chart.js's own tick-label measurement
// during fit() under-reports Thai text width on iOS Safari and caches a
// too-small clip region for the actual draw pass — no config knob reaches it.
// Fix: skip Chart.js's tick rendering for the y-axis (ticks.display:false),
// reserve left space via a plain layout.padding.left computed BEFORE the
// chart is constructed, and draw the labels ourselves in afterDraw.
// Do not compute the padding inside a Chart.js lifecycle hook (beforeLayout/
// afterFit) — mutating chart.options there re-triggers Chart.js's reactive
// options proxy on every layout pass, which re-runs the hook, which mutates
// again → infinite recursion (RangeError: Maximum call stack size exceeded,
// froze the tab during testing). Measuring up front avoids the proxy entirely.
function _measureThaiWidth(labels, fontPx) {
  if (!labels.length) return 0;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${fontPx}px ${Chart.defaults.font.family}`;
  return Math.ceil(Math.max(...labels.map(l => ctx.measureText(String(l)).width)));
}
// Labels draw on the LEFT of the bars (bars flush against the card's right
// edge). align:'right' (default) hugs the bar start — variable-length labels
// end up staggered since each right-edge-aligns to the same x. align:'left'
// instead pins every label to the card's left edge regardless of length.
function _thaiYAxisDrawPlugin(fontPx, align = 'right') {
  const font = `${fontPx}px ${Chart.defaults.font.family}`;
  return {
    id: `thaiYAxisLabels${fontPx}${align}`,
    afterDraw(chart) {
      const labels = (chart.data.labels || []).map(String);
      if (!labels.length) return;
      const { ctx, chartArea, scales: { y } } = chart;
      ctx.save();
      ctx.font = font;
      ctx.fillStyle = Chart.defaults.color;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      const x = align === 'left' ? 4 : chartArea.left - 4;
      labels.forEach((label, i) => ctx.fillText(label, x, y.getPixelForTick(i)));
      ctx.restore();
    },
  };
}

function _renderLprCharts(d) {
  if (typeof Chart === 'undefined') return;
  window._lprCharts.forEach(c => { try { c.destroy(); } catch {} });
  window._lprCharts = [];
  const acc = _tok('--accent'), grid = _tok('--border-hairline'), dim = _tok('--text-secondary');
  Chart.defaults.color = dim;
  const noLegend = { plugins: { legend: { display: false } }, maintainAspectRatio: false };

  const chHourly = document.getElementById('lprChHourly');
  if (chHourly) window._lprCharts.push(new Chart(chHourly, {
    type: 'bar',
    data: { labels: Array.from({ length: 24 }, (_, i) => i + ':00'), datasets: [{ data: d.hourly || [], backgroundColor: acc, borderRadius: 3, barPercentage: .8 }] },
    options: { ...noLegend, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } }, y: { grid: { color: grid }, ticks: { font: { size: 10 } }, beginAtZero: true } } },
  }));

  const chProv = document.getElementById('lprChProvince');
  const provLabels = (d.province || []).map(p => provinceLabel(p.name));
  if (chProv) window._lprCharts.push(new Chart(chProv, {
    type: 'bar',
    data: { labels: provLabels, datasets: [{ data: (d.province || []).map(p => p.n), backgroundColor: acc, borderRadius: 3, barPercentage: .7 }] },
    options: { ...noLegend, indexAxis: 'y', layout: { padding: { left: _measureThaiWidth(provLabels, 11) + 10 } }, scales: { x: { grid: { color: grid }, ticks: { font: { size: 10 } }, beginAtZero: true }, y: { grid: { display: false }, ticks: { display: false } } } },
    plugins: [_thaiYAxisDrawPlugin(11, 'left')],
  }));

  const chType = document.getElementById('lprChType');
  const vt = (d.vtype || []).filter(v => v.type && _lprVtypeVisible(v.type));
  const palette = [acc, _tok('--purple') || '#a78bfa', _tok('--status-ok'), _tok('--warn'), _tok('--status-bad'), '#14b8a6', '#e879a6', '#f59e0b', '#64748b'];
  if (chType) window._lprCharts.push(new Chart(chType, {
    type: 'doughnut',
    data: { labels: vt.map(v => _lprVType(v.type)), datasets: [{ data: vt.map(v => v.n), backgroundColor: vt.map((_, i) => palette[i % palette.length]), borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } },
  }));

  // Plate color — horizontal bar tinted by the actual DLT plate color. Data is
  // heavily white-skewed so a doughnut would be one slice; bars stay comparable.
  // 'colorful' is a gradient in _LPR_PCOLOR_HEX (no canvas fill) → solid fallback.
  const chPColor = document.getElementById('lprChPColor');
  const pcRows = (d.pcolor || []).filter(p => p.color);
  const pcolorLabels = pcRows.map(p => _lprPColorLabel(p.color));
  if (chPColor) window._lprCharts.push(new Chart(chPColor, {
    type: 'bar',
    data: { labels: pcolorLabels, datasets: [{
      data: pcRows.map(p => p.n),
      backgroundColor: pcRows.map(p => { const h = _LPR_PCOLOR_HEX[p.color]; return (h && h.startsWith('#')) ? h : '#9333ea'; }),
      // White plate bars are near-white — a hairline border reads as invisible
      // against the card surface, so give that one bar a visibly darker outline.
      borderColor: pcRows.map(p => p.color === 'white' ? dim : grid),
      borderWidth: pcRows.map(p => p.color === 'white' ? 1.5 : 1),
      borderRadius: 3, barPercentage: .7 }] },
    options: { ...noLegend, indexAxis: 'y', layout: { padding: { left: _measureThaiWidth(pcolorLabels, 11) + 10 } }, scales: { x: { grid: { color: grid }, ticks: { font: { size: 10 } }, beginAtZero: true }, y: { grid: { display: false }, ticks: { display: false } } } },
    plugins: [_thaiYAxisDrawPlugin(11, 'left')],
  }));

  // Vehicle brand — Top 10 ranking (backend LIMIT 10, '0'=ไม่ทราบ excluded).
  const chBrand = document.getElementById('lprChBrand');
  const brRows = (d.brand || []).filter(b => b.code);
  const brandLabels = brRows.map(b => _lprBrandLabel(b.code));
  if (chBrand) window._lprCharts.push(new Chart(chBrand, {
    type: 'bar',
    data: { labels: brandLabels, datasets: [{ data: brRows.map(b => b.n), backgroundColor: acc, borderRadius: 3, barPercentage: .7 }] },
    options: { ...noLegend, indexAxis: 'y', layout: { padding: { left: _measureThaiWidth(brandLabels, 11) + 10 } }, scales: { x: { grid: { color: grid }, ticks: { font: { size: 10 } }, beginAtZero: true }, y: { grid: { display: false }, ticks: { display: false } } } },
    plugins: [_thaiYAxisDrawPlugin(11)],
  }));

  // Count per camera — Top 8 horizontal bar (backend returns up to 15 sorted
  // desc; the fixed 210px card only has comfortable row-height for ~8-10
  // before labels collide — matches the brand chart's row count above).
  // camera_id → name via global `cameras`.
  const chPerCam = document.getElementById('lprChPerCam');
  const pcamRows = (d.perCamera || []).slice(0, 8);
  const _camName = (id) => { const c = (typeof cameras !== 'undefined' ? cameras : []).find(x => x.camera_id === id); return (c && c.camera_name) || id; };
  const perCamLabels = pcamRows.map(r => _camName(r.camera_id));
  if (chPerCam) window._lprCharts.push(new Chart(chPerCam, {
    type: 'bar',
    data: { labels: perCamLabels, datasets: [{ data: pcamRows.map(r => r.n), backgroundColor: acc, borderRadius: 3, barPercentage: .7 }] },
    options: { ...noLegend, indexAxis: 'y', layout: { padding: { left: _measureThaiWidth(perCamLabels, 10) + 10 } }, scales: { x: { grid: { color: grid }, ticks: { font: { size: 10 } }, beginAtZero: true }, y: { grid: { display: false }, ticks: { display: false } } } },
    plugins: [_thaiYAxisDrawPlugin(10, 'left')],
  }));

  // RF5 direction — per-camera lpr_direction. 3-state like the demo:
  // both sides assigned → in/out lines · one side → that line · none → "ผ่าน" total.
  const chDir = document.getElementById('lprChDir');
  if (chDir) {
    const dir = d.direction || { in: [], out: [], assigned: { in: 0, out: 0 } };
    const a = dir.assigned || { in: 0, out: 0 };
    const labels = Array.from({ length: 24 }, (_, i) => i + ':00');
    const line = (label, data, color) => ({ label, data: data || [], borderColor: color, backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2 });
    let datasets;
    if (a.in > 0 || a.out > 0) {
      datasets = [];
      if (a.in  > 0) datasets.push(line(_t('lpr.dirIn',  'ขาเข้า'), dir.in,  _tok('--status-ok')));
      if (a.out > 0) datasets.push(line(_t('lpr.dirOut', 'ขาออก'),  dir.out, acc));
    } else {
      datasets = [line(_t('lpr.dirPass', 'ผ่าน'), d.hourly, acc)];
    }
    window._lprCharts.push(new Chart(chDir, {
      type: 'line',
      data: { labels, datasets },
      options: { ...noLegend, plugins: { legend: { display: datasets.length > 1, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } }, y: { grid: { color: grid }, ticks: { font: { size: 10 } }, beginAtZero: true } } },
    }));
  }
}

function loadLprLatest(animate) {
  const grid = document.getElementById('lprLatestGrid');
  const params = new URLSearchParams({ limit: '8', offset: '0' });
  _lprApplySiteParam(params);
  fetch(`${API}/api/lpr?${params}`)
    .then(r => r.json())
    .then(rows => {
      window._lprLatestRows = Array.isArray(rows) ? rows : [];
      const newTop = window._lprLatestRows[0]?.id ?? null;
      const isNew = animate && newTop != null && newTop !== _lprLatestTopId;
      _lprLatestTopId = newTop;
      _renderLprGrid(window._lprLatestRows, 'lprLatestGrid', 'lprLatest');
      if (isNew) { const first = grid?.querySelector('.lpr-card'); if (first) first.classList.add('enter'); }
    })
    .catch(() => { if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--status-bad)">${_t('common.loadFailedShort','โหลดไม่สำเร็จ')}</div>`; });
}

function _lprTick() {
  if (document.hidden || _lprModalOpen) return;
  const ov = document.getElementById('lprTabOverview');
  if (!ov || ov.style.display === 'none') return;
  loadLprLatest(true);
}

// ── Latest Plates: live via WebSocket ────────────────────────────
// Polling every 12s redrew all 8 cards at once while ~67 plates had gone by —
// the operator saw a full swap of a 12% sample. The socket already carries the
// same read the map plots; every field the card needs is on raw_json (verified
// 200/200 against license_plates), so nothing has to be re-fetched per event.
//
// Reads arrive at ~5.6/s, so they are COALESCED: render immediately when the
// grid is idle, then at most once per _LPR_LIVE_FLUSH_MS. Rendering per event
// would be worse than the polling it replaces.
const _LPR_LIVE_FLUSH_MS = 2000;
let _lprLiveQueue = [], _lprLiveTimer = null, _lprLiveLastFlush = 0;

function _lprLiveOnOverview() {
  if (document.hidden || _lprModalOpen) return false;
  if (!document.getElementById('page-lpr')?.classList.contains('active')) return false;
  const ov = document.getElementById('lprTabOverview');
  return !!ov && ov.style.display !== 'none';
}

// The WS row is the events row; the grid expects the /api/lpr shape. Only
// plate_number is genuinely absent — every other field _lprCard reads already
// falls back to raw_json. mismatch_level is deliberately left unset: it comes
// from comparing a plate against its other reads, which the 60s poll fills in.
function _lprRowFromEvent(ev) {
  const rj = ev.raw_json || {};
  return {
    ...ev,
    plate_number: rj.plate || rj.data?.Object?.Text || '',
    snapshot_file: ev.snapshot_file || ev.snapshot_filename || null,
  };
}

function _lprLiveRead(ev) {
  if (!ev || ev.lite || ev.event_type !== 'anprAlarm') return;   // P5: lite has no plate to show
  if (!_lprLiveOnOverview()) return;
  const row = _lprRowFromEvent(ev);
  if (!row.plate_number) return;
  _lprLiveQueue.unshift(row);
  if (_lprLiveQueue.length > 8) _lprLiveQueue.length = 8;   // a flush shows 8 at most anyway

  const since = Date.now() - _lprLiveLastFlush;
  if (since >= _LPR_LIVE_FLUSH_MS) { _lprLiveFlush(); return; }   // leading edge: feels live
  if (!_lprLiveTimer) _lprLiveTimer = setTimeout(_lprLiveFlush, _LPR_LIVE_FLUSH_MS - since);
}

function _lprLiveFlush() {
  clearTimeout(_lprLiveTimer); _lprLiveTimer = null;
  _lprLiveLastFlush = Date.now();
  if (!_lprLiveQueue.length || !_lprLiveOnOverview()) { _lprLiveQueue.length = 0; return; }

  // Dedup by event id: the 60s poll and the socket can carry the same read, and
  // a duplicate card would also break the index the modal opens by.
  const seen = new Set(_lprLiveQueue.map(r => r.id));
  const kept = (window._lprLatestRows || []).filter(r => !seen.has(r.id));
  window._lprLatestRows = [..._lprLiveQueue, ...kept].slice(0, 8);
  _lprLiveQueue.length = 0;

  const newTop = window._lprLatestRows[0]?.id ?? null;
  const isNew = newTop != null && newTop !== _lprLatestTopId;
  _lprLatestTopId = newTop;
  _renderLprGrid(window._lprLatestRows, 'lprLatestGrid', 'lprLatest');
  if (isNew) {
    const first = document.getElementById('lprLatestGrid')?.querySelector('.lpr-card');
    if (first) first.classList.add('enter');
  }
}

// Leaving the page: stop the safety poll and drop anything queued. The timer was
// never cleared before — it survived on a guard inside _lprTick, so any future
// edit above that guard would have turned it into a silent background poller.
function _lprStopLive() {
  if (_lprTickTimer) { clearInterval(_lprTickTimer); _lprTickTimer = null; }
  clearTimeout(_lprLiveTimer); _lprLiveTimer = null;
  _lprLiveQueue.length = 0;
}

// ── Search ─────────────────────────────────────────────────────────
let _lprSearchTimer = null;
function _lprSearchDebounce() { clearTimeout(_lprSearchTimer); _lprSearchTimer = setTimeout(() => loadLpr(1), 400); }

// Camera = MultiPicker (multi-select, LPR-role cameras), scoped to the active
// site. Rebuilds when the site changes; keeps selection across normal reloads.
let _lprCamPickerSite;
function _populateLprCameras() {
  const camEl = document.getElementById('lprFilterCam');
  if (!camEl) return;
  if (camEl.options.length && _lprCamPickerSite === _lprActiveSiteId) return;
  _lprCamPickerSite = _lprActiveSiteId;
  const lprCams = (typeof cameras !== 'undefined' ? cameras : []).filter(c => c.cam_role === 'lpr');
  fillCameraSelect('lprFilterCam', siteScopedCams(lprCams, _lprActiveSiteId), { multiPicker: true });
}

function _initLprFilters() {
  // Camera = MultiPicker (multi-select). No empty "ทั้งหมด" option — 0 selected = all.
  _populateLprCameras();
  _populateLprNoReadCameras();
  // MultiPicker filters — no empty "ทั้งหมด" option (0 selected = all); refresh picker after populate.
  const mpRefresh = id => { if (typeof MultiPicker !== 'undefined') MultiPicker.refresh(id); };
  const reg = document.getElementById('lprFilterRegion');
  if (reg && !reg.options.length) { reg.innerHTML = `<option value="ไม่ทราบ">${_t('lpr.unknown','ไม่ทราบ')}</option>` + _LPR_PROVINCES.map(p => `<option value="${p}">${provinceLabel(p)}</option>`).join(''); mpRefresh('lprFilterRegion'); }
  const ty = document.getElementById('lprFilterType');
  if (ty && !ty.options.length) {
    const codes = ['twoWheelVehicle','SUVMPV','buggy','van','vehicle','truck','pickupTruck','largeBus','threeWheelVehicle','pedestrian'].filter(_lprVtypeVisible);
    ty.innerHTML = codes.map(c => `<option value="${c}">${_esc(_lprVType(c))}</option>`).join(''); mpRefresh('lprFilterType');
  }
  const vc = document.getElementById('lprFilterVColor');
  if (vc && !vc.options.length) {
    vc.innerHTML = [['black','Black'],['gray','Gray'],['white','White'],['blue','Blue'],['red','Red'],['yellow','Yellow'],['green','Green'],['brown','Brown'],['purple','Purple'],['unknown','Unknown']]
      .map(([v,k]) => `<option value="${v}">${(_APP_COLOR[k] && _APP_COLOR[k][I18N.getLang()]) || k}</option>`).join('');
    mpRefresh('lprFilterVColor');
  }
  const pc = document.getElementById('lprFilterPColor');
  if (pc && !pc.options.length) { pc.innerHTML = [['white','white'],['yellow','yellow'],['red','red'],['green','green'],['blue','blue'],['black','black'],['colorful','colorful'],['orange','orange']].map(([v,k]) => `<option value="${v}">${_t('lpr.pcolor.'+k, _LPR_PCOLOR[k])}</option>`).join('')
    + `<option value="__unknown">${_t('lpr.pcolorUnknown','ไม่ทราบประเภทป้าย')}</option>`; mpRefresh('lprFilterPColor'); }
  const hp = document.getElementById('lprFilterHasPlate');
  if (hp && !hp.options.length) hp.innerHTML = `<option value="">${_t('lpr.fAll','ทั้งหมด')}</option><option value="1">${_t('lpr.hasPlateYes','อ่านป้ายได้')}</option><option value="0">${_t('lpr.hasPlateNo','ไม่ระบุ')}</option>`;
  const ln = document.getElementById('lprFilterLane');
  if (ln && !ln.options.length) { ln.innerHTML = ['1','2','3'].map(l => `<option value="${l}">${_t('lpr.lane','เลน')} ${l}</option>`).join(''); mpRefresh('lprFilterLane'); }
  // Brand options come from the data (distinct codes + count); codes → names via _LPR_BRAND.
  // ⚠️ ช่องเดียวในฟอร์มที่โหลดรายการแบบ async — ช่องอื่นเติม option แบบ sync
  // เดิมเขียน `.catch(() => {})` กลืน error เงียบ และ `r.ok ? r.json() : []` แปลง
  // 500 เป็นลิสต์ว่าง ผลคือ MultiPicker ค้างเป็นกล่องแคบว่างเปล่าถาวร โดยไม่มี
  // อะไรบอกผู้ใช้หรือใน console เลย (เจ้าของแจ้งเอง 2026-08-31)
  // ตอนนี้: ลิสต์ว่าง = ถือว่ายังไม่สำเร็จ ไม่ยัดลง DOM และไม่ตั้ง flag ว่าโหลดแล้ว
  // เพื่อให้ครั้งหน้าที่เปิดฟอร์มลองใหม่ · error ขึ้น console จริง ๆ
  const br = document.getElementById('lprFilterBrand');
  if (br && !br.options.length) {
    fetch(`${API}/api/lpr/brands`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(list => {
        if (!Array.isArray(list) || !list.length) throw new Error('empty brand list');
        br.innerHTML = list.map(b => `<option value="${_esc(String(b.brand))}">${_esc(_lprBrandLabel(b.brand))}</option>`).join('');
        mpRefresh('lprFilterBrand');
      })
      .catch(e => console.warn('[lpr] brand filter not loaded — will retry on next open:', e.message));
  }
}

function _lprResetFilters() {
  ['lprSearchQ','lprFilterHasPlate','lprFilterDup','lprFilterMismatch','lprFilterHelmet','lprFilterPassenger','lprFilterBelt']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['lprFilterCam','lprFilterRegion','lprFilterType','lprFilterVColor','lprFilterPColor','lprFilterBrand','lprFilterLane'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) { [...sel.options].forEach(o => o.selected = false); if (typeof MultiPicker !== 'undefined') MultiPicker.refresh(id); }
  });
  if (typeof clearDtValue === 'function') { clearDtValue('lprFilterFrom'); clearDtValue('lprFilterTo'); }
  lprSetMatchMode('part', { silent: true });
}
function lprResetSearch() { _lprResetFilters(); loadLpr(1); }

// Shared filter params (no limit/offset) — used by search + CSV export so they stay in sync.
function _lprFilterParams() {
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const params = new URLSearchParams();
  const q = g('lprSearchQ');
  // เลขล้วน ≥ 8 หลัก = เลขอ้างอิงจากรายงาน PDF (events.id · ตอนนี้ 9 หลัก) ไม่ใช่ป้ายทะเบียน —
  // ป้ายไทยมีตัวอักษรเสมอ ยกเว้นรถบรรทุกที่เป็นตัวเลขล้วน 6–7 หลัก (เช่น 812930, 7002459)
  // จึงตั้งเกณฑ์ที่ 8 เพื่อไม่ให้ชนกัน · ฝั่ง server รองรับ event_id อยู่แล้ว (lpr-list.js)
  // โหมดรูปแบบ: ตัวเลขล้วนเป็นรูปแบบที่ถูกต้อง (เช่น 1234 = ป้ายที่เป็น 1234 พอดี) ไม่ใช่เลขอ้างอิงรายงาน
  if (_lprMatchMode !== 'pattern' && /^\d{8,}$/.test(q)) {
    // เลขอ้างอิงชี้ภาพใบเดียว ตัวกรองที่ค้างไว้มีแต่ทำให้หาไม่เจอ — เจ้าของเจอ 2 พ.ย. จังหวัด "ไม่ทราบ" ค้างไว้
    // (ขอบเขตไซต์ที่ผู้ใช้เห็นได้ยังบังคับที่ server ด้วย allowedSites ทุกครั้ง ไม่ขึ้นกับพารามิเตอร์ฝั่งนี้)
    params.set('event_id', q);
    return params;
  }
  if (q) params.set('q', q);
  if (q && _lprMatchMode === 'exact') params.set('exact', '1');
  if (q && _lprMatchMode === 'pattern') params.set('match', 'pattern');
  // MultiPicker multi-selects → csv params (cameras/regions/vehicle_types/…)
  const mpv = id => (typeof MultiPicker !== 'undefined') ? MultiPicker.values(id) : [];
  const setMulti = (id, key) => { const a = mpv(id); if (a.length) params.set(key, a.join(',')); };
  const hasCamPicker = mpv('lprFilterCam').length > 0;
  setMulti('lprFilterCam', 'cameras');
  // เฉพาะเส้นทางค้นหา/นับ ซึ่งยิงไป /api/lpr ที่รองรับ sites แล้ว — เร็วกว่า 13 เท่า
  if (!hasCamPicker) _lprApplySiteParam(params, { preferSites: true });
  setMulti('lprFilterRegion', 'regions');
  setMulti('lprFilterType', 'vehicle_types');
  setMulti('lprFilterVColor', 'vehicle_colors');
  setMulti('lprFilterBrand', 'vehicle_brands');
  setMulti('lprFilterPColor', 'plate_colors');
  setMulti('lprFilterLane', 'lanes');
  const hp = g('lprFilterHasPlate'); if (hp) params.set('has_plate', hp);
  const dp = g('lprFilterDup'); if (dp) params.set('dup', dp);
  const mm = g('lprFilterMismatch'); if (mm) params.set('mismatch', mm);
  const hm = g('lprFilterHelmet'); if (hm) params.set('helmet', hm);
  const ps = g('lprFilterPassenger'); if (ps) params.set('passenger', ps);
  const bt = g('lprFilterBelt'); if (bt) params.set('belt', bt);
  const f = (typeof getDtValue === 'function') ? getDtValue('lprFilterFrom') : g('lprFilterFrom');
  if (f) params.set('from', new Date(f).toISOString());
  const t = (typeof getDtValue === 'function') ? getDtValue('lprFilterTo') : g('lprFilterTo');
  if (t) params.set('to', new Date(t).toISOString());
  return params;
}

function loadLpr(page) {
  if (page) _lprPage = page;
  if (_lprPage <= 1) { _lprPage = 1; _lprPageCursors = [null, null]; }  // fresh search / first page
  const params = _lprFilterParams();
  // Guard: manual date-picker edits (e.g. dragging just the time slider) can leave
  // from > to — the query then legitimately matches nothing, which read like a
  // broken picker. Skip the fetch and say why instead of a silent "no data".
  const rf = params.get('from'), rt = params.get('to');
  if (rf && rt && new Date(rf) > new Date(rt)) {
    _lprTotal = 0; _lprExact = true; _lprHasMore = false;
    const rc = document.getElementById('lprResCount'); if (rc) rc.textContent = '0';
    const grid = document.getElementById('lprGrid');
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--status-bad)">${_t('lpr.invalidRange','ช่วงเวลาไม่ถูกต้อง — วันที่ "ตั้งแต่" อยู่หลังวันที่ "ถึง"')}</div>`;
    _renderLprPagination();
    return;
  }
  // ค้นตามรูปแบบไล่ทุกแถวในช่วงเวลา (ใช้ index ไม่ได้) — server ปฏิเสธช่วงเกิน 7 วัน · บอกก่อนยิง
  if (params.get('match') === 'pattern') {
    const pf = params.get('from'), pt = params.get('to');
    const days = pf ? ((pt ? Date.parse(pt) : Date.now()) - Date.parse(pf)) / 86400000 : Infinity;
    if (!(days <= _LPR_PATTERN_MAX_DAYS)) {
      _lprShowSearchNote(_t('lpr.patRangeTooWide', 'ค้นตามรูปแบบได้ครั้งละไม่เกิน 7 วัน — เลือกช่วงเวลาให้แคบลง'), 'warn');
      return;
    }
  }
  // ค้นบางส่วน 1–2 ตัวอักษร: server ตอบ 400 (ไล่ทั้งตาราง) — บอกผู้ใช้แทนการยิง (audit 2026-10-02 · D12)
  const _q = (params.get('q') || '').replace(/\s+/g, '');
  if (_q && _q.length < 3 && params.get('exact') !== '1' && params.get('match') !== 'pattern') {
    // ล้างตัวนับ/หน้าของผลก่อนหน้า ไม่งั้น "พบ N รายการ" ค้างข้างข้อความนี้
    _lprTotal = 0; _lprExact = true; _lprHasMore = false;
    const rc = document.getElementById('lprResCount'); if (rc) rc.textContent = '0';
    _renderLprPagination();
    const grid = document.getElementById('lprGrid');
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-secondary)">${_t('lpr.queryTooShort','พิมพ์อย่างน้อย 3 ตัวอักษร หรือเลือก "ค้นหาแบบตรงตัวเป๊ะ"')}</div>`;
    return;
  }
  params.set('limit', _LPR_LIMIT);
  // ไม่ให้คำขอหลักรอการนับอีกต่อไป — ตารางต้องขึ้นทันที ส่วนจำนวนยิงแยกแล้วเติมทีหลัง
  // เดิมรวมไว้ในคำขอเดียว ทำให้ต้องจำกัดเวลานับไว้ 3 วินาที และกรณีที่อยู่ก้ำกึ่ง
  // สลับไปมาระหว่าง "เลขจริง" กับ "มากกว่า N" ทุกครั้งที่กด ซึ่งอ่านแล้วสับสน
  // เปลี่ยนหน้าด้วยตัวกรองเดิม = ยอดเดิม ไม่ต้องนับใหม่ (เดิมนับซ้ำทุกหน้า ครั้งละ 10–20 วิ · O3)
  const countKey = params.toString();
  if (!(_lprPage > 1 && countKey === _lprCountKey)) {
    _lprCountKey = countKey;
    _lprCountSeq = (_lprCountSeq || 0) + 1;
    _lprFetchCount(new URLSearchParams(params), _lprCountSeq);
  }
  const cur = _lprPageCursors[_lprPage];
  if (cur) { params.set('before_time', cur.t); params.set('before_id', cur.id); }

  const grid = document.getElementById('lprGrid');
  if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-secondary)">${_t('common.loading','กำลังโหลด...')}</div>`;
  let est = 0;
  fetch(`${API}/api/lpr?${params}`)
    .then(r => {
      // 🔴 ต้องเช็ค r.ok (แก้ 2026-08-31): ถ้าไม่เช็ค 500 จะ resolve ปกติ แล้ว
      // Array.isArray(rows)?rows:[] ข้างล่างแปลง {error:...} เป็น [] · จากนั้น
      // _lprExact=true ประทับตราว่า "แน่นอนว่าศูนย์" ทั้งที่ความจริงคือค้นหาไม่สำเร็จ
      // และ .catch ที่เขียนข้อความ "โหลดไม่สำเร็จ" ไว้แล้วเข้าไม่ถึงเลย เพราะมันจับ
      // ได้แค่ network/parse error ไม่ใช่ HTTP error
      // เจอจริง: กรอง VEHICLE TYPE = Bus (Large) ที่ HatYai → query ใช้ 88 วินาที
      // แล้วโดน statement timeout · หน้าจอขึ้น "Found 0 items" เหมือนไม่มีรถบัสเลย
      if (r.status === 400) return r.json().catch(() => ({})).then(j => { throw Object.assign(new Error('bad request'), { code: j.error }); });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _lprHasMore = r.headers.get('X-Has-More') === '1';
      return r.json();
    })
    .then(rows => {
      window._lprRows = Array.isArray(rows) ? rows : [];
      // Store the cursor to fetch the NEXT page (last row of this page).
      if (_lprHasMore && window._lprRows.length) {
        const last = window._lprRows[window._lprRows.length - 1];
        // cursor ใช้ lp_row_id (id ของแถว license_plates) ไม่ใช่ last.id (id ของ event)
        // — backend เรียง/ตัดหน้า ด้วย (lp.detected_at, lp.id) ตั้งแต่ 2026-08-31
        // ใช้ event id เทียบกับ lp.id = ข้ามแถว/ซ้ำแถวแบบสุ่มตรงรอยต่อหน้า
        // (event_time ใช้ต่อได้ เพราะเท่ากับ detected_at ทุกแถว)
        _lprPageCursors[_lprPage + 1] = { t: last.event_time, id: last.lp_row_id ?? last.id };
      }
      // Exact total once we reach the last page; estimate otherwise.
      // หน้าสุดท้ายแล้ว = รู้ยอดจริงจากการนับหน้าเอง ไม่ต้องรอ endpoint นับ
      _lprSeen = (_lprPage - 1) * _LPR_LIMIT + window._lprRows.length;
      if (!_lprHasMore) { _lprExact = true; _lprTotal = _lprSeen; }
      _lprPaintCount();
      _renderLprGrid(window._lprRows, 'lprGrid', 'lpr');
      _renderLprPagination();
    })
    .catch((e) => {
      if (e && e.code === 'bad_pattern') return _lprShowSearchNote(_t('lpr.patBad', 'รูปแบบไม่ถูกต้อง — ใช้ได้เฉพาะ # @ ? * [ ] ตัวเลข และตัวอักษร'), 'warn');
      if (e && e.code === 'pattern_range_too_wide') return _lprShowSearchNote(_t('lpr.patRangeTooWide', 'ค้นตามรูปแบบได้ครั้งละไม่เกิน 7 วัน — เลือกช่วงเวลาให้แคบลง'), 'warn');
      if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--status-bad)">${_t('common.loadFailedShort','โหลดไม่สำเร็จ')}</div>`;
    });
}

// ── วิธีค้นป้าย: บางส่วน / ตรงตัว / ตามรูปแบบ (# @ ? * [5-9] → server แปลงเป็น regex · helpers/platePattern.js) ──
const _LPR_PATTERN_MAX_DAYS = 7;
let _lprMatchMode = 'part';

// ข้อความแทนผลค้นหา (ล้างตัวนับ/หน้าของผลก่อนหน้า ไม่งั้น "พบ N รายการ" ค้างข้างข้อความนี้)
function _lprShowSearchNote(msg, tone) {
  _lprTotal = 0; _lprExact = true; _lprHasMore = false;
  const rc = document.getElementById('lprResCount'); if (rc) rc.textContent = '0';
  _renderLprPagination();
  const grid = document.getElementById('lprGrid');
  if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:${tone === 'warn' ? 'var(--warn)' : 'var(--text-secondary)'}">${_esc(msg)}</div>`;
}

// ตามรูปแบบต้องมีช่วงเวลา — ช่องว่างอยู่ ตั้ง 24 ชม. ล่าสุดให้ในช่องวันที่ (เห็นบนจอ แก้ได้ ไม่ใช่ตั้งเงียบ ๆ)
function _lprEnsurePatternRange() {
  if (typeof getDtValue !== 'function' || typeof setDtValue !== 'function' || getDtValue('lprFilterFrom')) return;
  const now = new Date();
  setDtValue('lprFilterFrom', new Date(now.getTime() - 24 * 3600 * 1000)); setDtValue('lprFilterTo', now);
}

function lprSetMatchMode(mode, { silent = false } = {}) {
  _lprMatchMode = ['part', 'exact', 'pattern'].includes(mode) ? mode : 'part';
  document.querySelectorAll('#lprMatchSeg [data-mode]').forEach(b => {
    const on = b.dataset.mode === _lprMatchMode;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const seg = document.getElementById('lprMatchSeg'); if (seg) seg.setAttribute('aria-label', _t('lpr.matchMode', 'วิธีค้น'));
  const help = document.getElementById('lprPatternHelp'); if (help) help.hidden = _lprMatchMode !== 'pattern';
  const q = document.getElementById('lprSearchQ');
  if (q) q.placeholder = _lprMatchMode === 'pattern' ? _t('lpr.patPlaceholder', 'เช่น [5-9]#*') : _t('lpr.platePlaceholder', 'เช่น กท 4095');
  if (_lprMatchMode !== 'pattern') _lprToggleBuilder(false);
  if (silent) return;
  if (_lprMatchMode === 'pattern') _lprEnsurePatternRange();
  if (q && q.value.trim()) loadLpr(1);
}
function lprMatchModeClick(el) { lprSetMatchMode(el.dataset.mode); }

// ── ตัวช่วยสร้างรูปแบบทีละหลัก — แค่ประกอบข้อความ [5-9]#* ใส่ช่องค้นหา ตัวค้นข้างหลังตัวเดียวกัน ──
let _lprPb = null;   // { slots:[{kind,from,to,ch}], rest:true }
const _LPR_PB_KINDS = ['digit', 'range', 'thai', 'one', 'exact'];
function _lprPbToken(s) {
  if (s.kind === 'digit') return '#';
  if (s.kind === 'thai') return '@';
  if (s.kind === 'one') return '?';
  if (s.kind === 'range') { const a = Math.min(+s.from, +s.to), b = Math.max(+s.from, +s.to); return a === b ? String(a) : `[${a}-${b}]`; }
  // ระบุตัว: ตัดสัญลักษณ์ของภาษารูปแบบทิ้ง ไม่งั้น "#" ที่พิมพ์ในช่องนี้จะกลายเป็น "ตัวเลขใดก็ได้"
  return (s.ch || '').replace(/[\s#@?*[\]]/g, '').slice(0, 1) || '?';
}
function _lprPbPattern() { return _lprPb.slots.map(_lprPbToken).join('') + (_lprPb.rest ? '*' : ''); }
function _lprToggleBuilder(open) {
  const box = document.getElementById('lprPatternBuilder');
  const btn = document.querySelector('[data-action="lprPatternBuilder"]');
  if (!box) return;
  const show = open === undefined ? box.hidden : open;
  box.hidden = !show;
  if (btn) btn.setAttribute('aria-expanded', show ? 'true' : 'false');
  if (show) { if (!_lprPb) _lprPb = { slots: [{ kind: 'range', from: 5, to: 9 }, { kind: 'digit' }], rest: true }; _lprRenderBuilder(); }
}
function _lprRenderBuilder() {
  const box = document.getElementById('lprPatternBuilder');
  if (!box || !_lprPb) return;
  const digits = (sel) => Array.from({ length: 10 }, (_, d) => `<option value="${d}"${+sel === d ? ' selected' : ''}>${d}</option>`).join('');
  const kindLabel = { digit: _t('lpr.pbDigit', 'ตัวเลขใดก็ได้'), range: _t('lpr.pbRange', 'ตัวเลขช่วง'), thai: _t('lpr.pbThai', 'อักษรไทยใดก็ได้'),
    one: _t('lpr.pbOne', 'อะไรก็ได้'), exact: _t('lpr.pbExact', 'ระบุตัว') };
  const pos = _esc(_t('lpr.pbPos', 'หลักที่'));
  box.innerHTML = `<div class="lpr-pb-head">${_esc(_t('lpr.pbTitle', 'สร้างรูปแบบทีละหลัก'))}</div>
    <div class="lpr-pb-slots">${_lprPb.slots.map((s, i) => `<div class="lpr-pb-slot" data-i="${i}">
      <span class="lpr-pb-pos">${pos} ${i + 1}</span>
      <select class="form-input" data-pb="kind" id="lprPbKind${i}" aria-label="${pos} ${i + 1}">${_LPR_PB_KINDS.map(k => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${_esc(kindLabel[k])}</option>`).join('')}</select>
      ${s.kind === 'range' ? `<span class="lpr-pb-range"><select class="form-input" data-pb="from" id="lprPbFrom${i}" aria-label="${_esc(_t('lpr.pbFrom', 'ตั้งแต่'))}">${digits(s.from)}</select><span>–</span><select class="form-input" data-pb="to" id="lprPbTo${i}" aria-label="${_esc(_t('lpr.pbTo', 'ถึง'))}">${digits(s.to)}</select></span>` : ''}
      ${s.kind === 'exact' ? `<input class="form-input lpr-pb-ch" data-pb="ch" id="lprPbCh${i}" maxlength="1" value="${_esc(s.ch || '')}" aria-label="${_esc(kindLabel.exact)}">` : ''}
      <button type="button" class="lpr-pb-del" data-pb="del" aria-label="${_esc(_t('lpr.pbDel', 'ลบหลักนี้'))}"${_lprPb.slots.length < 2 ? ' disabled' : ''}>×</button>
    </div>`).join('')}</div>
    <div class="lpr-pb-foot">
      <button type="button" class="btn btn-secondary btn-sm" data-pb="add"${_lprPb.slots.length >= 10 ? ' disabled' : ''}>+ ${_esc(_t('lpr.pbAdd', 'เพิ่มหลัก'))}</button>
      <label class="lpr-pb-rest"><input type="checkbox" data-pb="rest" id="lprPbRest"${_lprPb.rest ? ' checked' : ''}> ${_esc(_t('lpr.pbRest', 'ที่เหลือไม่สน'))}</label>
      <span class="lpr-pb-out">${_esc(_t('lpr.pbResult', 'รูปแบบ'))} <code>${_esc(_lprPbPattern())}</code></span>
      <button type="button" class="btn btn-primary btn-sm" data-pb="use">${_esc(_t('lpr.pbUse', 'ค้นด้วยรูปแบบนี้'))}</button>
    </div>`;
}
function _lprPbEvent(e) {
  const t = e.target.closest('[data-pb]'); if (!t || !_lprPb) return;
  const slotEl = t.closest('.lpr-pb-slot'); const i = slotEl ? +slotEl.dataset.i : -1; const s = _lprPb.slots[i];
  const act = t.dataset.pb;
  if (e.type === 'click') {
    if (act === 'add') { _lprPb.slots.push({ kind: 'digit' }); _lprRenderBuilder(); }
    else if (act === 'del' && _lprPb.slots.length > 1) { _lprPb.slots.splice(i, 1); _lprRenderBuilder(); }
    else if (act === 'use') {
      const q = document.getElementById('lprSearchQ'); if (q) q.value = _lprPbPattern();
      lprSetMatchMode('pattern', { silent: true });
      _lprEnsurePatternRange();
      loadLpr(1);
    }
    return;
  }
  if (act === 'rest') _lprPb.rest = t.checked;
  else if (s && act === 'kind') { s.kind = t.value; if (s.kind === 'range' && s.from == null) { s.from = 0; s.to = 9; } }
  else if (s && (act === 'from' || act === 'to')) s[act] = +t.value;
  else if (s && act === 'ch') s.ch = t.value;
  // พิมพ์ในช่อง "ระบุตัว" ไม่วาดใหม่ทั้งก้อน (เคอร์เซอร์จะหลุด) — อัปเดตแค่ผลลัพธ์
  if (act === 'ch') { const out = document.querySelector('#lprPatternBuilder .lpr-pb-out code'); if (out) out.textContent = _lprPbPattern(); }
  else _lprRenderBuilder();
}
document.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('lprPatternBuilder');
  if (!box) return;
  box.addEventListener('click', _lprPbEvent);
  box.addEventListener('change', (e) => { if (e.target.dataset.pb !== 'ch') _lprPbEvent(e); });
  box.addEventListener('input', (e) => { if (e.target.dataset.pb === 'ch') _lprPbEvent(e); });
});

// จำนวนผลลัพธ์มี 3 สถานะเท่านั้น และทุกสถานะพูดความจริง:
//   กำลังนับ  → บอกว่ากำลังนับ ไม่ใช่โชว์เลขมั่ว
//   นับได้ครบ → เลขจริง ตรงกับการ์ดสรุปเสมอ
//   นับไม่ทัน → "มากกว่า N" โดย N = แถวที่เปิดดูมาแล้วจริง — เป็นจริงเสมอ
function _lprPaintCount() {
  const rc = document.getElementById('lprResCount');
  const hint = document.getElementById('lprResHint');
  if (!rc) return;
  if (_lprCountPending && !_lprExact) {
    rc.textContent = _lprSeen.toLocaleString() + '+';
    if (hint) hint.textContent = _t('lpr.counting', '· กำลังนับทั้งหมด…');
    return;
  }
  rc.textContent = (_lprExact ? '' : _t('lpr.moreThan', 'มากกว่า') + ' ')
    + (_lprExact ? _lprTotal : _lprSeen).toLocaleString();
  if (hint) hint.textContent = _lprExact ? '' : _t('lpr.narrowHint', '· แคบช่วงเวลาลงเพื่อดูจำนวนที่แน่นอน');
}

// ยิงนับแยก — ผลที่มาช้ากว่าการค้นหาครั้งใหม่ต้องทิ้ง ไม่งั้นเลขของการค้นหาเก่า
// จะเด้งมาทับผลใหม่
// ตัวเก่าที่ยังนับไม่เสร็จต้องถูกตัดทิ้งจริง ไม่ใช่แค่ทิ้งผล — เซิร์ฟเวอร์ยกเลิกคิวรีให้เมื่อสายขาด
// (2026-10-21: เปลี่ยนตัวกรองถี่ ๆ เคยทำให้นับทั้งตารางซ้อนกัน 10 ตัว)
let _lprCountAbort = null;
async function _lprFetchCount(params, seq) {
  _lprCountAbort?.abort();
  const ac = new AbortController();
  _lprCountAbort = ac;
  params.set('count', 'only');
  params.delete('limit'); params.delete('offset');
  params.delete('before_time'); params.delete('before_id');
  _lprCountPending = true; _lprExact = false;
  try {
    const r = await fetch(`${API}/api/lpr?${params}`, { credentials: 'include', signal: ac.signal });
    const j = await r.json();
    if (seq !== _lprCountSeq) return;            // มีการค้นหาใหม่แล้ว ทิ้งผลนี้
    if (j && j.exact && typeof j.n === 'number') { _lprExact = true; _lprTotal = j.n; }
  } catch { /* นับไม่ได้ก็แสดง "มากกว่า N" ตามเดิม */ }
  finally { if (seq === _lprCountSeq) { _lprCountPending = false; _lprPaintCount(); } }
}

// Export the current search (all matching rows, not just the page) to CSV.
// Reuses _lprFilterParams so the export matches what's on screen.
async function lprExportCsv() {
  const btn = document.querySelector('[data-action="lprExportCsv"]');
  // 12,000 แถวใช้เวลาราว 10 วินาที — ปุ่มที่แค่จางลงเฉย ๆ ทำให้คนกดคิดว่าไม่ทำงานแล้วกดซ้ำ
  const label0 = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.textContent = _t('lpr.exportWorking', 'กำลังเตรียมไฟล์…'); }
  try {
    const EXPORT_CAP = 20000;
    const params = _lprFilterParams();
    // export=1 บอก server ว่าเป็นการดึงไปทำไฟล์ ไม่ใช่หน้าจอ — เดิมขอ 5000 แต่ถูกตัด
    // เหลือ 200 เงียบ ๆ (เพดานของ endpoint) คนกดจึงได้ไฟล์ไม่ครบโดยไม่มีอะไรเตือน
    params.set('export', '1');
    params.set('limit', String(EXPORT_CAP));
    params.set('offset', '0');
    const res = await fetch(`${API}/api/lpr?${params}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) { alert(_t('lpr.noData', 'ไม่พบข้อมูลป้ายทะเบียน')); return; }
    // ชนเพดานเมื่อไหร่ต้องบอก ไม่ใช่ปล่อยให้ถือไฟล์ที่ขาดไปโดยไม่รู้
    if (rows.length >= EXPORT_CAP && !confirm(
      _t('lpr.exportCapped', 'ผลการค้นหามีมากกว่า {n} รายการ ไฟล์จะได้เฉพาะ {n} รายการล่าสุด\nแนะนำให้แคบช่วงเวลาลงแล้วค่อยส่งออก · ต้องการดำเนินการต่อหรือไม่?')
        .replace(/\{n\}/g, EXPORT_CAP.toLocaleString()))) return;
    const out = rows.map(ev => ({
      event_time: ev.event_time,
      camera_id: ev.camera_id || '',
      plate: (typeof lprPlateLabel === 'function' ? lprPlateLabel(ev.plate_number) : ev.plate_number) || '',
      province: ev.lp_region || ev.raw_json?.region || '',
      vehicle_type: ev.lp_vehicle_type || '',
      vehicle_color: ev.lp_vehicle_color || '',
      brand: (typeof _lprBrandLabel === 'function' ? _lprBrandLabel(ev.lp_vehicle_brand) : ev.lp_vehicle_brand) || '',
      plate_color: ev.raw_json?.plateColor || '',
      lane: ev.raw_json?.laneNo || '',
      confidence: ev.confidence ?? '',
    }));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    _downloadCsv(`lpr_search_${stamp}.csv`, out);
  } catch (e) {
    console.error('lprExportCsv:', e);
    alert(_t('common.loadFailedShort', 'โหลดไม่สำเร็จ'));
  } finally {
    if (btn) { btn.disabled = false; if (label0 !== null) btn.innerHTML = label0; }
  }
}

// ── Card grid ──────────────────────────────────────────────────────
function _renderLprGrid(rows, gridId, sourceKey) {
  const grid = document.getElementById(gridId); if (!grid) return;
  if (!rows.length) { grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-secondary)">${_t('lpr.noData','ไม่พบข้อมูลป้ายทะเบียน')}</div>`; return; }
  grid.innerHTML = rows.map((ev, idx) => _lprCard(ev, idx, sourceKey)).join('');
}

function _lprCard(ev, idx, src) {
  const rj = ev.raw_json || {};
  const noread = (typeof lprIsNoRead === 'function') && lprIsNoRead(ev.plate_number);
  const region = ev.lp_region || rj.region || '';
  const vtype = _lprVType(ev.lp_vehicle_type || rj.vehicleType || '');
  const vcolor = ev.lp_vehicle_color || rj.vehicleColor || '';
  const lane = rj.laneNo || '';
  const conf = ev.confidence != null ? ev.confidence : (rj.confidence != null ? rj.confidence : null);
  const plateColor = rj.plateColor || '';
  const isW = _lprWatchlistSet.has((ev.plate_number || '').toUpperCase());
  // thumb: synthetic plaque always (uniform, theme-consistent) — approved demo design.
  // The real camera crop is shown in the detail modal (lmReal), not on the grid.
  const thumb = (typeof lprPlaque === 'function')
    ? lprPlaque(ev.plate_number, { vehicleType: ev.lp_vehicle_type || rj.vehicleType, plateColor, region })
    : _esc(ev.plate_number);
  const { letters, digits } = _lprParsePlate(ev.plate_number);
  const bodyPlate = noread ? `<div class="lpr-plate noread">${_t('lpr.noRead','ไม่ระบุ')}</div>`
    : `<div class="lpr-plate">${letters ? `<span class="prov">${_esc(letters)}</span> ` : ''}${_esc(digits)}</div>`;
  const colorLang = vcolor ? _lprColorLang(vcolor) : '';
  const mmLevel = ev.mismatch_level || 0;
  // amber gradient (no alarm-red): more attributes differing = slightly stronger
  // amber, never status-bad — a review hint (magnifier), not an accusation.
  const mmColor = mmLevel >= 3 ? '#ea580c' : mmLevel === 2 ? '#f59e0b' : 'var(--warn)';
  // operator-dismissed plates (confirmed misreads) drop the badge
  const mmFlag = (mmLevel > 0 && !ev.mismatch_dismissed)
    ? `<span class="lpr-flag lpr-flag-mismatch" style="background:${mmColor};color:#fff">${_LPR_SEARCH_SVG}${_t('lpr.swapSuspect','ควรตรวจสอบ')}</span>`
    : '';
  // helmet='no' = motorcycle rider without a helmet (camera ITC analytic)
  const helmetFlag = (rj.helmet === 'no')
    ? `<span class="lpr-flag lpr-flag-helmet" style="background:var(--status-bad);color:#fff">${_LPR_WARN_SVG}${_t('lpr.noHelmet','ไม่ใส่หมวก')}</span>`
    : '';
  // uphone='yes' = driver using a phone (camera ITC analytic, violation)
  const uphoneFlag = (rj.uphone === 'yes')
    ? `<span class="lpr-flag lpr-flag-uphone" style="background:var(--status-bad);color:#fff">${_LPR_WARN_SVG}${_t('lpr.uphoneYes','ใช้โทรศัพท์')}</span>`
    : '';
  // riderCount>=3 = motorcycle carrying 3+ people, driver included (Dahua ITC431-only)
  const overloadFlag = (typeof rj.riderCount === 'number' && rj.riderCount >= 3)
    ? `<span class="lpr-flag lpr-flag-overload" style="background:var(--status-bad);color:#fff">${_LPR_WARN_SVG}${_t('lpr.overload','ซ้อนเกิน')}</span>`
    : '';
  return `
    <div class="lpr-card${isW ? ' flagged' : ''}" data-action="lprOpenModal" data-src="${src}" data-idx="${idx}">
      <div class="lpr-thumb">
        ${isW ? `<span class="lpr-flag">${_LPR_WARN_SVG}${_t('lpr.watchlistMatch','ป้ายตรงเฝ้าระวัง')}</span>` : ''}
        ${mmFlag}
        ${helmetFlag}
        ${uphoneFlag}
        ${overloadFlag}
        ${thumb}
      </div>
      <div class="lpr-body">
        ${bodyPlate}
        ${region ? `<div class="lpr-region">${_esc(provinceLabel(region))}</div>` : ''}
        <div class="lpr-tags">
          ${vtype ? `<span class="lpr-tag accent">${_esc(vtype)}</span>` : ''}
          ${vcolor ? `<span class="lpr-tag">${_lprColorDot(vcolor)}${_esc(colorLang)}</span>` : ''}
          ${lane ? `<span class="lpr-tag">${_t('lpr.lane','เลน')} ${_esc(lane)}</span>` : ''}
          ${rj.nonMotorManned === 'yes' ? `<span class="lpr-tag lpr-tag-passenger">${_t('lpr.passenger','คนซ้อนท้าย')}</span>` : ''}
          ${conf != null ? `<span class="lpr-tag">${_esc(conf)}%</span>` : ''}
        </div>
        <div class="lpr-meta"><span>${_esc(ev.camera_id)}</span><span>${_lprFmtTime(ev.event_time)}</span></div>
      </div>
    </div>`;
}

const _LPR_WARN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const _LPR_SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

function _renderLprPagination() {
  const el = document.getElementById('lprPagination'); if (!el) return;
  // P1 keyset — Prev/Next only (no jump-to-page; use the "ถึง" date filter to jump
  // by date). Total is exact on the last page, "≈" (planner estimate) otherwise.
  const approx = _lprExact ? '' : '≈';
  const info = `<span style="color:var(--text-secondary);font-size:12px;padding:0 8px">${_t('lpr.page','หน้า')} ${_lprPage} · ${approx}${_lprTotal.toLocaleString()} ${_t('lpr.items','รายการ')}</span>`;
  if (_lprPage <= 1 && !_lprHasMore) { el.innerHTML = info; return; }
  const prev = _lprPage > 1 ? `<button class="btn btn-secondary" style="padding:4px 12px" data-action="lprPage" data-page="${_lprPage - 1}">‹</button>` : '';
  const next = _lprHasMore ? `<button class="btn btn-secondary" style="padding:4px 12px" data-action="lprPage" data-page="${_lprPage + 1}">›</button>` : '';
  el.innerHTML = `${prev}${info}${next}`;
}

// RF4 retention fallback — image layered over a plate-plaque / vehicle-vector.
// `url` null (never captured) or 404 (pruned) → the fallback shows.
//
// 🔴 ข้อความต้องไม่ระบุสาเหตุ (แก้ 2026-08-31): เดิมเขียนว่า "ถูกลบแล้ว" ซึ่งจริง
// เฉพาะกรณีหมดอายุตาม lpr_image_retention_days · อีกกรณีคือรูปไม่เคยมาถึงเลย —
// dahua-cgi.js:1430 เขียน plate_image ลง DB แบบล่วงหน้าเพื่อเปิดที่ให้ late-cutout
// recovery มาวางไฟล์ทีหลัง ถ้า recovery ไม่สำเร็จก็ไม่มีไฟล์ · วัดจริง 2026-08-31:
// hdy-anpr-bigc1 ไม่มีไฟล์ 1,456 จาก 3,249 ใบในชั่วโมงเดียว (45%) แต่ DB บอกว่ามี
// ครบ 100% ทุกไซต์ · หน้านี้ไม่มีค่า retention ในมือ (มีแต่ในคอมเมนต์) จึงแยกสอง
// กรณีไม่ได้ — พูดสิ่งที่จริงทั้งสองกรณีดีกว่าเดาแล้วผิดครึ่งหนึ่ง
function _lprMediaBox(url, fallbackHtml) {
  return `<div class="lpr-media">${fallbackHtml}${url ? `<img class="lpr-media-img" src="${url}" loading="lazy" decoding="async" data-err="hide">` : ''}</div>`;
}
function _lprMediaFallback(kind, ev, ctx) {
  if (kind === 'plate') {
    const pl = (typeof lprPlaque === 'function')
      ? lprPlaque(ev.plate_number, { vehicleType: ctx.vtype, plateColor: ctx.plateColor, region: ctx.region })
      : _esc(ev.plate_number);
    return `<div class="lpr-imggone plate"><div class="ig-plaque">${pl}</div><div class="ig-cap">${_t('lpr.imgGonePlate', 'ไม่มีภาพต้นฉบับ · แสดงทะเบียนที่อ่านได้')}</div></div>`;
  }
  const veh = (typeof lprVehicleSvg === 'function') ? lprVehicleSvg(ctx.vtype) : '';
  const vt  = _esc(_lprVType(ctx.vtype || '') || '');
  const col = ctx.vcolorLabel ? ` · ${_esc(ctx.vcolorLabel)}` : '';
  return `<div class="lpr-imggone"><div class="ig-veh">${veh}</div><div class="ig-cap">${_t('lpr.imgGoneScene', 'ไม่มีภาพต้นฉบับ')}<br><small>${vt}${col}</small></div></div>`;
}

// ── Detail modal ───────────────────────────────────────────────────
// Drill-down back stack — when a repeat/mismatch row opens a prior read, the
// current ev is pushed here so the ← back button can return to it. A fresh open
// from a grid (src is an index/string) starts a new context (cleared below).
let _lprModalStack = [];

function _lprOpenModal(src, idx) {
  // ponytail: accepts direct ev object as first arg (used by mismatch row click)
  const ev = (src && typeof src === 'object') ? src
    : (src === 'lprLatest' ? window._lprLatestRows : src === 'noread' ? window._lprNoReadRows : window._lprRows)?.[idx];
  if (!ev) return;
  if (typeof src !== 'object') _lprModalStack = [];   // fresh grid open → reset drill history
  window._lprCurrentEv = ev;
  const rj = ev.raw_json || {};
  const region = ev.lp_region || rj.region || '';
  const vcolor = ev.lp_vehicle_color || rj.vehicleColor || '';
  const plateColor = rj.plateColor || '';
  const conf = ev.confidence != null ? ev.confidence : (rj.confidence != null ? rj.confidence : null);
  const brand = ev.lp_vehicle_brand || rj.vehicleBrand || '';
  const noread = (typeof lprIsNoRead === 'function') && lprIsNoRead(ev.plate_number);

  const cropUrl = ev.plate_image ? `${API}/snapshots/${_esc(ev.plate_image)}` : null;
  const sceneUrl = ev.snapshot_file ? `${API}/snapshots/${_esc(ev.snapshot_file)}` : null;
  // migration 117 — "view full" / "save image" get the server-burned-in box
  // when the opt-in full-image setting is on; the in-modal ?w=960 (SNAP_W.scene) thumbnail
  // above keeps using the live DOM overlay instead (no need to burn in what's
  // already drawn on screen). eid lets the server look up the authoritative
  // bbox itself rather than trust box coordinates from the URL.
  const sceneFullUrl = (sceneUrl && window._lprBboxCfg?.fullImage && ev.id)
    ? `${sceneUrl}?bbox=1&eid=${ev.id}` : sceneUrl;
  // RF4 — when the JPG is gone (retention-pruned at lpr_image_retention_days, or
  // missing) but the row is kept: show a fallback (plate→plaque, scene→vehicle
  // vector) layered BEHIND the <img>. The image covers it when present; on 404 the
  // global data-err="hide" handler hides the img → the fallback shows. No flash.
  const _vtype = ev.lp_vehicle_type || rj.vehicleType || '';
  const _fbCtx = { vtype: _vtype, plateColor, region, vcolorLabel: vcolor ? _lprColorLang(vcolor) : '' };
  document.getElementById('lmReal').innerHTML  = _lprMediaBox(cropUrl,  _lprMediaFallback('plate', ev, _fbCtx));
  // Display a w=960 thumbnail in the modal (≈120KB vs ≈600KB full); the full
  // sceneUrl is kept for the "view full" + download buttons below.
  document.getElementById('lmScene').innerHTML = _lprMediaBox(sceneUrl ? sceneUrl + `?w=${SNAP_W.scene}` : null, _lprMediaFallback('scene', ev, _fbCtx));

  // Bounding box overlay — camera reports PlateRect/vehicelRect on a
  // normalized 0-1000 grid (not raw sensor pixels, not tied to any resize
  // width — verified live 2026-08-06, model iDS-2CD9396-HIS, plate box 3/3
  // and vehicle box 3/3 landed exactly on target). Only that model is
  // confirmed across the 16 push_only LPR cameras in cameras-config.json —
  // _lprBboxInRange below is a bail, not a scale conversion: a
  // differently-scaled camera (e.g. raw pixels) will commonly overflow 1000
  // and skip the box rather than draw it wrong.
  // Gated by Settings › LPR (migration 117), NOT the per-camera
  // overlay_show_bbox flag the Snapshots page uses — deliberately a
  // separate, LPR-specific on/off so this feature has one place to control
  // (the "หมวด LPR" the owner asked for), independent of the Dahua/Hik
  // Smart-Event zone toggle that flag was built for.
  const sceneImgEl = document.getElementById('lmScene').querySelector('img');
  if (sceneImgEl && typeof attachSnapOverlay === 'function') {
    const cfg = window._lprBboxCfg || { vehicle: true, plate: false };
    const shapes = [];
    if (cfg.vehicle && _lprBboxInRange(ev.vehicle_bbox_x, ev.vehicle_bbox_y, ev.vehicle_bbox_width, ev.vehicle_bbox_height)) {
      shapes.push({
        kind: 'bracket',
        x1: ev.vehicle_bbox_x / 1000, y1: ev.vehicle_bbox_y / 1000,
        x2: (ev.vehicle_bbox_x + ev.vehicle_bbox_width) / 1000, y2: (ev.vehicle_bbox_y + ev.vehicle_bbox_height) / 1000,
      });
    }
    if (cfg.plate && _lprBboxInRange(ev.bbox_x, ev.bbox_y, ev.bbox_width, ev.bbox_height)) {
      shapes.push({
        kind: 'box',
        x1: ev.bbox_x / 1000, y1: ev.bbox_y / 1000,
        x2: (ev.bbox_x + ev.bbox_width) / 1000, y2: (ev.bbox_y + ev.bbox_height) / 1000,
      });
    }
    if (shapes.length) attachSnapOverlay(sceneImgEl, shapes);
  }
  document.getElementById('lmPlaque').innerHTML = (typeof lprPlaque === 'function')
    ? lprPlaque(ev.plate_number, { vehicleType: ev.lp_vehicle_type || rj.vehicleType, plateColor, region, big: true, showProv: true })
    : _esc(ev.plate_number);

  const dot = vcolor ? _lprColorDot(vcolor) : '';
  const plateTxt = (typeof lprPlateLabel === 'function') ? lprPlateLabel(ev.plate_number) : ev.plate_number;
  const pcHex = _LPR_PCOLOR_HEX[plateColor] || 'var(--surface-overlay)';
  const rows = [
    [_t('lpr.watchlistPlate', 'ป้ายทะเบียน'), _esc(plateTxt)],
    region ? [_t('lpr.region', 'จังหวัด'), _esc(provinceLabel(region))] : null,
    [_t('lpr.fType', 'ประเภทรถ'), _esc(_lprVType(ev.lp_vehicle_type || rj.vehicleType || '')) || '–'],
    vcolor ? [_t('lpr.vehicleColor', 'สีรถ'), `${dot}${_esc(_lprColorLang(vcolor))}`] : null,
    plateColor ? [_t('lpr.plateColor', 'สีป้าย'), `<span class="lm-pswatch" style="background:${pcHex}"></span>${_esc(_lprPColorLabel(plateColor))}`] : null,
    rj.laneNo ? [_t('lpr.lane', 'เลน'), _esc(rj.laneNo)] : null,
    // Camera-reported speed suppressed entirely (owner request 2026-07-23) —
    // unreliable for cars too now, not just two-wheelers (e.g. 229 km/h on a
    // car cruising normal traffic). Still kept in raw_json. Re-enable only
    // once a real radar sensor feeds this field.
    null,
    conf != null ? [_t('lpr.dConf', 'ความมั่นใจ'), `${_esc(conf)}%`] : null,
    (rj.helmet === 'no' || rj.helmet === 'yes')
      ? [_t('lpr.helmet', 'หมวกกันน็อค'), rj.helmet === 'no'
          ? `<span style="color:var(--status-bad);font-weight:700">${_t('lpr.noHelmet', 'ไม่ใส่หมวก')}</span>`
          : _t('lpr.hasHelmet', 'ใส่หมวก')]
      : null,
    (rj.uphone === 'yes')
      ? [_t('lpr.uphone', 'โทรศัพท์'), `<span style="color:var(--status-bad);font-weight:700">${_t('lpr.uphoneYes', 'ใช้โทรศัพท์')}</span>`]
      : null,
    (rj.nonMotorManned === 'yes')
      ? [_t('lpr.passenger', 'คนซ้อนท้าย'), _t('lpr.has', 'มี')]
      : null,
    brand ? [_t('lpr.brand','ยี่ห้อ'), _esc(_lprBrandLabel(brand))] : null,
    [_t('lpr.dCam', 'กล้อง'), _esc(ev.camera_id)],
    [_t('lpr.dTime', 'เวลา'), _lprFmtTime(ev.event_time)],
  ].filter(Boolean);
  document.getElementById('lmData').innerHTML = rows.map(([k, v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join('');

  // Seatbelt remark — pilot/vicepilot safebelt live only in rawXml (2000-char slice,
  // already shipped in raw_json). Camera fires this ONLY on forward/oncoming vehicles
  // where the windshield is visible (verified: 0 on reverse) — a real detection, but
  // camera-reported + soft wording (PDPA) with a link to the full scene to verify.
  const rmk = document.getElementById('lmRemark');
  if (rmk) {
    const xml = rj.rawXml || '';
    const belt = t => (xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];
    const pilotNo = belt('pilotsafebelt') === 'no', vicNo = belt('vicepilotsafebelt') === 'no';
    if (pilotNo || vicNo) {
      const subj = (pilotNo && vicNo) ? _t('lpr.beltBoth', 'ผู้ขับขี่และผู้โดยสาร')
        : pilotNo ? _t('lpr.beltPilot', 'ผู้ขับขี่') : _t('lpr.beltVice', 'ผู้โดยสาร');
      const warn = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      rmk.innerHTML = `${warn}<span>${_t('lpr.camDetected', 'กล้องตรวจพบ')}: ${subj} ${_t('lpr.beltRemark', 'มีแนวโน้มไม่คาดเข็มขัดนิรภัย')}</span>`
        + (sceneUrl ? `<button type="button" class="lm-rmk-link">${_t('lpr.beltVerify', 'ตรวจสอบภาพเต็ม')}</button>` : '');
      if (sceneUrl) rmk.querySelector('.lm-rmk-link')?.addEventListener('click', () => window.open(sceneFullUrl, '_blank', 'noopener'));
    } else rmk.innerHTML = '';
  }

  // View-full + download act on the full scene snapshot (the main evidence shot)
  const acts = document.getElementById('lmActions');
  const sceneEl = document.getElementById('lmScene');
  // Zoom overlay — magnifier button on top of the scene image
  const existZoom = sceneEl && sceneEl.querySelector('.lm-zoom-btn');
  if (existZoom) existZoom.remove();
  if (sceneEl && sceneUrl) {
    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'lm-zoom-btn';
    zoomBtn.title = _t('lpr.viewFull', 'ดูรูปเต็ม');
    zoomBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="15.65" y2="15.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg>';
    zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); window.open(sceneFullUrl, '_blank', 'noopener'); });
    sceneEl.appendChild(zoomBtn);
  }
  if (acts) {
    // ← back to the previous read — shown whenever there's drill history (a
    // repeat/mismatch row was clicked to get here), independent of snapshot.
    const backSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    const backBtn = _lprModalStack.length
      ? `<button class="btn btn-secondary lm-actbtn" data-action="lprModalBack">${backSvg}${_t('lpr.modalBack','ย้อนกลับ')}</button>`
      : '';
    let rest = '';
    if (sceneUrl) {
      const d = new Date(ev.event_time);
      const stamp = isNaN(d) ? '' : `_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
      const fname = `lpr_${String(plateTxt).replace(/[^\w฀-๿]+/g, '')}${stamp}.jpg`;
      const clockSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>';
      const dlSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>';
      rest =
        `<button class="btn btn-secondary lm-actbtn" data-action="lprSearchThisPlate" data-plate="${_esc(ev.plate_number || '')}">${clockSvg}${_t('lpr.search24h','ย้อนหลัง 24 ชม.')}</button>` +
        `<button class="btn btn-secondary lm-actbtn" data-action="lprSaveImg" data-url="${_esc(sceneFullUrl)}" data-name="${_esc(fname)}">${dlSvg}${_t('lpr.saveImg','บันทึกรูป')}</button>`;
    }
    acts.innerHTML = backBtn + rest;
  }

  // Plate-swap comparison — only when flagged. Fetch the plate's recent reads (30d)
  // and show the temporal sequence, highlighting which attributes differ across reads.
  const mmBox = document.getElementById('lmMismatch');
  const rpBox = document.getElementById('lmRepeats');
  if (rpBox) rpBox.innerHTML = '';
  if (mmBox) {
    mmBox.innerHTML = '';
    if ((ev.mismatch_level || 0) > 0 && !noread) {
      _lprRenderMismatch(mmBox, ev);
    } else if (rpBox && !noread && region) {
      // Repeat-plate history — only when NOT already flagged as a mismatch
      // (mismatch's own 30d timeline covers that case; showing both would be
      // two timelines in one modal). "region" (declared above from
      // ev.lp_region||rj.region) must be present — without a province, an
      // exact plate+province match can't be defined.
      _lprRenderRepeats(rpBox, ev, region);
    }
  }

  _lprModalOpen = true;
  document.getElementById('lprModal').style.display = 'flex';
}

// Render the "สงสัยสวมทะเบียน" comparison block: a per-read timeline with the
// conflicting attribute (type / สี / ยี่ห้อ) highlighted. data-id guards stale fetch.
function _lprRenderMismatch(box, ev) {
  box._mmEv = ev;
  const lvl = ev.mismatch_level || 0;
  const dismissed = !!ev.mismatch_dismissed;
  const color = dismissed ? 'var(--text-secondary)' : (lvl >= 3 ? '#ea580c' : lvl === 2 ? '#f59e0b' : 'var(--warn)');
  box.dataset.plate = ev.plate_number;
  const btn = `<button type="button" class="lm-mm-btn${dismissed ? ' rearm' : ''}" data-action="lprMismatchDismiss" data-plate="${_esc(ev.plate_number)}" data-dismissed="${dismissed ? '1' : '0'}">${dismissed ? _t('lpr.swapRearm','คืนสถานะควรตรวจสอบ') : _t('lpr.swapDismiss','ปัดตก — อ่านผิด')}</button>`;
  const searchBtn = `<button type="button" class="lm-mm-btn lm-mm-search-btn" data-action="lprSearchThisPlate" data-plate="${_esc(ev.plate_number)}">${_LPR_SEARCH_SVG}${_t('lpr.searchThisPlate','ค้นหาป้ายนี้')}</button>`;
  const dismissedNote = dismissed
    ? `<div class="lm-mm-dismissed">${_t('lpr.swapDismissedTag','ปัดตกแล้ว — ไม่นับเป็นรายการตรวจสอบ')}${ev.mismatch_dismissed_by ? ` · ${_t('lpr.byUser','โดย')} ${_esc(ev.mismatch_dismissed_by)}` : ''}</div>`
    : '';
  box.innerHTML = `<div class="lm-mm-head" style="color:${color}"><span>${_LPR_SEARCH_SVG}${_t('lpr.swapSuspectTitle','ป้ายเดียวกัน อ่านลักษณะรถต่างกัน')}</span><div class="lm-mm-btns">${searchBtn}${btn}</div></div>
    ${dismissedNote}
    <div class="lm-mm-loading">${_t('common.loading','กำลังโหลด...')}</div>`;
  // Display window (7d) is intentionally shorter than the 30d detection window
  // (lpr-query.js mismatch_level) — the "ค้นหาป้ายนี้" button pulls unbounded
  // history if the reviewer needs to see evidence older than 7 days.
  fetch(`${API}/api/lpr/plate-history?plate=${encodeURIComponent(ev.plate_number)}&hours=168`)
    .then(r => r.json())
    .then(reads => {
      if (box.dataset.plate !== ev.plate_number) return;   // stale — modal moved on
      const list = Array.isArray(reads) ? reads : [];
      window._lprMmRows = list;  // stored for row-click handler
      // which attributes actually vary across reads → highlight those columns
      const distinct = (k) => new Set(list.map(r => r[k]).filter(v => v && v !== 'unknown' && v !== 'ไม่ทราบ')).size;
      const tVary = distinct('vehicle_type') >= 2, cVary = distinct('vehicle_color') >= 2, bVary = distinct('vehicle_brand') >= 2, rVary = distinct('region') >= 2;
      const cell = (v, vary, render) => `<span class="lm-mm-cell${vary ? ' vary' : ''}">${v ? render(v) : '–'}</span>`;
      const rowsHtml = list.map((r, i) => `
        <div class="lm-mm-row lm-mm-row-click" data-action="lprMmOpenRow" data-idx="${i}">
          <span class="lm-mm-time">${_lprFmtTime(r.event_time)}</span>
          ${cell(r.vehicle_type, tVary, v => _esc(_lprVType(v) || v))}
          ${cell(r.vehicle_color, cVary, v => `${_lprColorDot(v)}${_esc(_lprColorLang(v))}`)}
          ${cell(r.vehicle_brand, bVary, v => _esc(typeof _lprBrandLabel === 'function' ? _lprBrandLabel(v) : v))}
          ${cell(r.region, rVary, v => _esc(provinceLabel(v)))}
          <span class="lm-mm-cam">${_esc(r.camera_id || '')}</span>
        </div>`).join('');
      const hdr = `<div class="lm-mm-row lm-mm-hdr">
          <span class="lm-mm-time">${_t('lpr.dTime','เวลา')}</span>
          <span>${_t('lpr.fType','ประเภทรถ')}</span><span>${_t('lpr.vehicleColor','สีรถ')}</span><span>${_t('lpr.brand','ยี่ห้อ')}</span><span>${_t('lpr.region','จังหวัด')}</span>
          <span class="lm-mm-cam">${_t('lpr.dCam','กล้อง')}</span>
        </div>`;
      // region mismatch = OCR misread signal (informational), NOT a swap trigger
      const regionNote = rVary ? `<div class="lm-mm-regionnote">${_LPR_WARN_SVG}${_t('lpr.swapRegionNote','จังหวัดอ่านไม่ตรงกัน — มักเป็นการอ่านผิด ไม่ใช่หลักฐานสวมป้าย')}</div>` : '';
      box.querySelector('.lm-mm-loading').outerHTML =
        `<div class="lm-mm-note">${_t('lpr.swapSuspectNote','ช่องที่ไฮไลต์คือจุดที่ไม่ตรง')}</div>
         <div class="lm-mm-table">${hdr}${rowsHtml}</div>${regionNote}`;
    })
    .catch(() => {
      if (box.dataset.plate === ev.plate_number) {
        const l = box.querySelector('.lm-mm-loading'); if (l) l.textContent = _t('common.loadFailedShort','โหลดไม่สำเร็จ');
      }
    });
}

// Repeat-plate history — plain (no variance-highlight) timeline of the same
// plate+province seen again in the last 24h. Only shown when NOT a mismatch
// (see caller) — a real repeat, not a swap suspect. Caps display at 6 with an
// overflow notice (LIMIT 7 → if 7 come back, 7th row means "more exist").
function _lprRenderRepeats(box, ev, region) {
  box.dataset.plate = ev.plate_number;   // stale-fetch guard (set before the async gap)
  fetch(`${API}/api/lpr/plate-history?plate=${encodeURIComponent(ev.plate_number)}&region=${encodeURIComponent(region)}&hours=24&limit=7`)
    .then(r => r.json())
    .then(reads => {
      if (box.dataset.plate !== ev.plate_number) return;   // stale — modal moved on
      const list = Array.isArray(reads) ? reads : [];
      if (list.length < 2) { box.innerHTML = ''; return; }  // nothing to show
      const overflow = list.length > 6;
      const shown = list.slice(0, 6);
      window._lprRepeatRows = shown;   // stored for row-click (open that read + back)
      // คอลัมน์ปรับตามประเภทรถ — วัดจริง 7 วัน (2026-08-16):
      //   มอเตอร์ไซค์/สามล้อ : ยี่ห้อ 0.0% · สีรถ 8-31% · แต่ติดธงหมวก 25-33%
      //   รถ 4 ล้อ           : สีรถ 100% · ยี่ห้อ 87-99% · แต่ติดธงหมวก 0.0%
      // ⇒ โชว์คอลัมน์ชุดเดียวให้ทั้งสองแบบ = มีคอลัมน์ว่างเปล่าเสมอฝั่งใดฝั่งหนึ่ง
      const isMoto = (t) => t === 'twoWheelVehicle' || t === 'threeWheelVehicle';
      // ยึดประเภทของ "คันที่เปิดดูอยู่" เป็นตัวตัดสิน ไม่ใช่รายแถว — ไม่งั้นหัวตารางกับแถวไม่ตรงกัน
      const motoMode = isMoto(ev.lp_vehicle_type || (ev.raw_json || {}).vehicleType);

      const rowsHtml = shown.map((r, i) => {
        const mid = motoMode
          ? `<span class="${r.no_helmet ? 'lm-mm-bad' : ''}">${
               r.no_helmet ? _t('lpr.noHelmet','ไม่ใส่หมวก') : _t('lpr.hasHelmet','ใส่หมวก')}</span>
             <span>${_esc(r.plate_color
                 ? _t('lpr.pcolor.' + r.plate_color, _LPR_PCOLOR[r.plate_color] || r.plate_color)
                 : _t('lpr.pcolorUnknown','ไม่ทราบประเภทป้าย'))}</span>`
          : `<span>${r.vehicle_color ? `${_lprColorDot(r.vehicle_color)}${_esc(_lprColorLang(r.vehicle_color))}` : '–'}</span>
             <span>${_esc((typeof _lprBrandLabel === 'function' ? _lprBrandLabel(r.vehicle_brand) : r.vehicle_brand) || '–')}</span>`;
        return `
        <div class="lm-mm-row lm-mm-row-click" data-action="lprRepeatOpenRow" data-idx="${i}">
          <span class="lm-mm-time">${_lprFmtTime(r.event_time)}</span>
          <span>${_esc(_lprVType(r.vehicle_type) || r.vehicle_type || '–')}</span>
          ${mid}
          <span class="lm-mm-loc">${_esc(r.camera_name || '')}</span>
          <span class="lm-mm-cam">${_esc(r.camera_id || '')}</span>
        </div>`; }).join('');

      const midHdr = motoMode
        ? `<span>${_t('lpr.helmet','หมวกกันน็อค')}</span><span>${_t('lpr.plateColor','ประเภทป้าย')}</span>`
        : `<span>${_t('lpr.vehicleColor','สีรถ')}</span><span>${_t('lpr.brand','ยี่ห้อ')}</span>`;
      const hdr = `<div class="lm-mm-row lm-mm-hdr">
          <span class="lm-mm-time">${_t('lpr.dTime','เวลา')}</span>
          <span>${_t('lpr.fType','ประเภทรถ')}</span>${midHdr}
          <span class="lm-mm-loc">${_t('lpr.location','จุดติดตั้ง')}</span>
          <span class="lm-mm-cam">${_t('lpr.dCam','กล้อง')}</span>
        </div>`;
      const moreBtn = overflow
        ? `<div class="lm-mm-regionnote">${_t('lpr.repeatMore','มีข้อมูลมากกว่านี้')} — <button type="button" class="lm-mm-btn lm-mm-search-btn" data-action="lprSearchThisPlate" data-plate="${_esc(ev.plate_number)}">${_LPR_SEARCH_SVG}${_t('lpr.searchThisPlate','ค้นหาป้ายนี้')}</button></div>`
        : '';
      box.innerHTML = `<div class="lm-mm-head" style="color:var(--accent)"><span>${_t('lpr.repeatTitle','ป้ายนี้ผ่านซ้ำใน 24 ชม.ที่ผ่านมา')}</span></div>
         <div class="lm-mm-table">${hdr}${rowsHtml}</div>${moreBtn}`;
    })
    .catch(() => { if (box.dataset.plate === ev.plate_number) box.innerHTML = ''; });
}

// Operator toggles plate-swap suspicion: POST=dismiss (false positive), DELETE=re-arm.
async function lprMismatchDismiss(el) {
  const plate = el.dataset.plate;
  const isDismissed = el.dataset.dismissed === '1';
  const box = document.getElementById('lmMismatch');
  const ev = box && box._mmEv;
  if (!plate || !ev) return;
  try {
    if (!isDismissed) {
      const reason = prompt(_t('lpr.swapDismissReason', 'เหตุผล (เช่น จังหวัดอ่านผิด) — เว้นว่างได้:'), '');
      if (reason === null) return;  // cancelled
      const r = await fetch(`${API}/api/lpr/mismatch/${encodeURIComponent(plate)}/dismiss`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
      if (!r.ok) throw new Error('dismiss failed');
      const d = await r.json();
      ev.mismatch_dismissed = true; ev.mismatch_dismissed_by = d.dismissed_by;
    } else {
      if (!confirm(_t('lpr.swapRearmConfirm', 'คืนสถานะ "ควรตรวจสอบ" ให้ป้ายนี้?'))) return;
      const r = await fetch(`${API}/api/lpr/mismatch/${encodeURIComponent(plate)}/dismiss`, { method: 'DELETE' });
      if (!r.ok) throw new Error('rearm failed');
      ev.mismatch_dismissed = false;
    }
    // propagate to in-memory rows so grid badges reflect it on next render
    [window._lprRows, window._lprLatestRows].forEach(arr => (arr || []).forEach(r => {
      if (r.plate_number === plate) { r.mismatch_dismissed = ev.mismatch_dismissed; r.mismatch_dismissed_by = ev.mismatch_dismissed_by; }
    }));
    _lprRenderMismatch(box, ev);
  } catch (e) { console.error('[lpr] mismatch dismiss:', e.message); }
}
function lprSearchThisPlate(el) {
  const plate = el.dataset.plate;
  if (!plate) return;
  // ปุ่มนี้ใช้ร่วมกับ modal ที่หน้าอื่นเปิดได้ด้วย (เช่น กวดขันวินัยจราจร) — ถ้าไม่สลับ
  // หน้าหลักมาที่ LPR ก่อน โค้ดข้างล่างจะไปแก้ DOM ของหน้า LPR ที่ซ่อนอยู่เบื้องหลังเงียบ ๆ
  showPage('lpr', document.querySelector('.nav-item[data-page="lpr"]'));
  _lprCloseModal();
  _lprResetFilters();
  _switchLprTab('search');
  const q = document.getElementById('lprSearchQ');
  if (q) q.value = plate;
  const now = new Date(), from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (typeof setDtValue === 'function') { setDtValue('lprFilterFrom', from); setDtValue('lprFilterTo', now); }
  loadLpr(1);
}
// Shared: open one prior read (from a mismatch/repeat row) as a full modal,
// pushing the current modal onto the back stack so ← returns to it. The read
// rows come from /api/lpr/plate-history (id, time, camera, snapshot, crop, type,
// color, brand, region) — same field set the mismatch drill already used.
// backTo lets a caller say where ย้อนกลับ should land. Without it the stack
// holds the read we drilled from, which is right for the mismatch and repeat
// tables — they live inside this same modal. The alert modal is a different
// modal, so it has to hand itself in explicitly.
function _lprOpenRead(r, plate, backTo) {
  if (!r) return;
  if (backTo) _lprModalStack.push(backTo);
  else if (window._lprCurrentEv) _lprModalStack.push(window._lprCurrentEv);
  _lprOpenModal({
    plate_number: plate,
    event_time: r.event_time,
    camera_id: r.camera_id,
    snapshot_file: r.snapshot_file,
    plate_image: r.plate_image,
    lp_vehicle_type: r.vehicle_type,
    lp_vehicle_color: r.vehicle_color,
    lp_vehicle_brand: r.vehicle_brand,
    lp_region: r.region,
    raw_json: {},
    mismatch_level: 0,
  });
}
function lprMmOpenRow(el) {
  _lprOpenRead((window._lprMmRows || [])[+el.dataset.idx],
    document.getElementById('lmMismatch')?.dataset.plate || '');
}
function lprRepeatOpenRow(el) {
  _lprOpenRead((window._lprRepeatRows || [])[+el.dataset.idx],
    document.getElementById('lmRepeats')?.dataset.plate || '');
}
function lprModalBack() {
  const prev = _lprModalStack.pop();   // popped → not re-pushed (src is an object)
  if (!prev) return;
  // Drilled in from a watch-list alert rather than from another read — go back
  // to the alert, not to a plate detail that was never on screen.
  if (prev.__backToAlert) {
    _lprCloseModal();
    (prev.__backToAlert.__isGs ? lprOpenGsAlarmRow : lprOpenAlertRow)(prev.__backToAlert);
    return;
  }
  _lprOpenModal(prev);
}
function _lprCloseModal() { _lprModalOpen = false; const m = document.getElementById('lprModal'); if (m) m.style.display = 'none'; }

// ── Watchlist ──────────────────────────────────────────────────────
let _wlFilter = 'all';
function _groupById(id) { return _lprGroups.find(g => g.id === id); }

function _loadGroups(cb) {
  fetch(`${API}/api/lpr/watchlist/groups`).then(r => r.json())
    .then(rows => { _lprGroups = Array.isArray(rows) ? rows : []; if (cb) cb(); })
    .catch(() => { if (cb) cb(); });
}

function _loadWatchlistSet() {
  fetch(`${API}/api/lpr/watchlist`).then(r => r.json())
    .then(rows => { _lprWatchlistSet = new Set(rows.filter(r => r.active).map(r => (r.plate_number || '').toUpperCase())); })
    .catch(() => {});
}

function fillWatchlistSelects() {
  const provOpts = `<option value="">${_t('common.notSpecified','— ไม่ระบุ —')}</option><option value="ไม่ทราบ">${_t('lpr.unknown','ไม่ทราบ')}</option>` + _LPR_PROVINCES.map(p => `<option value="${p}">${provinceLabel(p)}</option>`).join('');
  const groupOpts = _lprGroups.map(g => `<option value="${_esc(g.id)}">${_esc(g.name)}</option>`).join('');
  const reg = document.getElementById('wlRegion');
  if (reg) reg.innerHTML = provOpts;
  const grp = document.getElementById('wlGroup');
  if (grp) grp.innerHTML = groupOpts + `<option value="__add">${_t('lpr.wlAddGroup','+ เพิ่มกลุ่ม')}</option>`;
  // Edit modal reuses the same option lists, minus "+ เพิ่มกลุ่ม" — that inline
  // add-group flow is wired to #wlGroup specifically (see the change listener
  // below), not worth duplicating for a modal that's about editing one plate.
  const regEdit = document.getElementById('wlEditRegion');
  if (regEdit) regEdit.innerHTML = provOpts;
  const grpEdit = document.getElementById('wlEditGroup');
  if (grpEdit) grpEdit.innerHTML = groupOpts;
}

function _renderWatchlist() {
  _loadGroups(() => { fillWatchlistSelects(); _renderWGroupBar(); });
}

function _renderWGroupBar() {
  const bar = document.getElementById('wlGroupBar'); if (!bar) return;
  fetch(`${API}/api/lpr/watchlist`).then(r => r.json()).then(rows => {
    window._lprWlRows = rows;
    _lprWatchlistSet = new Set(rows.filter(r => r.active).map(r => (r.plate_number || '').toUpperCase()));
    const counts = rows.reduce((m, w) => { if (w.group_id) m[w.group_id] = (m[w.group_id] || 0) + 1; return m; }, {});
    let html = `<span class="wl-gchip ${_wlFilter === 'all' ? 'active' : ''}" ${_wlFilter === 'all' ? 'style="background:var(--accent)"' : ''} data-action="wlFilter" data-wg="all">${_t('lpr.wlAllGroups','ทั้งหมด')} <b>${rows.length}</b></span>`;
    html += _lprGroups.map(g => `<span class="wl-gchip ${_wlFilter === g.id ? 'active' : ''}" ${_wlFilter === g.id ? `style="background:${_esc(g.color)};border-color:${_esc(g.color)}"` : ''} data-action="wlFilter" data-wg="${_esc(g.id)}"><span class="wl-gdot" style="background:${_esc(g.color)}"></span>${_esc(g.name)} <b>${counts[g.id] || 0}</b></span>`).join('');
    bar.innerHTML = html;
    _renderWlList();
  }).catch(() => {});
}

function _wlSetFilter(id) { _wlFilter = id; _wlPage = 1; _renderWGroupBar(); }

// Text search alongside the group chips — plate / region / notes, client-side
// (997 rows today, same order of magnitude as everything else this page
// already renders in one shot; a server-side search isn't worth it yet).
let _wlSearch = '';
function wlSearch(el) { _wlSearch = (el.value || '').trim().toLowerCase(); _wlPage = 1; _renderWlList(); }

// Pagination — client-side slice (whole roster is already fetched in one
// shot above). Default 25/page: at ~1,000 rows the unpaginated list was an
// endless scroll (owner's words: "เลื่อนกันตาแตก").
const _WL_PAGE_SIZE = 25;
let _wlPage = 1;

// สถานะ "ส่ง LINE ไหม" ของป้ายใบนี้ — เดิมโชว์ชิปเฉพาะตอน "เปิด" ทำให้ใบที่
// ปิดอยู่ 9 จาก 488 หน้าตาเหมือนใบปกติทุกประการ · เจ้าของเจอ 'กร6' ไม่เตือน
// แล้วหาสาเหตุจากหน้าจอไม่ได้เลย ต้องยิง SQL ดู (2026-08-13)
//
// เพิ่มชิปฝั่ง "ปิด" ไม่ได้ถอดฝั่ง "เปิด" ออก — ฝั่งเปิดเป็นของเดิมที่เจ้าของเห็นมาตลอด
// การถอดออกเป็นการตัดสินใจของเจ้าของ ไม่ใช่ผลพลอยได้ของการเพิ่มตัวบอกสถานะ
//
// จงใจ **ไม่** บอกว่า "ใครปิด" ตรงชิป: ตอนนี้ทั้ง 9 ใบมาจาก bridge ที่ปิดให้
// อัตโนมัติเพราะป้ายสั้น แต่ DB ไม่ได้บันทึกผู้ปิดไว้ วันที่มีคนปิดป้ายยาวด้วยมือ
// ข้อความนั้นจะกลายเป็นคำโกหกทันที · กฎ "ป้ายสั้น" ไปอยู่ในหมายเหตุของ modal แทน
function _wlLineChip(w) {
  return w.notify_line
    ? `<span class="wl-mode" style="border-color:var(--status-bad);color:var(--status-bad)">${_t('lpr.wlLineNow','LINE ทันที')}</span>`
    : `<span class="wl-mode" style="border-color:var(--warn);color:var(--warn)">${_t('lpr.wlLineMuted','ไม่ส่ง LINE')}</span>`;
}
function _wlSetPage(p) { _wlPage = p; _renderWlList(); }

function _renderWlList() {
  const el = document.getElementById('wlList'); if (!el) return;
  const q = _wlSearch;
  const filtered = (window._lprWlRows || []).filter(w => {
    if (_wlFilter !== 'all' && w.group_id !== _wlFilter) return false;
    if (!q) return true;
    return (w.plate_number || '').toLowerCase().includes(q)
      || (w.region || '').toLowerCase().includes(q)
      || (w.notes || '').toLowerCase().includes(q);
  });
  _wlSyncPurgeBtn(filtered);
  if (!filtered.length) {
    el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:10px 0">${_t('lpr.watchlistEmpty','ยังไม่มีรายการเฝ้าระวัง')}</div>`;
    _renderWlPager(0);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / _WL_PAGE_SIZE));
  if (_wlPage > totalPages) _wlPage = totalPages;
  const rows = filtered.slice((_wlPage - 1) * _WL_PAGE_SIZE, _wlPage * _WL_PAGE_SIZE);
  el.innerHTML = rows.map(w => {
    const g = _groupById(w.group_id) || { name: '', color: '#888' };
    const modeTxt = w.alert_mode === 'plate_region' ? _t('lpr.wlModePlateRegion', 'ป้าย + จังหวัด') : _t('lpr.wlModePlate', 'ป้ายอย่างเดียว');
    // Synthetic plaque, not the reference photo — this list is a scan-through
    // roster (~1,000 rows), a uniform plaque reads faster than photos of very
    // mixed quality/aspect. The real photo still shows in the detail modal.
    // No vehicle_type/plate_color column on lpr_watchlist (only in free-text
    // notes) so this renders in the default "unknown" grey style, not the
    // real DLT colour — a known gap, not a bug.
    const thumb = (typeof lprPlaque === 'function')
      ? lprPlaque(w.plate_number, { region: w.region, feed: true })
      : _esc(w.plate_number);
    return `<div class="wl-row">
      <div class="wl-row-main" data-action="wlOpenDetail" data-plate="${_esc(w.plate_number)}">
        <div class="wl-plate-thumb">${thumb}</div>
        <span class="wl-plate" style="color:${w.active ? 'var(--accent)' : 'var(--text-secondary)'}">${_esc(w.plate_number)}</span>
        <div class="wl-info">
          <div class="l1">
            ${w.group_id ? `<span class="wl-badge" style="background:${_esc(g.color)};color:#fff">${_esc(g.name)}</span>` : ''}
            <span class="wl-mode">${_t('lpr.wlMatch','จับคู่')}: ${modeTxt}</span>
            ${w.region ? `<span class="wl-mode">${_esc(w.region)}</span>` : ''}
            ${_wlLineChip(w)}
          </div>
          ${w.notes ? `<div class="note">${_esc(w.notes)}</div>` : ''}
        </div>
      </div>
      <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px" data-action="wlToggle" data-plate="${_esc(w.plate_number)}" data-active="${!w.active}">${w.active ? _t('common.disable','ปิด') : _t('common.enable','เปิด')}</button>
      <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;color:var(--status-bad)" data-action="wlRowDelete" data-plate="${_esc(w.plate_number)}">${_t('common.delete','ลบ')}</button>
    </div>`;
  }).join('');
  _renderWlPager(filtered.length);
}

// Own node (#wlPager), not rebuilt inside #wlList — mirrors _renderLprPagination
// (Prev/info/Next, no jump-to-page).
function _renderWlPager(total) {
  const el = document.getElementById('wlPager'); if (!el) return;
  if (!total) { el.innerHTML = ''; return; }
  const totalPages = Math.max(1, Math.ceil(total / _WL_PAGE_SIZE));
  const info = `<span style="color:var(--text-secondary);font-size:12px;padding:0 8px">${_t('lpr.page','หน้า')} ${_wlPage}/${totalPages} · ${total.toLocaleString()} ${_t('lpr.items','รายการ')}</span>`;
  if (totalPages <= 1) { el.innerHTML = info; return; }
  const prev = _wlPage > 1 ? `<button class="btn btn-secondary" style="padding:4px 12px" data-action="wlPage" data-page="${_wlPage - 1}">‹</button>` : '';
  const next = _wlPage < totalPages ? `<button class="btn btn-secondary" style="padding:4px 12px" data-action="wlPage" data-page="${_wlPage + 1}">›</button>` : '';
  el.innerHTML = `${prev}${info}${next}`;
}

// Row click → detail. Bridge-managed rows (blacklist_master_id set) route to
// the SAME modal Plate Database uses (_blOpenDetail) — province/photo come from
// the source and would just get overwritten by the next bridge sync, so those
// stay read-only here (owner's call, 2026-07-27): edit them at Plate Database
// instead. The alert group is the exception, and always was: it is ours, not the
// roster's, and since migration 166 a move made here is pinned and survives the
// sync. Hand-added rows (no blacklist_master_id) get a lightweight edit modal
// built from the same fields as the add form.
function wlOpenDetail(el) {
  const plate = el.dataset.plate;
  const w = (window._lprWlRows || []).find(r => r.plate_number === plate);
  if (!w) return;
  if (w.blacklist_master_id) _wlOpenBridgeDetail(w);
  else _wlOpenManualEdit(w);
}

async function _wlOpenBridgeDetail(w, opts = {}) {
  if (typeof _blOpenDetail !== 'function') return;
  await _blOpenDetail(w.blacklist_master_id);
  const body = document.getElementById('blDetailBody');
  if (!body) return;
  const g = _groupById(w.group_id) || { name: '', color: '#888' };
  const modeTxt = w.alert_mode === 'plate_region' ? _t('lpr.wlModePlateRegion', 'ป้าย + จังหวัด') : _t('lpr.wlModePlate', 'ป้ายอย่างเดียว');
  // No delete button here — deleting a bridge row is not durable, the next
  // sync just re-adds it from the source (same guard that makes removal safe
  // for rosters also undoes a one-off manual delete). Disable IS durable
  // (sync's UPDATE never touches `active`), so that stays — except from the
  // LPR gallery's read-only tab (opts.readOnly), a Live View with no controls.
  const toggleBtn = opts.readOnly ? '' : `<button class="btn btn-secondary" style="padding:3px 8px;font-size:11px" data-action="wlToggle" data-plate="${_esc(w.plate_number)}" data-active="${!w.active}">${w.active ? _t('common.disable','ปิด') : _t('common.enable','เปิด')}</button>`;
  // คู่กับ toggleBtn — ซ่อนในแท็บ gallery แบบอ่านอย่างเดียวด้วยเหตุผลเดียวกัน
  // ต่างกันตรง: ปิด/เปิด active คือเอาป้ายเข้า-ออกการเฝ้าระวังทั้งใบ ส่วนตัวนี้
  // แค่ปิดเสียง — ป้ายยังจับคู่และขึ้นหน้าจอตามปกติ
  const notifyBtn = opts.readOnly ? '' : `<button class="btn btn-secondary" style="padding:3px 8px;font-size:11px" data-action="wlToggleNotify" data-plate="${_esc(w.plate_number)}" data-notify="${!w.notify_line}">${w.notify_line ? _t('lpr.wlMuteBtn','ปิดส่ง LINE') : _t('lpr.wlUnmuteBtn','เปิดส่ง LINE')}</button>`;
  // กลุ่มแจ้งเตือนเป็นของเรา ไม่ใช่ของต้นทาง จึงย้ายได้จากตรงนี้เลย — เดิมโชว์เป็น
  // ป้ายสีเฉย ๆ แล้วบอกให้ไปแก้ที่หน้า Plate Database ซึ่งที่นั่นไม่มีช่องกลุ่มให้แก้
  // เจ้าของหาไม่เจอทั้งสองที่ (2026-08-20) การย้ายจะปักหมุดไว้กัน sync เขียนทับ
  // ถ้ารายชื่อกลุ่มยังไม่มา ให้กลับไปเป็นป้ายอ่านอย่างเดียว — dropdown ที่มีแต่
  // "ไม่มีกลุ่ม" ให้เลือก คือปุ่มลบกลุ่มโดยที่คนกดไม่ได้ตั้งใจ
  const groupCtl = (opts.readOnly || !(_lprGroups || []).length)
    ? (w.group_id ? `<span class="wl-badge" style="background:${_esc(g.color)};color:#fff">${_esc(g.name)}</span>` : '')
    : `<select class="form-input wl-bridge-group" data-change="wlChangeGroup" data-plate="${_esc(w.plate_number)}"
               style="width:auto;padding:3px 8px;font-size:11px"
               title="${_esc(_t('lpr.wlGroupPickTitle','ย้ายป้ายใบนี้ไปกลุ่มแจ้งเตือนอื่น'))}">
         <option value=""${w.group_id ? '' : ' selected'}>${_esc(_t('lpr.wlNoGroup','— ไม่มีกลุ่ม —'))}</option>
         ${(_lprGroups || []).map(x => `<option value="${_esc(x.id)}"${x.id === w.group_id ? ' selected' : ''}>${_esc(x.name)}</option>`).join('')}
       </select>`;
  const banner = `<div class="wl-bridge-banner">
    <div class="wl-bridge-policy">
      ${groupCtl}
      <span class="wl-mode">${_t('lpr.wlMatch','จับคู่')}: ${modeTxt}</span>
      ${_wlLineChip(w)}
      ${notifyBtn}
      ${toggleBtn}
    </div>
    ${w.notify_line ? '' : `<div class="wl-bridge-note" style="border-color:var(--warn);margin-bottom:8px">${_t('lpr.wlMutedNote','ป้ายใบนี้ยังจับคู่และขึ้นบนหน้าจอตามปกติ แต่จะไม่ยิงเข้า LINE · ป้ายที่ยาวไม่เกิน 4 ตัวจะถูกปิดอัตโนมัติตอนนำเข้า เพราะสั้นเกินกว่าจะรอดจากการอ่านผิดของกล้องแม้แต่ตัวเดียว — ป้ายอื่นถูกปิดด้วยมือได้เช่นกัน')}</div>`}
    ${w.group_pinned ? `<div class="wl-bridge-note">${_t('lpr.wlGroupPinned','กลุ่มของป้ายใบนี้ถูกตั้งด้วยมือไว้แล้ว — การ sync Blacklist รอบถัดไปจะไม่ย้ายมันกลับ')}</div>` : ''}
    <div class="wl-bridge-note">${_t('lpr.wlBridgeNote','ข้อมูลนี้ผูกมาจาก Blacklist — กลุ่มแจ้งเตือนย้ายได้จากตรงนี้ ส่วน province / รูปอ้างอิง แก้ได้ที่หน้า ฐานข้อมูลป้ายทะเบียน (Plate Database) เท่านั้น เพราะจะถูกดึงข้อมูลทับใหม่ทุกครั้งที่ sync')}</div>
  </div>`;
  body.insertAdjacentHTML('afterbegin', banner);
}

// ── Manual-row edit modal (no blacklist_master_id) ──────────────────
let _wlEditPlate = null;
let _wlEditPendingImg = null;
// Shared by the editable open (_wlOpenManualEdit) and the read-only one
// (_wlOpenManualView) — same field population either way, only what happens
// to the controls around it differs.
function _wlFillEditFields(w) {
  const title = document.getElementById('wlEditTitle'); if (title) title.textContent = w.plate_number;
  const plateEl = document.getElementById('wlEditPlate'); if (plateEl) plateEl.value = w.plate_number;
  fillWatchlistSelects();
  const regionSel = document.getElementById('wlEditRegion'); if (regionSel) regionSel.value = w.region || '';
  const groupSel = document.getElementById('wlEditGroup'); if (groupSel) groupSel.value = w.group_id || '';
  const noteEl = document.getElementById('wlEditNote'); if (noteEl) noteEl.value = w.notes || '';
  const notifyEl = document.getElementById('wlEditNotify'); if (notifyEl) notifyEl.checked = !!w.notify_line;
  _wlEditShowDropPreview(w.ref_image ? `${API}/snapshots/${_esc(w.ref_image)}` : null);
}
function _wlOpenManualEdit(w) {
  _wlEditPlate = w.plate_number;
  _wlEditPendingImg = undefined;   // undefined = "unchanged", null = "cleared"
  const modal = document.getElementById('wlEditModal'); if (!modal) return;
  _wlFillEditFields(w);
  const toggleBtn = document.getElementById('wlEditToggleBtn');
  if (toggleBtn) { toggleBtn.textContent = w.active ? _t('common.disable','ปิด') : _t('common.enable','เปิด'); toggleBtn.dataset.active = String(!w.active); }
  modal.classList.remove('hidden');
}

// Read-only pass over the same modal for the LPR gallery's Live View tab —
// disables the inputs instead of duplicating the field list into a second
// modal, and .wl-view-only (index.css) hides Save/Toggle/Delete/upload.
// wlEditClose() undoes both so the next open (from either tab) starts clean.
function _wlOpenManualView(w) {
  _wlEditPlate = null;
  _wlEditPendingImg = undefined;
  const modal = document.getElementById('wlEditModal'); if (!modal) return;
  _wlFillEditFields(w);
  modal.classList.add('wl-view-only');
  modal.querySelectorAll('#wlEditRegion, #wlEditGroup, #wlEditNote, #wlEditNotify').forEach(el => { el.disabled = true; });
  modal.classList.remove('hidden');
}
function wlEditClose() {
  const modal = document.getElementById('wlEditModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('wl-view-only');
    modal.querySelectorAll('#wlEditRegion, #wlEditGroup, #wlEditNote, #wlEditNotify').forEach(el => { el.disabled = false; });
  }
  _wlEditPlate = null;
}

async function wlEditSave() {
  if (!_wlEditPlate) return;
  const body = {
    plate_number: _wlEditPlate,
    region: document.getElementById('wlEditRegion')?.value || '',
    group_id: document.getElementById('wlEditGroup')?.value || null,
    notes: document.getElementById('wlEditNote')?.value?.trim() || '',
    notify_line: !!document.getElementById('wlEditNotify')?.checked,
  };
  // Only send ref_image if it actually changed — omitting it would otherwise
  // clear the existing photo on every save (POST is a full upsert).
  const w = (window._lprWlRows || []).find(r => r.plate_number === _wlEditPlate);
  body.ref_image = (_wlEditPendingImg !== undefined) ? _wlEditPendingImg : (w ? w.ref_image : null);
  try {
    const r = await fetch(`${API}/api/lpr/watchlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('save failed');
    wlEditClose();
    _renderWGroupBar();
  } catch (e) { console.error('[wl-edit] save:', e.message); }
}
function wlEditToggleActive() {
  if (!_wlEditPlate) return;
  const btn = document.getElementById('wlEditToggleBtn');
  const active = btn?.dataset.active === 'true';
  _wlToggle(_wlEditPlate, active);
  wlEditClose();
}
function wlEditDelete() {
  if (!_wlEditPlate) return;
  if (!confirm(_t('lpr.wlDeleteConfirm', 'ลบรายการนี้ออกจากเฝ้าระวัง?'))) return;
  _wlDelete(_wlEditPlate);
  wlEditClose();
}
function _wlEditShowDropPreview(url) {
  const inner = document.getElementById('wlEditDropInner'); if (!inner) return;
  inner.innerHTML = url
    ? `<img class="wl-drop-prev" src="${url}" alt=""><button type="button" class="wl-drop-clear" data-action="wlEditDropClear">${_t('common.clear','ล้าง')}</button>`
    : `<span class="wl-drop-hint">${_t('lpr.wlDropHint','ลากรูปมาวาง หรือคลิกเพื่อเลือก')}</span>`;
}
function _wlEditUploadFile(file) {
  if (!file || !/^image\//.test(file.type || '')) return;
  _wlEditShowDropPreview(URL.createObjectURL(file));
  const drop = document.getElementById('wlEditDrop'); if (drop) drop.classList.add('uploading');
  const fd = new FormData(); fd.append('image', file);
  fetch(`${API}/api/lpr/watchlist/image`, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(d => { _wlEditPendingImg = d.filename || null; if (!_wlEditPendingImg) _wlEditResetDrop(); })
    .catch(() => { _wlEditPendingImg = null; _wlEditResetDrop(); })
    .finally(() => { if (drop) drop.classList.remove('uploading'); });
}
function _wlEditUploadImg(input) { _wlEditUploadFile(input.files && input.files[0]); }
function _wlEditResetDrop() {
  _wlEditPendingImg = null;
  const fi = document.getElementById('wlEditImg'); if (fi) fi.value = '';
  _wlEditShowDropPreview(null);
}

// RF1 — read-only watchlist view for the LPR gallery tab (management is in
// Settings › ระบบ LPR). Same visual template as the Settings "All Entries"
// list (search, plaque thumbnail, pagination, click → detail) minus every
// mutating control (no add form / toggle / delete) — a Live View, not an
// editor. Own module state (Ro suffix) since Settings' _wlFilter/_wlSearch/
// _wlPage drive a completely separate render (_renderWlList) on the same page.
let _wlRoFilter = 'all';
function _wlSetFilterRo(id) { _wlRoFilter = id; _wlPageRo = 1; _renderWatchlistRO(); }
let _wlSearchRo = '';
function wlSearchRo(el) { _wlSearchRo = (el.value || '').trim().toLowerCase(); _wlPageRo = 1; _renderWatchlistROList(); }
let _wlPageRo = 1;
function _wlSetPageRo(p) { _wlPageRo = p; _renderWatchlistROList(); }

function _renderWatchlistRO() {
  const bar = document.getElementById('lprWlRoBar');
  const list = document.getElementById('lprWlRoList');
  if (!bar || !list) return;
  _loadGroups(() => {
    fetch(`${API}/api/lpr/watchlist`).then(r => r.json()).then(rows => {
      window._lprWlRows = rows;
      _lprWatchlistSet = new Set(rows.filter(r => r.active).map(r => (r.plate_number || '').toUpperCase()));
      const counts = rows.reduce((m, w) => { if (w.group_id) m[w.group_id] = (m[w.group_id] || 0) + 1; return m; }, {});
      let html = `<span class="wl-gchip ${_wlRoFilter === 'all' ? 'active' : ''}" ${_wlRoFilter === 'all' ? 'style="background:var(--accent)"' : ''} data-action="wlFilterRo" data-wg="all">${_t('lpr.wlAllGroups','ทั้งหมด')} <b>${rows.length}</b></span>`;
      html += _lprGroups.map(g => `<span class="wl-gchip ${_wlRoFilter === g.id ? 'active' : ''}" ${_wlRoFilter === g.id ? `style="background:${_esc(g.color)};border-color:${_esc(g.color)}"` : ''} data-action="wlFilterRo" data-wg="${_esc(g.id)}"><span class="wl-gdot" style="background:${_esc(g.color)}"></span>${_esc(g.name)} <b>${counts[g.id] || 0}</b></span>`).join('');
      bar.innerHTML = html;
      _renderWatchlistROList();
    }).catch(() => {});
  });
}

function _renderWatchlistROList() {
  const list = document.getElementById('lprWlRoList');
  if (!list) return;
  const q = _wlSearchRo;
  const filtered = (window._lprWlRows || []).filter(w => {
    if (_wlRoFilter !== 'all' && w.group_id !== _wlRoFilter) return false;
    if (!q) return true;
    return (w.plate_number || '').toLowerCase().includes(q)
      || (w.region || '').toLowerCase().includes(q)
      || (w.notes || '').toLowerCase().includes(q);
  });
  if (!filtered.length) {
    list.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:10px 0">${_t('lpr.watchlistEmpty','ยังไม่มีรายการเฝ้าระวัง')}</div>`;
    _renderWlPagerRo(0);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / _WL_PAGE_SIZE));
  if (_wlPageRo > totalPages) _wlPageRo = totalPages;
  const rows = filtered.slice((_wlPageRo - 1) * _WL_PAGE_SIZE, _wlPageRo * _WL_PAGE_SIZE);
  list.innerHTML = rows.map(w => {
    const g = _groupById(w.group_id) || { name: '', color: '#888' };
    const modeTxt = w.alert_mode === 'plate_region' ? _t('lpr.wlModePlateRegion', 'ป้าย + จังหวัด') : _t('lpr.wlModePlate', 'ป้ายอย่างเดียว');
    const thumb = (typeof lprPlaque === 'function')
      ? lprPlaque(w.plate_number, { region: w.region, feed: true })
      : _esc(w.plate_number);
    return `<div class="wl-row">
      <div class="wl-row-main" data-action="wlOpenDetailRo" data-plate="${_esc(w.plate_number)}">
        <div class="wl-plate-thumb">${thumb}</div>
        <span class="wl-plate" style="color:${w.active ? 'var(--accent)' : 'var(--text-secondary)'}">${_esc(w.plate_number)}</span>
        <div class="wl-info">
          <div class="l1">
            ${w.group_id ? `<span class="wl-badge" style="background:${_esc(g.color)};color:#fff">${_esc(g.name)}</span>` : ''}
            <span class="wl-mode">${_t('lpr.wlMatch','จับคู่')}: ${modeTxt}</span>
            ${w.region ? `<span class="wl-mode">${_esc(w.region)}</span>` : ''}
            ${_wlLineChip(w)}
            ${!w.active ? `<span class="wl-mode" style="opacity:.7">${_t('common.disabled','ปิดอยู่')}</span>` : ''}
          </div>
          ${w.notes ? `<div class="note">${_esc(w.notes)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  _renderWlPagerRo(filtered.length);
}

function _renderWlPagerRo(total) {
  const el = document.getElementById('lprWlRoPager'); if (!el) return;
  if (!total) { el.innerHTML = ''; return; }
  const totalPages = Math.max(1, Math.ceil(total / _WL_PAGE_SIZE));
  const info = `<span style="color:var(--text-secondary);font-size:12px;padding:0 8px">${_t('lpr.page','หน้า')} ${_wlPageRo}/${totalPages} · ${total.toLocaleString()} ${_t('lpr.items','รายการ')}</span>`;
  if (totalPages <= 1) { el.innerHTML = info; return; }
  const prev = _wlPageRo > 1 ? `<button class="btn btn-secondary" style="padding:4px 12px" data-action="wlPageRo" data-page="${_wlPageRo - 1}">‹</button>` : '';
  const next = _wlPageRo < totalPages ? `<button class="btn btn-secondary" style="padding:4px 12px" data-action="wlPageRo" data-page="${_wlPageRo + 1}">›</button>` : '';
  el.innerHTML = `${prev}${info}${next}`;
}

// Row click → view-only detail. Bridge-managed rows reuse the same Plate
// Database modal as the Settings list (already read-only from this surface,
// minus the enable/disable toggle here); hand-added rows get a read-only pass
// over the same edit modal instead of a second one — see _wlOpenManualView.
function wlOpenDetailRo(el) {
  const plate = el.dataset.plate;
  const w = (window._lprWlRows || []).find(r => r.plate_number === plate);
  if (!w) return;
  if (w.blacklist_master_id) _wlOpenBridgeDetail(w, { readOnly: true });
  else _wlOpenManualView(w);
}

// ── ขอบเขตของกลุ่มรายการเฝ้าระวัง (migration 261) — ใช้ทั้งกลุ่มป้ายทะเบียนและกลุ่มใบหน้า ──
// Global = จับคู่ทุกกล้อง · เลือก Site = จับคู่/แจ้งเตือนเฉพาะกล้องของ Site นั้น และ Site Admin ของ Site นั้นแก้ได้
// /api/sites คืนเฉพาะ Site ที่ผู้ใช้มีสิทธิ์ → Site Admin เห็นแต่ Site ของตัวเอง และเลือก Global ไม่ได้
let _listSites = null;
function _loadListSites(cb) {
  if (_listSites) return cb();
  fetch(`${API}/api/sites`).then(r => r.ok ? r.json() : []).then(a => { _listSites = Array.isArray(a) ? a : []; cb(); })
    .catch(() => { _listSites = []; cb(); });
}
function _listScopeSelect(action, g) {
  const sa = currentUser?.role === 'site_admin';
  // กลุ่ม Global สำหรับ Site Admin = อ่านอย่างเดียว (ฝั่งเซิร์ฟเวอร์ก็ปฏิเสธ) — ไม่ให้กดแล้วได้ 403
  const lock = sa && g.site_id == null;
  const opts = `<option value="" ${g.site_id == null ? 'selected' : ''} ${sa ? 'disabled' : ''}>${escapeHtml(I18N.t('wl.scopeGlobal', 'Global (ทุก Site)'))}</option>`
    + (_listSites || []).map(s => `<option value="${s.id}" ${Number(g.site_id) === s.id ? 'selected' : ''}>${escapeHtml(s.name || s.code)}</option>`).join('');
  return `<select class="form-input wl-grp-scope" data-change="${action}" data-gid="${escapeHtml(g.id)}" ${lock ? 'disabled' : ''} title="${escapeHtml(I18N.t('wl.scopeTitle', 'ใช้กับกล้องของ Site ไหน'))}">${opts}</select>`;
}
// Site Admin สร้างกลุ่มใหม่ได้เฉพาะใน Site ตัวเอง — ส่ง Site แรกไปเป็นค่าเริ่มต้น (เปลี่ยนทีหลังได้จาก dropdown)
function _newListSiteId() {
  return currentUser?.role === 'site_admin' ? ((_listSites || [])[0]?.id ?? null) : null;
}
function _patchListScope(url, el, done) {
  fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: el.value ? Number(el.value) : null }) })
    .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status)); })
    .catch(err => alert(I18N.t('lpr.wlNotifySaveFail', 'บันทึกไม่สำเร็จ: ') + err.message))
    .finally(done);
}

// RF2 — group manager (rename / color / delete / add) in Settings › ระบบ LPR.
function _renderWlGroupMgr() {
  const el = document.getElementById('wlGroupMgr'); if (!el) return;
  _loadListSites(() => _loadGroups(() => {
    // Alert Match Mode lives HERE now (2026-07-27), one dropdown per group —
    // not on the per-plate add form. It is the group's policy: every plate in
    // it is matched the same way, decided once, not re-picked per plate.
    el.innerHTML = _lprGroups.map(g => `
      <div class="wl-grp-row">
        <input type="color" value="${_esc(g.color || '#5b8def')}" data-change="wlGroupColor" data-gid="${_esc(g.id)}">
        <input class="form-input" value="${_esc(g.name)}" data-input="wlGroupRename" data-gid="${_esc(g.id)}">
        ${_listScopeSelect('wlGroupSite', g)}
        <select class="form-input" data-change="wlGroupMode" data-gid="${_esc(g.id)}" title="${_esc(_t('lpr.wlMode','โหมดจับคู่แจ้งเตือน'))}">
          <option value="plate" ${g.default_alert_mode !== 'plate_region' ? 'selected' : ''}>${_t('lpr.wlModePlate','ป้ายทะเบียนอย่างเดียว')}</option>
          <option value="plate_region" ${g.default_alert_mode === 'plate_region' ? 'selected' : ''}>${_t('lpr.wlModePlateRegion','ป้าย + จังหวัด (ตรงทั้งคู่)')}</option>
        </select>
        <!-- The master LINE switch sits on the group, not the plate: 482 of the
             active plates arrive from the blacklist bridge automatically, so a
             per-plate toggle is not something anyone can stay on top of. Who
             receives it is set per recipient in Settings › LINE. -->
        <label class="wl-grp-line" title="${_esc(_t('lpr.wlNotifyLineHint','ส่ง LINE เมื่อพบรถในกลุ่มนี้ · เลือกผู้รับได้ที่ ตั้งค่า › LINE'))}">
          <input type="checkbox" ${g.notify_line ? 'checked' : ''} data-change="wlGroupNotify" data-gid="${_esc(g.id)}">
          <span>${_t('lpr.wlNotifyLine','ส่ง LINE')}</span>
        </label>
        <button class="btn btn-secondary" style="color:var(--status-bad)" data-action="wlGroupDelete" data-gid="${_esc(g.id)}">${_t('common.delete','ลบ')}</button>
      </div>`).join('') +
      `<button class="btn btn-secondary wl-grp-add" data-action="wlGroupAddNew">${_t('lpr.wlAddGroup','+ เพิ่มกลุ่ม')}</button>`;
    _renderWlLineBanner();
  }));
}

// Says whether any of these switches actually reaches a phone.
//
// Written because they did not, and it took a false-positive hit to find out:
// the group switch was on, the per-plate switch was on, and line_config.enabled
// was off — three switches, two of them green, and nothing on this page said
// so. The old hint next to the per-plate box even read "(แจ้งเตือนอัตโนมัติยัง
// ไม่เปิดใช้)", written before a sender existed and never updated, so the one
// piece of text on the subject was actively wrong.
//
// Reads the real config rather than assuming: the master switch lives on
// another page and anyone can change it there.
function _renderWlLineBanner() {
  const el = document.getElementById('wlLineBanner'); if (!el) return;
  const on = _lprGroups.filter(g => g.notify_line).map(g => g.name || g.id);
  fetch(`${API}/api/line-config`).then(r => r.ok ? r.json() : null).then(cfg => {
    // No config readable (auditor, or the request failed) — say nothing rather
    // than guess. A wrong "all good" here is worse than no banner.
    if (!cfg) { el.className = 'wl-line-banner hidden'; return; }
    el.classList.remove('hidden');
    if (!cfg.enabled || !cfg._hasToken) {
      el.className = 'wl-line-banner warn';
      el.innerHTML = `<span>${_esc(_t('lpr.wlBannerOff','สวิตช์หลักของระบบแจ้งเตือนยังปิดอยู่ — ติ๊ก "ส่ง LINE" ตรงนี้จะยังไม่มีข้อความออกไป'))}</span>
        <button class="btn btn-secondary btn-sm" data-action="wlGoLineConfig">${_esc(_t('lpr.wlBannerGo','ไปเปิดที่ การแจ้งเตือน › LINE Config'))}</button>`;
    } else if (!on.length) {
      el.className = 'wl-line-banner warn';
      el.textContent = _t('lpr.wlBannerNoGroup', 'เปิดสวิตช์หลักแล้ว แต่ยังไม่มีกลุ่มไหนติ๊ก "ส่ง LINE" — จะยังไม่มีข้อความออกไป');
    } else {
      el.className = 'wl-line-banner ok';
      el.textContent = _t('lpr.wlBannerOn', 'ระบบแจ้งเตือนเปิดอยู่ · กลุ่มที่ส่ง LINE: {g}').replace('{g}', on.join(', '));
    }
  }).catch(() => { el.className = 'wl-line-banner hidden'; });
}

// Jump to the switch instead of describing where it is.
function wlGoLineConfig() {
  document.querySelector('.nav-item[data-page="settings"]')?.click();
  document.querySelector('.srail-item[data-sec="alerts"]')?.click();
  document.getElementById('alertTabConfig')?.click();
  setTimeout(() => document.getElementById('cfgEnabled')?.scrollIntoView({ block: 'center' }), 300);
}
function _wlGroupRefresh() { _renderWlGroupMgr(); fillWatchlistSelects(); _renderWGroupBar(); }
function wlGroupAddNew() {
  const name = prompt(_t('lpr.wlGroupPrompt', 'ชื่อกลุ่มเฝ้าระวังใหม่')); if (!name || !name.trim()) return;
  fetch(`${API}/api/lpr/watchlist/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), site_id: _newListSiteId() }) })
    .then(() => _wlGroupRefresh()).catch(console.error);
}
function wlGroupSite(el) {
  _patchListScope(`${API}/api/lpr/watchlist/groups/${el.dataset.gid}`, el, () => _wlGroupRefresh());
}
let _wlGrpRenameTimers = {};
function wlGroupRename(el) {
  const gid = el.dataset.gid, v = el.value;
  clearTimeout(_wlGrpRenameTimers[gid]);
  _wlGrpRenameTimers[gid] = setTimeout(() => {
    fetch(`${API}/api/lpr/watchlist/groups/${gid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v }) })
      .then(() => { fillWatchlistSelects(); _renderWGroupBar(); }).catch(console.error);
  }, 500);
}
function wlGroupColor(el) {
  const gid = el.dataset.gid;
  fetch(`${API}/api/lpr/watchlist/groups/${gid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: el.value }) })
    .then(() => _wlGroupRefresh()).catch(console.error);
}
function wlGroupNotify(el) {
  const gid = el.dataset.gid, on = el.checked;
  fetch(`${API}/api/lpr/watchlist/groups/${gid}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notify_line: on }),
  }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    // Keep the local copy in step and redraw the banner only. Calling
    // _wlGroupRefresh() here would rebuild every row and refetch three things on
    // each click; not calling anything would leave the banner asserting "no
    // group is sending" straight after you ticked one — the same screen-says-one-
    // thing-DB-says-another trap the banner was added to close.
    const g = _lprGroups.find(x => x.id === gid);
    if (g) g.notify_line = on;
    _renderWlLineBanner();
  })
    .catch(err => {
      // Put the box back rather than leave it showing a state the server never
      // accepted — this one decides whether phones buzz.
      el.checked = !on;
      alert(_t('lpr.wlNotifySaveFail', 'บันทึกไม่สำเร็จ: ') + err.message);
    });
}

function wlGroupMode(el) {
  const gid = el.dataset.gid;
  fetch(`${API}/api/lpr/watchlist/groups/${gid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_alert_mode: el.value }) })
    .then(r => r.json()).then(j => {
      // The server warns rather than blocks when switching to plate_region
      // leaves member plates with no province — those stop alerting silently
      // otherwise, and nothing else would surface it.
      if (j.warning) alert(j.warning);
      _wlGroupRefresh();
      _renderWatchlist();
    }).catch(console.error);
}
function wlGroupDelete(el) {
  const gid = el.dataset.gid;
  if (!confirm(_t('lpr.wlGroupDelConfirm', 'ลบกลุ่มนี้? (ป้ายในกลุ่มจะไม่ถูกลบ)'))) return;
  fetch(`${API}/api/lpr/watchlist/groups/${gid}`, { method: 'DELETE' })
    .then(() => _wlGroupRefresh()).catch(console.error);
}

let _wlPendingImg = null;
// RF3 — drag&drop OR click upload (backend resizes to 400×400). Shared path for
// the file input + the drop zone; instant local preview, server filename on success.
function _wlShowDropPreview(url) {
  const inner = document.getElementById('wlDropInner'); if (!inner) return;
  inner.innerHTML = url
    ? `<img class="wl-drop-prev" src="${url}" alt=""><button type="button" class="wl-drop-clear" data-action="wlDropClear">${_t('common.clear','ล้าง')}</button>`
    : `<span class="wl-drop-hint">${_t('lpr.wlDropHint','ลากรูปมาวาง หรือคลิกเพื่อเลือก')}</span>`;
}
function _wlUploadFile(file) {
  if (!file || !/^image\//.test(file.type || '')) return;
  _wlShowDropPreview(URL.createObjectURL(file));   // optimistic local preview
  const drop = document.getElementById('wlDrop'); if (drop) drop.classList.add('uploading');
  const fd = new FormData(); fd.append('image', file);
  fetch(`${API}/api/lpr/watchlist/image`, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(d => { _wlPendingImg = d.filename || null; if (!_wlPendingImg) _wlResetDrop(); })
    .catch(() => { _wlPendingImg = null; _wlResetDrop(); })
    .finally(() => { if (drop) drop.classList.remove('uploading'); });
}
function _wlUploadImg(input) { _wlUploadFile(input.files && input.files[0]); }
function _wlResetDrop() {
  _wlPendingImg = null;
  const fi = document.getElementById('wlImg'); if (fi) fi.value = '';
  _wlShowDropPreview(null);
}

function _wlAdd() {
  const plate = (document.getElementById('wlPlate')?.value || '').trim().toUpperCase();
  if (!plate) { document.getElementById('wlPlate')?.focus(); return; }
  const group = document.getElementById('wlGroup')?.value || '';
  const body = {
    plate_number: plate,
    region: document.getElementById('wlRegion')?.value || '',
    // No alert_mode here (2026-07-27) — it is the GROUP's policy now, derived
    // server-side from group_id. Sending one from this form would be a lie the
    // moment the group's own setting differs from whatever this select last had.
    group_id: group && group !== '__add' ? group : null,
    notes: document.getElementById('wlNote')?.value?.trim() || '',
    notify_line: !!document.getElementById('wlNotify')?.checked,
    ref_image: _wlPendingImg,
  };
  fetch(`${API}/api/lpr/watchlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(() => {
      ['wlPlate', 'wlNote'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      _wlResetDrop();
      _renderWatchlist();
    })
    .catch(console.error);
}


// Bulk delete. Scope is whatever the list is currently showing — the same
// `filtered` array the rows come from, stashed here rather than recomputed, so
// the button, the label, the confirmation and the request can never disagree
// about which plates are involved.
let _wlPurgeSet = [];
function _wlSyncPurgeBtn(filtered) {
  _wlPurgeSet = filtered || [];
  const btn = document.getElementById('wlPurgeBtn');
  if (!btn) return;
  btn.hidden = !_wlPurgeSet.length;
  const c = document.getElementById('wlPurgeCount');
  if (c) c.textContent = _wlPurgeSet.length ? `(${_wlPurgeSet.length.toLocaleString()})` : '';
}

async function wlPurge() {
  const rows = _wlPurgeSet;
  if (!rows.length) return;
  const bridged = rows.filter(w => w.origin === 'blacklist_bridge').length;
  const scoped = _wlFilter !== 'all' || _wlSearch;

  const typed = prompt(
    `${_t('lprset.wlPurgeWarn', 'ลบรายการเฝ้าระวังถาวร — กู้คืนไม่ได้')}\n\n` +
    `${_t('lprset.wlPurgeCount', 'จำนวนที่จะลบ')}: ${rows.length.toLocaleString()} ` +
    `${scoped ? _t('lprset.wlPurgeScoped', '(เฉพาะรายการที่กรองอยู่ตอนนี้)') : _t('lprset.wlPurgeAll', '(ทั้งหมดในระบบ)')}\n` +
    // Not a blocker — an empty roster until the next sync is a legitimate
    // thing to want — but it is the first question the operator would ask
    // afterwards, so it goes in front of the decision instead of behind it.
    (bridged ? `${_t('lprset.wlPurgeBridge', 'ในจำนวนนี้มาจาก Blacklist')}: ${bridged.toLocaleString()} ` +
               `${_t('lprset.wlPurgeBridgeNote', '— จะกลับมาอีกเมื่อ sync Blacklist ครั้งถัดไป')}\n` : '') +
    `\n${_t('blset.typeConfirm', 'พิมพ์ CONFIRM เพื่อยืนยัน')}`);
  if (typed !== 'CONFIRM') return;

  try {
    const r = await fetch(`${API}/api/lpr/watchlist/bulk-delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ plates: rows.map(w => w.plate_number), confirm: 'CONFIRM' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    alert(`${_t('lprset.wlPurgeDone', 'ลบแล้ว')} ${Number(j.deleted).toLocaleString()} ${_t('blset.records', 'ระเบียน')}`);
    _wlPage = 1;
    _renderWGroupBar();   // refetches the roster and redraws chips + list
  } catch (e) {
    alert(`${_t('lprset.wlPurgeFail', 'ลบไม่สำเร็จ')}: ${e.message}`);
  }
}

function _wlToggle(plate, active) {
  fetch(`${API}/api/lpr/watchlist/${encodeURIComponent(plate)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) })
    .then(() => _renderWGroupBar()).catch(console.error);
}
// เปิด/ปิดการส่ง LINE เฉพาะป้ายใบนี้ · PATCH ตัวเดียวกับ _wlToggle เพราะมันแตะ
// คอลัมน์ที่ขอมาเท่านั้น — ห้ามใช้ POST /api/lpr/watchlist (upsert เต็มใบ) กับ
// แถวที่มาจาก bridge เพราะมันบังคับ active=TRUE และเขียนทับ label/notes/กลุ่ม
//
// ยืนยันก่อนเฉพาะตอน "เปิดคืน" ไม่ใช่ตอนปิด: การเปิดคือการปล่อยให้ป้ายไปสั่น
// โทรศัพท์คนอื่น ส่วนการปิดกลับไปเป็นสถานะเดิมที่ปลอดภัยกว่า
function wlToggleNotify(el) {
  const plate = el.dataset.plate;
  const on = el.dataset.notify === 'true';
  if (on && !confirm(_t('lpr.wlUnmuteConfirm', 'ให้ป้าย {p} ส่งแจ้งเตือนเข้า LINE?').replace('{p}', plate))) return;
  fetch(`${API}/api/lpr/watchlist/${encodeURIComponent(plate)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notify_line: on }),
  }).then(r => {
    if (!r.ok) throw new Error('patch failed');
    // แถวใน memory ต้องตามให้ทัน ไม่งั้นชิปกับปุ่มยังโชว์ค่าเก่าจนกว่าจะโหลดใหม่
    const w = (window._lprWlRows || []).find(x => x.plate_number === plate);
    if (w) w.notify_line = on;
    _renderWGroupBar();
    const modal = document.getElementById('blDetailModal');
    if (modal && !modal.classList.contains('hidden')) _wlOpenBridgeDetail(w || { plate_number: plate, notify_line: on });
  }).catch(console.error);
}
// ย้ายกลุ่มแจ้งเตือนของป้ายใบเดียว · PATCH ตัวเดียวกับ wlToggleNotify ด้วยเหตุผลเดียวกัน
// (POST เป็น upsert เต็มใบ ห้ามใช้กับแถวจาก bridge) ฝั่ง server ปักหมุดให้เองเมื่อแถวนั้น
// เป็นของ bridge เพื่อไม่ให้ sync รอบหน้าย้ายกลับ — migration 166
function wlChangeGroup(el) {
  const plate = el.dataset.plate;
  const gid = el.value || null;
  const w = (window._lprWlRows || []).find(x => x.plate_number === plate);
  if (w && (w.group_id || null) === gid) return;   // ไม่มีอะไรเปลี่ยน
  const name = gid ? ((_lprGroups || []).find(x => x.id === gid) || {}).name || gid
                   : _t('lpr.wlNoGroup', '— ไม่มีกลุ่ม —');
  if (!confirm(_t('lpr.wlGroupMoveConfirm', 'ย้าย {p} ไปกลุ่ม "{g}" ? กลุ่มนี้จะถูกตั้งค้างไว้ ไม่ถูก sync เขียนทับ')
      .replace('{p}', plate).replace('{g}', name))) {
    el.value = (w && w.group_id) || '';            // คืนค่าเดิมให้ dropdown
    return;
  }
  fetch(`${API}/api/lpr/watchlist/${encodeURIComponent(plate)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_id: gid }),
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'patch failed');
    const row = await r.json();
    // แถวใน memory ต้องตามให้ทัน ไม่งั้นชิป/แถบกลุ่มยังโชว์ค่าเก่าจนกว่าจะโหลดใหม่
    if (w) { w.group_id = row.group_id; w.alert_mode = row.alert_mode; w.group_pinned = row.group_pinned; }
    _renderWGroupBar();
    const modal = document.getElementById('blDetailModal');
    if (modal && !modal.classList.contains('hidden')) _wlOpenBridgeDetail(w || row);
  }).catch((e) => {
    console.error('[wl-group]', e.message);
    el.value = (w && w.group_id) || '';
    alert(_t('common.saveError', 'บันทึกไม่สำเร็จ') + ': ' + e.message);
  });
}
function _wlDelete(plate) {
  fetch(`${API}/api/lpr/watchlist/${encodeURIComponent(plate)}`, { method: 'DELETE' }).then(() => _renderWGroupBar()).catch(console.error);
}
// Confirm lives HERE (the row button's own entry point), not inside _wlDelete
// itself — wlEditDelete() already confirms before calling _wlDelete directly,
// so putting it there too would prompt twice for that path.
function wlRowDelete(el) {
  if (!confirm(_t('lpr.wlDeleteConfirm', 'ลบรายการนี้ออกจากเฝ้าระวัง?'))) return;
  _wlDelete(el.dataset.plate);
}

// "+ เพิ่มกลุ่ม" via group <select>
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'wlGroup' && e.target.value === '__add') {
    const name = prompt(_t('lpr.wlGroupPrompt', 'ชื่อกลุ่มเฝ้าระวังใหม่'));
    if (name && name.trim()) {
      fetch(`${API}/api/lpr/watchlist/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
        .then(r => r.json()).then(() => _renderWatchlist()).catch(console.error);
    } else { e.target.value = _lprGroups[0]?.id || ''; }
  }
});
