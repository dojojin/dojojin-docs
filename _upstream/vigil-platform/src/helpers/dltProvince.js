// ============================================================
// Vigil Platform — Helper: DLT province code → Thai name
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// Dahua ANPR (TrafficJunction) reports the province as a Thailand DLT 3-letter
// registration code (e.g. SKA, BKK). lpr-core's TH_PROVINCE is numeric-index →
// name and never covered these codes, so `region` was stored as the raw code for
// Dahua reads. This canonical map (confirmed with the owner + cross-checked
// against high-volume plate data) resolves the code to the Thai province name.
// Unknown codes return null → callers keep the raw code (never a wrong name).
const DLT_PROVINCE = {
  ACR: 'อำนาจเจริญ', BTG: 'เบตง',
  ATG: 'อ่างทอง', AYA: 'พระนครศรีอยุธยา', BKK: 'กรุงเทพมหานคร', BKN: 'บึงกาฬ',
  BRM: 'บุรีรัมย์', CBI: 'ชลบุรี', CCO: 'ฉะเชิงเทรา', CMI: 'เชียงใหม่', CNT: 'ชัยนาท',
  CPM: 'ชัยภูมิ', CPN: 'ชุมพร', CRI: 'เชียงราย', CTI: 'จันทบุรี', KBI: 'กระบี่',
  KKN: 'ขอนแก่น', KPT: 'กำแพงเพชร', KRI: 'กาญจนบุรี', KSN: 'กาฬสินธุ์', LEI: 'เลย',
  LPG: 'ลำปาง', LPN: 'ลำพูน', LRI: 'ลพบุรี', MDH: 'มุกดาหาร', MKM: 'มหาสารคาม',
  MSN: 'แม่ฮ่องสอน', NAN: 'น่าน', NBI: 'นนทบุรี', NBP: 'หนองบัวลำภู', NKI: 'หนองคาย',
  NMA: 'นครราชสีมา', NPM: 'นครพนม', NPT: 'นครปฐม', NRT: 'นครศรีธรรมราช', NSN: 'นครสวรรค์',
  NWT: 'นราธิวาส', NYK: 'นครนายก', PBI: 'เพชรบุรี', PCT: 'พิจิตร', PKN: 'ประจวบคีรีขันธ์',
  PKT: 'ภูเก็ต', PLG: 'พัทลุง', PLK: 'พิษณุโลก', PNA: 'พังงา', PNB: 'เพชรบูรณ์',
  PRE: 'แพร่', PRI: 'ปราจีนบุรี', PTE: 'ปทุมธานี', PTN: 'ปัตตานี', PYO: 'พะเยา',
  RBR: 'ราชบุรี', RET: 'ร้อยเอ็ด', RNG: 'ระนอง', RYG: 'ระยอง', SBR: 'สิงห์บุรี',
  SKA: 'สงขลา', SKM: 'สมุทรสงคราม', SKN: 'สมุทรสาคร', SKW: 'สระแก้ว', SNI: 'สุราษฎร์ธานี',
  SNK: 'สกลนคร', SPB: 'สุพรรณบุรี', SPK: 'สมุทรปราการ', SRI: 'สระบุรี', SRN: 'สุรินทร์',
  SSK: 'ศรีสะเกษ', STI: 'สุโขทัย', STN: 'สตูล', TAK: 'ตาก', TRG: 'ตรัง', TRT: 'ตราด',
  UBN: 'อุบลราชธานี', UDN: 'อุดรธานี', UTI: 'อุทัยธานี', UTT: 'อุตรดิตถ์', YLA: 'ยะลา',
  YST: 'ยโสธร',
};

// Returns the Thai province name for a DLT code, or null for an unknown/blank
// code (and for 'UNKN' / '0' which the pipeline already treats as "unknown").
function dltProvince(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return null;
  if (c === 'UNKN' || c === '0') return 'ไม่ทราบ';   // system convention for unknown
  return DLT_PROVINCE[c] || null;
}

module.exports = { DLT_PROVINCE, dltProvince };
