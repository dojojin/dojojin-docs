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
  buggy: 'รถเล็ก/บักกี้', largeBus: 'รถบัส', bus: 'รถโดยสาร', pedestrian: 'คนเดินเท้า',
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
let _lprBound = false, _lprModalOpen = false;
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

function _lprApplySiteParam(params) {
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
function _lprVtypeVisible(code) {
  const c = window._lprVtypeCfg[code] || window._lprVtypeCfg[String(code).toLowerCase()];
  return !c || c.on !== false;   // default visible
}
function _lprVType(raw) {
  if (!raw) return '';
  const c = window._lprVtypeCfg[raw] || window._lprVtypeCfg[String(raw).toLowerCase()];
  if (c && c.label) return c.label;
  return _LPR_VTYPE[raw] || _LPR_VTYPE[String(raw).toLowerCase()] || raw;
}
function _lprBrandLabel(raw) { if (!raw) return ''; return _LPR_BRAND[String(raw)] || String(raw); }

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
  return _LPR_PCOLOR[pc] || pc;
}
function _lprFmtTime(t) {
  const d = new Date(t);
  return d.toLocaleString('th-TH', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && _lprModalOpen) { _lprCloseModal(); lprCloseAlert(); } });
    // modal backdrop click (X button is delegated via data-action)
    const modal = document.getElementById('lprModal');
    if (modal) modal.addEventListener('click', e => { if (e.target.id === 'lprModal') _lprCloseModal(); });
    const amodal = document.getElementById('lprAlertModal');
    if (amodal) amodal.addEventListener('click', e => { if (e.target.id === 'lprAlertModal') lprCloseAlert(); });
    _lprTickTimer = setInterval(_lprTick, 12000);
  }
  _switchLprTab('overview');
  _loadLprVtypeCfg().then(() => lprLoadOverview(), () => lprLoadOverview());
}

function _switchLprTab(tab) {
  const panels = { overview: 'lprTabOverview', search: 'lprTabSearch', alerts: 'lprTabAlerts', watchlist: 'lprTabWatchlist', noread: 'lprTabNoRead' };
  document.querySelectorAll('#lprTabBar .tab').forEach(b => b.classList.remove('active'));
  const active = document.querySelector(`#lprTabBar .tab[data-tab="${tab}"]`);
  if (active) active.classList.add('active');
  Object.entries(panels).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.style.display = k === tab ? '' : 'none'; });
  if (tab === 'search' && !window._lprRows.length) loadLpr(1);
  if (tab === 'alerts') loadLprAlerts(1);
  if (tab === 'watchlist') _renderWatchlistRO();
  if (tab === 'noread') loadLprNoRead(1);
}

function lprGotoAlerts() { _switchLprTab('alerts'); }

