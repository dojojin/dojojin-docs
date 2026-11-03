// ============================================================
// Vigil Platform — Thai province names (TH -> EN)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ONE copy, loaded by both sides. The dashboard reads it as a <script> global;
// the server require()s the same file for report rendering. Reports render
// twice — as a live HTML preview in the browser and as a PNG/PDF built
// server-side by report-renderer.js — and a second hand-copied dictionary is
// how those two drift into disagreeing about the same report.
//
// Cameras report the province in Thai (lp.region). Anything not in the map
// falls through unchanged rather than becoming blank: an untranslated province
// is readable, a missing one is not.
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;   // node
  else { root.PROVINCE_NAME_EN = m.PROVINCE_NAME_EN; root.provinceNameEn = m.provinceNameEn; }
}(typeof self !== 'undefined' ? self : this, function () {
  const PROVINCE_NAME_EN = {
  'กรุงเทพมหานคร':'Bangkok','กระบี่':'Krabi','กาญจนบุรี':'Kanchanaburi','กาฬสินธุ์':'Kalasin','กำแพงเพชร':'Kamphaeng Phet',
  'ขอนแก่น':'Khon Kaen','จันทบุรี':'Chanthaburi','ฉะเชิงเทรา':'Chachoengsao','ชลบุรี':'Chon Buri','ชัยนาท':'Chai Nat',
  'ชัยภูมิ':'Chaiyaphum','ชุมพร':'Chumphon','เชียงราย':'Chiang Rai','เชียงใหม่':'Chiang Mai','ตรัง':'Trang',
  'ตราด':'Trat','ตาก':'Tak','นครนายก':'Nakhon Nayok','นครปฐม':'Nakhon Pathom','นครพนม':'Nakhon Phanom',
  'นครราชสีมา':'Nakhon Ratchasima','นครศรีธรรมราช':'Nakhon Si Thammarat','นครสวรรค์':'Nakhon Sawan','นนทบุรี':'Nonthaburi','นราธิวาส':'Narathiwat',
  'น่าน':'Nan','บึงกาฬ':'Bueng Kan','บุรีรัมย์':'Buriram','เบตง':'Betong','ปทุมธานี':'Pathum Thani',
  'ประจวบคีรีขันธ์':'Prachuap Khiri Khan','ปราจีนบุรี':'Prachinburi','ปัตตานี':'Pattani','พระนครศรีอยุธยา':'Phra Nakhon Si Ayutthaya','พังงา':'Phang Nga',
  'พัทลุง':'Phatthalung','พิจิตร':'Phichit','พิษณุโลก':'Phitsanulok','เพชรบุรี':'Phetchaburi','เพชรบูรณ์':'Phetchabun',
  'แพร่':'Phrae','พะเยา':'Phayao','ภูเก็ต':'Phuket','มหาสารคาม':'Maha Sarakham','มุกดาหาร':'Mukdahan',
  'แม่ฮ่องสอน':'Mae Hong Son','ยะลา':'Yala','ยโสธร':'Yasothon','ร้อยเอ็ด':'Roi Et','ระนอง':'Ranong',
  'ระยอง':'Rayong','ราชบุรี':'Ratchaburi','ลพบุรี':'Lop Buri','ลำปาง':'Lampang','ลำพูน':'Lamphun',
  'เลย':'Loei','ศรีสะเกษ':'Si Sa Ket','สกลนคร':'Sakon Nakhon','สงขลา':'Songkhla','สตูล':'Satun',
  'สมุทรปราการ':'Samut Prakan','สมุทรสงคราม':'Samut Songkhram','สมุทรสาคร':'Samut Sakhon','สระแก้ว':'Sa Kaeo','สระบุรี':'Saraburi',
  'สิงห์บุรี':'Sing Buri','สุโขทัย':'Sukhothai','สุพรรณบุรี':'Suphan Buri','สุราษฎร์ธานี':'Surat Thani','สุรินทร์':'Surin',
  'หนองคาย':'Nong Khai','หนองบัวลำภู':'Nong Bua Lam Phu','อ่างทอง':'Ang Thong','อุดรธานี':'Udon Thani','อุทัยธานี':'Uthai Thani',
  'อุตรดิตถ์':'Uttaradit','อุบลราชธานี':'Ubon Ratchathani','อำนาจเจริญ':'Amnat Charoen',
  };
  // lang !== 'en' returns the Thai name untouched — Thai IS the stored form.
  function provinceNameEn(name, lang) {
    if (!name) return name;
    return lang === 'en' ? (PROVINCE_NAME_EN[String(name).trim()] || name) : name;
  }
  return { PROVINCE_NAME_EN, provinceNameEn };
}));