// ── No-read (ไม่ทราบทะเบียน) — ANPR events with no license_plates row.
// Reuses the exact same card renderer as the ค้นหา tab (_renderLprGrid/_lprCard
// already handle a null plate_number → "ไม่ระบุ" badge, built for exactly this
// case). Plain offset pagination — low volume (~850/day), no need for the
// search tab's keyset complexity.
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
function loadLprNoRead(page) {
  if (page) _lprNoReadPage = page;
  const params = _lprNoReadFilterParams();
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
    .then(res => res.json().then(rows => ({ rows, total: parseInt(res.headers.get('X-Total-Count') || '0', 10) })))
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
function _lprAlertRange() {
  const now = new Date(), sod = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  if (_lprAlertPeriod === 'today')     return { from: sod(now).toISOString() };
  if (_lprAlertPeriod === 'yesterday') return { from: sod(new Date(now - 86400000)).toISOString(), to: sod(now).toISOString() };
  if (_lprAlertPeriod === 'week')      return { from: new Date(now - 7 * 86400000).toISOString() };
  if (_lprAlertPeriod === 'month')     return { from: new Date(now - 30 * 86400000).toISOString() };
  return {};
}
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
    .then(res => res.json().then(rows => ({ rows, total: parseInt(res.headers.get('X-Total-Count') || '0', 10) })))
    .then(({ rows, total }) => {
      _lprAlertRows = Array.isArray(rows) ? rows : [];
      const cnt = document.getElementById('lprAlertCount'); if (cnt) cnt.textContent = `${total.toLocaleString()} ${_t('lpr.items','รายการ')}`;
      _renderLprAlertFeed(_lprAlertRows);
      renderPagination('lprAlertPager', _lprAlertPage, total, _LPR_ALERT_PER, p => loadLprAlerts(p), _t('lpr.items','รายการ'));
    }).catch(() => {});
}
function _renderLprAlertBars() {
  const pb = document.getElementById('lprAlertPeriodBar');
  if (pb) pb.innerHTML = [['all','ทั้งหมด'],['today','วันนี้'],['yesterday','เมื่อวาน'],['week','สัปดาห์นี้'],['month','เดือนนี้']]
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
    const meta = [h.region, _lprVType(h.vehicle_type || ''), h.camera_id].filter(Boolean).join(' · ');
    const thumb = (typeof lprPlaque === 'function') ? lprPlaque(h.plate_number, { vehicleType: h.vehicle_type, region: h.region }) : _esc(plate);
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
  if (!strip) return;
  const params = new URLSearchParams({ limit: '4' });
  _lprApplySiteParam(params);
  fetch(`${API}/api/lpr/alerts?${params}`).then(r => r.json()).then(rows => {
    const list = Array.isArray(rows) ? rows : [];
    if (block) block.style.display = list.length ? '' : 'none';
    strip.innerHTML = list.map(h => {
      const g = _groupById(h.group_id) || { name: h.group_id || '', color: 'var(--status-bad)' };
      const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate_number) : h.plate_number;
      return `<div class="alarm-card${g.id==='warrant'?' urgent':''}" style="--gc:${g.color}" data-action="lprGotoAlerts">
        <div class="alarm-row1"><span class="alarm-head-dot"></span><span class="alarm-grp">${_esc(g.name)}</span><span class="alarm-time">${_lprFmtTime(h.event_time)}</span></div>
        <div class="alarm-name">${_esc(plate)}</div>
        <div class="alarm-meta">${_esc(h.region || _lprVType(h.vehicle_type || ''))}</div>
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
function lprOpenAlert(idx) {
  const h = _lprAlertRows[idx]; if (!h) return;
  _lprAlertCur = h;
  const g = _groupById(h.group_id) || { name: h.group_id || '', color: 'var(--status-bad)' };
  const plate = (typeof lprPlateLabel === 'function') ? lprPlateLabel(h.plate_number) : h.plate_number;
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('lprAmBadge', el => { el.textContent = g.name; el.style.background = g.color; });
  set('lprAmPlate', el => el.textContent = plate);
  set('lprAmTime', el => el.textContent = _lprFmtTime(h.event_time));
  const sceneUrl = h.snapshot_file ? `${API}/snapshots/${encodeURIComponent(h.snapshot_file)}` : (h.plate_image ? `${API}/snapshots/${encodeURIComponent(h.plate_image)}` : null);
  set('lprAmCaptured', el => el.innerHTML = sceneUrl
    ? `<img src="${sceneUrl}?w=960" loading="lazy" decoding="async" data-err="hide" style="width:100%;border-radius:8px;display:block">`
    : `<div class="am-imggone">${(typeof lprPlaque==='function')?lprPlaque(h.plate_number,{vehicleType:h.vehicle_type,region:h.region}):_esc(plate)}</div>`);
  const refUrl = h.ref_image ? `${API}/snapshots/${encodeURIComponent(h.ref_image)}` : null;
  set('lprAmRef', el => el.innerHTML = refUrl
    ? `<img src="${refUrl}" data-err="hide" style="width:100%;border-radius:8px;display:block">`
    : `<div class="am-ref-empty">${_t('lpr.amRefEmpty','ยังไม่มีรูปอ้างอิง · ผู้แจ้งยังไม่อัปโหลด')}</div>`);
  const dot = h.vehicle_color ? _lprColorDot(h.vehicle_color) : '';
  const drows = [
    [_t('lpr.region','จังหวัด'), _esc(h.region || '—')],
    [_t('lpr.fType','ประเภทรถ'), _esc(_lprVType(h.vehicle_type || '') || '—')],
    h.vehicle_color ? [_t('lpr.vehicleColor','สีรถ'), `${dot}${_esc(_lprColorLang(h.vehicle_color))}`] : null,
    [_t('lpr.dCam','กล้อง'), _esc(h.camera_id || '—')],
    [_t('lpr.dTime','เวลา'), _lprFmtTime(h.event_time)],
  ].filter(Boolean);
  set('lprAmData', el => el.innerHTML = drows.map(([k,v]) => `<div class="lm-drow"><span class="lm-dk">${k}</span><span class="lm-dv">${v}</span></div>`).join(''));
  set('lprAmNote', el => el.innerHTML = `<span class="am-note-k">${_t('lpr.amNote','หมายเหตุ / หมายจับ')}</span><span class="am-note-v">${_esc(h.wl_notes || h.wl_label || '—')}</span>`);
  const ack = document.getElementById('lprAmAck'), log = document.getElementById('lprAmAckLog');
  if (ack && log) {
    if (h.acked_by) { ack.disabled = true; ack.textContent = _t('fmatch.acked','รับทราบแล้ว'); log.textContent = `${_t('fmatch.ackedBy','รับทราบโดย')} ${_esc(h.acked_by)} · ${_lprFmtTime(h.acked_at)}`; }
    else { ack.disabled = false; ack.textContent = _t('fmatch.ack','รับทราบ'); log.textContent = ''; }
  }
  _lprModalOpen = true;
  document.getElementById('lprAlertModal').style.display = 'flex';
}
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

function lprApplyPeriod() { if (_lprPeriod === 'custom') lprLoadOverview(); }

// ── Overview: KPI + charts + latest ────────────────────────────────
function lprLoadOverview() {
  const params = new URLSearchParams({ period: _lprPeriod });
  if (_lprPeriod === 'custom') {
    const f = (typeof getDtValue === 'function') ? getDtValue('lprPeriodFrom') : '';
    const t = (typeof getDtValue === 'function') ? getDtValue('lprPeriodTo') : '';
    if (f) params.set('from', new Date(f).toISOString());
    if (t) params.set('to', new Date(t).toISOString());
  }
  _lprApplySiteParam(params);
  fetch(`${API}/api/lpr/stats?${params}`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(d => { _renderLprKpi(d); _renderLprCharts(d); })
    .catch(err => {
      // Don't swallow: a 500 used to render as fake zeros, hiding real outages
      // (e.g. Postgres /dev/shm exhaustion). Surface it instead.
      console.error('[lpr] stats load failed:', err.message);
      if (typeof showToast === 'function') {
        showToast({ title: _t('lpr.statsErr', 'โหลดสถิติป้ายทะเบียนไม่สำเร็จ'), sub: _t('lpr.statsErrSub', 'เซิร์ฟเวอร์ตอบ error — ลองรีเฟรชอีกครั้ง'), page: 'lpr' });
      }
    });
  _loadWatchlistSet();
  loadLprLatest(false);
  renderLprAlarmStrip();   // RF-ALERT — overview alarm strip
  loadLprAlertCount();     // RF-ALERT — nav badge
}

function _renderLprKpi(d) {
  const el = document.getElementById('lprKpi'); if (!el) return;
  // distinct readable = local (≥2, ในพื้นที่) + visitor (=1, ต่างถิ่น)
  const distinct   = (d.local ?? 0) + (d.visitor ?? 0);
  const localPct   = distinct ? Math.round((d.local   / distinct) * 100) : 0;
  const visitorPct = distinct ? Math.round((d.visitor / distinct) * 100) : 0;
  const ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const items = [
    { ka: 'var(--accent)', label: _t('lpr.kpiTotal', 'ป้ายทั้งหมด'), val: (d.total ?? 0).toLocaleString(), sub: '', subc: 'var(--text-secondary)',
      icon: ic('<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="7" y1="12" x2="11" y2="12"/><line x1="13" y1="12" x2="18" y2="12"/>') },
    { ka: 'var(--status-ok)', label: _t('lpr.kpiLocal', 'ป้ายซ้ำ'), val: (d.local ?? 0).toLocaleString(), sub: d.local ? _t('lpr.viewList', 'ดูรายการ →') : `${localPct}% ${_t('lpr.inArea','ในพื้นที่')}`, subc: d.local ? 'var(--status-ok)' : 'var(--text-secondary)',
      action: d.local ? 'lprGotoLocal' : '',
      icon: ic('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>') },
    { ka: 'var(--accent)', label: _t('lpr.kpiVisitor', 'ป้ายไม่ซ้ำ'), val: (d.visitor ?? 0).toLocaleString(), sub: `${visitorPct}% ${_t('lpr.outArea','ต่างถิ่น')}`, subc: 'var(--text-secondary)',
      icon: ic('<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>') },
    { ka: 'var(--warn)', label: _t('lpr.kpiNoRead', 'ไม่ระบุ'), val: (d.noread ?? 0).toLocaleString(), sub: '', subc: 'var(--warn)',
      icon: ic('<path d="M3 3l18 18M10.5 5H19a2 2 0 0 1 2 2v8M5 7v10a2 2 0 0 0 2 2h11"/>') },
    { ka: 'var(--status-bad)', label: _t('lpr.kpiWatch', 'ตรงเฝ้าระวัง'), val: (d.watch ?? 0).toLocaleString(), sub: '', subc: d.watch ? 'var(--status-bad)' : 'var(--text-secondary)',
      icon: ic('<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>') },
    // รถ-ป้ายไม่ตรงกัน — a review flag (not an accusation): clickable → search tab.
    // Amber + magnifier tone: many are just OCR plate/type misreads, so it reads as
    // "worth a look", not "system caught a crime".
    { ka: 'var(--warn)', label: _t('lpr.kpiMismatch', 'รถ-ป้ายไม่ตรงกัน'), val: (d.mismatch ?? 0).toLocaleString(),
      sub: d.mismatch ? _t('lpr.viewSuspects', 'ดูรายการ →') : '', subc: d.mismatch ? 'var(--warn)' : 'var(--text-secondary)',
      action: d.mismatch ? 'lprGotoMismatch' : '',
      icon: ic('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>') },
    // ไม่ใส่หมวก — clickable → search filtered to no-helmet riders.
    { ka: 'var(--status-bad)', label: _t('lpr.noHelmet', 'ไม่ใส่หมวก'), val: (d.no_helmet ?? 0).toLocaleString(),
      sub: d.no_helmet ? _t('lpr.viewSuspects', 'ดูรายการ →') : '', subc: d.no_helmet ? 'var(--status-bad)' : 'var(--text-secondary)',
      action: d.no_helmet ? 'lprGotoHelmet' : '',
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
  const provLabels = (d.province || []).map(p => p.name);
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
  if (reg && !reg.options.length) { reg.innerHTML = `<option value="ไม่ทราบ">ไม่ทราบ</option>` + _LPR_PROVINCES.map(p => `<option value="${p}">${p}</option>`).join(''); mpRefresh('lprFilterRegion'); }
  const ty = document.getElementById('lprFilterType');
  if (ty && !ty.options.length) {
    const codes = ['twoWheelVehicle','SUVMPV','buggy','van','vehicle','truck','pickupTruck','largeBus','threeWheelVehicle','pedestrian'].filter(_lprVtypeVisible);
    ty.innerHTML = codes.map(c => `<option value="${c}">${_esc(_lprVType(c))}</option>`).join(''); mpRefresh('lprFilterType');
  }
  const vc = document.getElementById('lprFilterVColor');
  if (vc && !vc.options.length) { vc.innerHTML = [['black','ดำ'],['gray','เทา'],['white','ขาว'],['blue','น้ำเงิน'],['red','แดง'],['yellow','เหลือง'],['green','เขียว'],['brown','น้ำตาล'],['purple','ม่วง'],['unknown','ไม่ทราบ']].map(([v,l]) => `<option value="${v}">${l}</option>`).join(''); mpRefresh('lprFilterVColor'); }
  const pc = document.getElementById('lprFilterPColor');
  if (pc && !pc.options.length) { pc.innerHTML = [['white','ป้ายขาว'],['yellow','ป้ายเหลือง'],['red','ป้ายแดง'],['green','ป้ายเขียว'],['blue','ป้ายน้ำเงิน'],['black','ป้ายดำ'],['colorful','ป้ายประมูล'],['orange','ป้ายส้ม'],['__unknown','ไม่ทราบประเภทป้าย']].map(([v,l]) => `<option value="${v}">${l}</option>`).join(''); mpRefresh('lprFilterPColor'); }
  const hp = document.getElementById('lprFilterHasPlate');
  if (hp && !hp.options.length) hp.innerHTML = `<option value="">${_t('lpr.fAll','ทั้งหมด')}</option><option value="1">${_t('lpr.hasPlateYes','อ่านป้ายได้')}</option><option value="0">${_t('lpr.hasPlateNo','ไม่ระบุ')}</option>`;
  const ln = document.getElementById('lprFilterLane');
  if (ln && !ln.options.length) { ln.innerHTML = ['1','2','3'].map(l => `<option value="${l}">${_t('lpr.lane','เลน')} ${l}</option>`).join(''); mpRefresh('lprFilterLane'); }
  // Brand options come from the data (distinct codes + count); codes → names via _LPR_BRAND.
  const br = document.getElementById('lprFilterBrand');
  if (br && !br.options.length) {
    fetch(`${API}/api/lpr/brands`).then(r => r.ok ? r.json() : []).then(list => {
      br.innerHTML = (list || []).map(b => `<option value="${_esc(String(b.brand))}">${_esc(_lprBrandLabel(b.brand))}</option>`).join('');
      mpRefresh('lprFilterBrand');
    }).catch(() => {});
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
}
function lprResetSearch() { _lprResetFilters(); loadLpr(1); }

// Shared filter params (no limit/offset) — used by search + CSV export so they stay in sync.
function _lprFilterParams() {
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const params = new URLSearchParams();
  const q = g('lprSearchQ'); if (q) params.set('q', q);
  if (q && document.getElementById('lprExactMatch')?.checked) params.set('exact', '1');
  // MultiPicker multi-selects → csv params (cameras/regions/vehicle_types/…)
  const mpv = id => (typeof MultiPicker !== 'undefined') ? MultiPicker.values(id) : [];
  const setMulti = (id, key) => { const a = mpv(id); if (a.length) params.set(key, a.join(',')); };
  const hasCamPicker = mpv('lprFilterCam').length > 0;
  setMulti('lprFilterCam', 'cameras');
  if (!hasCamPicker) _lprApplySiteParam(params);
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
  params.set('limit', _LPR_LIMIT);
  params.set('count', 'est');
  const cur = _lprPageCursors[_lprPage];
  if (cur) { params.set('before_time', cur.t); params.set('before_id', cur.id); }

  const grid = document.getElementById('lprGrid');
  if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-secondary)">${_t('common.loading','กำลังโหลด...')}</div>`;
  let est = 0;
  fetch(`${API}/api/lpr?${params}`)
    .then(r => {
      _lprHasMore = r.headers.get('X-Has-More') === '1';
      est = parseInt(r.headers.get('X-Estimated-Count') || '0', 10);
      return r.json();
    })
    .then(rows => {
      window._lprRows = Array.isArray(rows) ? rows : [];
      // Store the cursor to fetch the NEXT page (last row of this page).
      if (_lprHasMore && window._lprRows.length) {
        const last = window._lprRows[window._lprRows.length - 1];
        _lprPageCursors[_lprPage + 1] = { t: last.event_time, id: last.id };
      }
      // Exact total once we reach the last page; estimate otherwise.
      _lprExact = !_lprHasMore;
      _lprTotal = _lprExact ? (_lprPage - 1) * _LPR_LIMIT + window._lprRows.length : est;
      const rc = document.getElementById('lprResCount');
      if (rc) rc.textContent = (_lprExact ? '' : '≈') + _lprTotal.toLocaleString();
      _renderLprGrid(window._lprRows, 'lprGrid', 'lpr');
      _renderLprPagination();
    })
    .catch(() => { if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--status-bad)">${_t('common.loadFailedShort','โหลดไม่สำเร็จ')}</div>`; });
}

// Export the current search (all matching rows, not just the page) to CSV.
// Reuses _lprFilterParams so the export matches what's on screen.
async function lprExportCsv() {
  const btn = document.querySelector('[data-action="lprExportCsv"]');
  if (btn) { btn.disabled = true; }
  try {
    const params = _lprFilterParams();
    params.set('limit', '5000');   // cap — guards against runaway exports
    params.set('offset', '0');
    const res = await fetch(`${API}/api/lpr?${params}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) { alert(_t('lpr.noData', 'ไม่พบข้อมูลป้ายทะเบียน')); return; }
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
    if (btn) btn.disabled = false;
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
        ${region ? `<div class="lpr-region">${_esc(region)}</div>` : ''}
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
  // RF4 — when the JPG is gone (retention-pruned at lpr_image_retention_days, or
  // missing) but the row is kept: show a fallback (plate→plaque, scene→vehicle
  // vector) layered BEHIND the <img>. The image covers it when present; on 404 the
  // global data-err="hide" handler hides the img → the fallback shows. No flash.
  const _vtype = ev.lp_vehicle_type || rj.vehicleType || '';
  const _fbCtx = { vtype: _vtype, plateColor, region, vcolorLabel: vcolor ? _lprColorLang(vcolor) : '' };
  document.getElementById('lmReal').innerHTML  = _lprMediaBox(cropUrl,  _lprMediaFallback('plate', ev, _fbCtx));
  // Display a w=960 thumbnail in the modal (≈120KB vs ≈600KB full); the full
  // sceneUrl is kept for the "view full" + download buttons below.
  document.getElementById('lmScene').innerHTML = _lprMediaBox(sceneUrl ? sceneUrl + '?w=960' : null, _lprMediaFallback('scene', ev, _fbCtx));
  document.getElementById('lmPlaque').innerHTML = (typeof lprPlaque === 'function')
    ? lprPlaque(ev.plate_number, { vehicleType: ev.lp_vehicle_type || rj.vehicleType, plateColor, region, big: true, showProv: true })
    : _esc(ev.plate_number);

  const dot = vcolor ? _lprColorDot(vcolor) : '';
  const plateTxt = (typeof lprPlateLabel === 'function') ? lprPlateLabel(ev.plate_number) : ev.plate_number;
  const pcHex = _LPR_PCOLOR_HEX[plateColor] || 'var(--surface-overlay)';
  const rows = [
    [_t('lpr.watchlistPlate', 'ป้ายทะเบียน'), _esc(plateTxt)],
    region ? [_t('lpr.region', 'จังหวัด'), _esc(region)] : null,
    [_t('lpr.fType', 'ประเภทรถ'), _esc(_lprVType(ev.lp_vehicle_type || rj.vehicleType || '')) || '–'],
    vcolor ? [_t('lpr.vehicleColor', 'สีรถ'), `${dot}${_esc(_lprColorLang(vcolor))}`] : null,
    plateColor ? [_t('lpr.plateColor', 'สีป้าย'), `<span class="lm-pswatch" style="background:${pcHex}"></span>${_esc(_lprPColorLabel(plateColor))}`] : null,
    rj.laneNo ? [_t('lpr.lane', 'เลน'), _esc(rj.laneNo)] : null,
    // Motorcycle speed suppressed — camera-reported values run ~3x too high for
    // two-wheelers (live-verified: avg 100 km/h vs ~30 km/h for cars on the same
    // road; a screenshot showed 145 km/h on a rider casually riding alongside
    // traffic). Likely a perspective/bbox-calibration mismatch for the shorter
    // profile, unconfirmed. Kept in raw_json for future investigation, just not
    // rendered here until the reading can be trusted.
    (rj.speed != null && _vtype !== 'twoWheelVehicle')
      ? [_t('lpr.speed', 'ความเร็ว'), `${_esc(rj.speed)} km/h`] : null,
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
    brand ? ['ยี่ห้อ', _esc(_lprBrandLabel(brand))] : null,
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
      if (sceneUrl) rmk.querySelector('.lm-rmk-link')?.addEventListener('click', () => window.open(sceneUrl, '_blank', 'noopener'));
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
    zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); window.open(sceneUrl, '_blank', 'noopener'); });
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
        `<button class="btn btn-secondary lm-actbtn" data-action="lprSaveImg" data-url="${_esc(sceneUrl)}" data-name="${_esc(fname)}">${dlSvg}${_t('lpr.saveImg','บันทึกรูป')}</button>`;
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
          ${cell(r.region, rVary, v => _esc(v))}
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
        `<div class="lm-mm-note">${_t('lpr.swapSuspectNote','ป้ายนี้ถูกอ่านพบกับรถที่ลักษณะต่างกันใน 30 วัน — ช่องที่ไฮไลต์คือจุดที่ไม่ตรง')}</div>
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
      const rowsHtml = shown.map((r, i) => `
        <div class="lm-mm-row lm-mm-row-click" data-action="lprRepeatOpenRow" data-idx="${i}">
          <span class="lm-mm-time">${_lprFmtTime(r.event_time)}</span>
          <span>${_esc(_lprVType(r.vehicle_type) || r.vehicle_type || '–')}</span>
          <span>${r.vehicle_color ? `${_lprColorDot(r.vehicle_color)}${_esc(_lprColorLang(r.vehicle_color))}` : '–'}</span>
          <span>${_esc((typeof _lprBrandLabel === 'function' ? _lprBrandLabel(r.vehicle_brand) : r.vehicle_brand) || '–')}</span>
          <span class="lm-mm-cam">${_esc(r.camera_id || '')}</span>
        </div>`).join('');
      const hdr = `<div class="lm-mm-row lm-mm-hdr">
          <span class="lm-mm-time">${_t('lpr.dTime','เวลา')}</span>
          <span>${_t('lpr.fType','ประเภทรถ')}</span><span>${_t('lpr.vehicleColor','สีรถ')}</span><span>${_t('lpr.brand','ยี่ห้อ')}</span>
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
function _lprOpenRead(r, plate) {
  if (!r) return;
  if (window._lprCurrentEv) _lprModalStack.push(window._lprCurrentEv);
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
  if (prev) _lprOpenModal(prev);
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
  const reg = document.getElementById('wlRegion');
  if (reg) reg.innerHTML = `<option value="">— ไม่ระบุ —</option><option value="ไม่ทราบ">ไม่ทราบ</option>` + _LPR_PROVINCES.map(p => `<option value="${p}">${p}</option>`).join('');
  const grp = document.getElementById('wlGroup');
  if (grp) grp.innerHTML = _lprGroups.map(g => `<option value="${_esc(g.id)}">${_esc(g.name)}</option>`).join('') + `<option value="__add">${_t('lpr.wlAddGroup','+ เพิ่มกลุ่ม')}</option>`;
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

function _wlSetFilter(id) { _wlFilter = id; _renderWGroupBar(); }

function _renderWlList() {
  const el = document.getElementById('wlList'); if (!el) return;
  const rows = (window._lprWlRows || []).filter(w => _wlFilter === 'all' || w.group_id === _wlFilter);
  if (!rows.length) { el.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:10px 0">${_t('lpr.watchlistEmpty','ยังไม่มีรายการเฝ้าระวัง')}</div>`; return; }
  el.innerHTML = rows.map(w => {
    const g = _groupById(w.group_id) || { name: '', color: '#888' };
    const modeTxt = w.alert_mode === 'plate_region' ? _t('lpr.wlModePlateRegion', 'ป้าย + จังหวัด') : _t('lpr.wlModePlate', 'ป้ายอย่างเดียว');
    const img = w.ref_image ? `<img class="wl-ref" src="${API}/snapshots/${_esc(w.ref_image)}" data-err="hide">` : `<div class="wl-ref">—</div>`;
    return `<div class="wl-row">
      ${img}
      <span class="wl-plate" style="color:${w.active ? 'var(--accent)' : 'var(--text-secondary)'}">${_esc(w.plate_number)}</span>
      <div class="wl-info">
        <div class="l1">
          ${w.group_id ? `<span class="wl-badge" style="background:${_esc(g.color)};color:#fff">${_esc(g.name)}</span>` : ''}
          <span class="wl-mode">${_t('lpr.wlMatch','จับคู่')}: ${modeTxt}</span>
          ${w.region ? `<span class="wl-mode">${_esc(w.region)}</span>` : ''}
          ${w.notify_line ? `<span class="wl-mode" style="border-color:var(--status-bad);color:var(--status-bad)">${_t('lpr.wlLineNow','LINE ทันที')}</span>` : ''}
        </div>
        ${w.notes ? `<div class="note">${_esc(w.notes)}</div>` : ''}
      </div>
      <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px" data-action="wlToggle" data-plate="${_esc(w.plate_number)}" data-active="${!w.active}">${w.active ? _t('common.disable','ปิด') : _t('common.enable','เปิด')}</button>
      <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;color:var(--status-bad)" data-action="wlDelete" data-plate="${_esc(w.plate_number)}">${_t('common.delete','ลบ')}</button>
    </div>`;
  }).join('');
}

// RF1 — read-only watchlist view for the LPR gallery tab (management is in
// Settings › ระบบ LPR). Filter chips + cards, no add form / toggle / delete.
let _wlRoFilter = 'all';
function _wlSetFilterRo(id) { _wlRoFilter = id; _renderWatchlistRO(); }
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
      const frows = rows.filter(w => _wlRoFilter === 'all' || w.group_id === _wlRoFilter);
      if (!frows.length) { list.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:10px 0">${_t('lpr.watchlistEmpty','ยังไม่มีรายการเฝ้าระวัง')}</div>`; return; }
      list.innerHTML = frows.map(w => {
        const g = _groupById(w.group_id) || { name: '', color: '#888' };
        const modeTxt = w.alert_mode === 'plate_region' ? _t('lpr.wlModePlateRegion', 'ป้าย + จังหวัด') : _t('lpr.wlModePlate', 'ป้ายอย่างเดียว');
        const img = w.ref_image ? `<img class="wl-ref" src="${API}/snapshots/${_esc(w.ref_image)}" data-err="hide">` : `<div class="wl-ref">—</div>`;
        return `<div class="wl-row">
          ${img}
          <span class="wl-plate" style="color:${w.active ? 'var(--accent)' : 'var(--text-secondary)'}">${_esc(w.plate_number)}</span>
          <div class="wl-info"><div class="l1">
            ${w.group_id ? `<span class="wl-badge" style="background:${_esc(g.color)};color:#fff">${_esc(g.name)}</span>` : ''}
            <span class="wl-mode">${_t('lpr.wlMatch','จับคู่')}: ${modeTxt}</span>
            ${w.region ? `<span class="wl-mode">${_esc(w.region)}</span>` : ''}
            ${!w.active ? `<span class="wl-mode" style="opacity:.7">${_t('common.disabled','ปิดอยู่')}</span>` : ''}
          </div>${w.notes ? `<div class="note">${_esc(w.notes)}</div>` : ''}</div>
        </div>`;
      }).join('');
    }).catch(() => {});
  });
}

// RF2 — group manager (rename / color / delete / add) in Settings › ระบบ LPR.
function _renderWlGroupMgr() {
  const el = document.getElementById('wlGroupMgr'); if (!el) return;
  _loadGroups(() => {
    el.innerHTML = _lprGroups.map(g => `
      <div class="wl-grp-row">
        <input type="color" value="${_esc(g.color || '#5b8def')}" data-change="wlGroupColor" data-gid="${_esc(g.id)}">
        <input class="form-input" value="${_esc(g.name)}" data-input="wlGroupRename" data-gid="${_esc(g.id)}">
        <button class="btn btn-secondary" style="color:var(--status-bad)" data-action="wlGroupDelete" data-gid="${_esc(g.id)}">${_t('common.delete','ลบ')}</button>
      </div>`).join('') +
      `<button class="btn btn-secondary wl-grp-add" data-action="wlGroupAddNew">${_t('lpr.wlAddGroup','+ เพิ่มกลุ่ม')}</button>`;
  });
}
function _wlGroupRefresh() { _renderWlGroupMgr(); fillWatchlistSelects(); _renderWGroupBar(); }
function wlGroupAddNew() {
  const name = prompt(_t('lpr.wlGroupPrompt', 'ชื่อกลุ่มเฝ้าระวังใหม่')); if (!name || !name.trim()) return;
  fetch(`${API}/api/lpr/watchlist/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
    .then(() => _wlGroupRefresh()).catch(console.error);
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
    group_id: group && group !== '__add' ? group : null,
    alert_mode: document.getElementById('wlMode')?.value || 'plate',
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

function _wlToggle(plate, active) {
  fetch(`${API}/api/lpr/watchlist/${encodeURIComponent(plate)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) })
    .then(() => _renderWGroupBar()).catch(console.error);
}
function _wlDelete(plate) {
  fetch(`${API}/api/lpr/watchlist/${encodeURIComponent(plate)}`, { method: 'DELETE' }).then(() => _renderWGroupBar()).catch(console.error);
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
