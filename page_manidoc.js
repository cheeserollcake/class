/* 마니또 결과 문서: 한글(.hwpx) / 워드(.docx) / 인쇄
   A4 세로, 여백 5mm, 페이지를 꽉 채운 표를 학생 수만큼 같은 크기 칸으로 나누고
   칸 위에는 큰 글씨로 본인 이름, 아래에는 작은 글씨로 마니또 이름 */
(() => {
'use strict';
const APP = window.APP;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeFile = (s) => String(s || '마니또').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || '마니또';
const PAGE = { w: 210, h: 297, m: 5 };   // mm

/* 칸 배치: 학생 수에 맞춰 열·행 수 정하기 (칸이 가로로 조금 넓은 모양이 되도록) */
function layout(rows) {
  const N = Math.max(1, rows.length), W = PAGE.w - PAGE.m * 2, H = PAGE.h - PAGE.m * 2;
  let best = null;
  for (let c = 1; c <= 8; c++) {
    const r = Math.ceil(N / c), cw = W / c, ch = H / r, sc = Math.abs(Math.log((cw / ch) / 1.5)) + (r * c - N) * 0.01;
    if (!best || sc < best.sc) best = { c, r, cw, ch, sc };
  }
  const longest = Math.max(2, ...rows.map((x) => [...String(x.me)].length), ...rows.map((x) => [...String(x.to)].length * 0.45));
  const pt = (mm) => mm * 72 / 25.4;
  const big = Math.max(10, Math.min(72, pt(best.ch) * 0.36, pt(best.cw) * 0.85 / longest));
  return { ...best, W, H, big: Math.round(big), small: Math.max(9, Math.round(big * 0.5)) };
}
const cellsOf = (rows, L) => Array.from({ length: L.r }, (_, i) => Array.from({ length: L.c }, (_, j) => rows[i * L.c + j] || null));

/* ---------------- 한글 (HWPX) ---------------- */
const NS = 'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
const HU = (mm) => Math.round(mm * 7200 / 25.4);   // HWPUNIT (1/7200 inch)
const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];
const seven = (v) => `hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"`;

function hwpxHeader(L) {
  const font = '<hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>';
  const border = (id, type) => `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
    ['leftBorder', 'rightBorder', 'topBorder', 'bottomBorder'].map((b) => `<hh:${b} type="${type}" width="0.12 mm" color="#000000"/>`).join('') + '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>';
  const charPr = (id, size, color, bold) => `<hh:charPr id="${id}" height="${size * 100}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">` +
    `<hh:fontRef ${seven(0)}/><hh:ratio ${seven(100)}/><hh:spacing ${seven(0)}/><hh:relSz ${seven(100)}/><hh:offset ${seven(0)}/>${bold ? '<hh:bold/>' : ''}` +
    '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>';
  const marg = (ls) => '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>' +
    `<hh:lineSpacing type="PERCENT" value="${ls}" unit="HWPUNIT"/>`;
  const paraPr = (id, align, ls) => `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">` +
    `<hh:align horizontal="${align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>` +
    '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/>' +
    `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${marg(ls)}</hp:case><hp:default>${marg(ls)}</hp:default></hp:switch>` +
    '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>';
  return XML + `<hh:head ${NS} version="1.4" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>` +
    `<hh:fontfaces itemCnt="7">${LANGS.map((l) => `<hh:fontface lang="${l}" fontCnt="1">${font}</hh:fontface>`).join('')}</hh:fontfaces>` +
    `<hh:borderFills itemCnt="3">${border(1, 'NONE')}${border(2, 'NONE')}${border(3, 'SOLID')}</hh:borderFills>` +
    `<hh:charProperties itemCnt="4">${charPr(0, 10, '#000000', false)}${charPr(1, L.big, '#000000', true)}${charPr(2, L.small, '#444444', false)}${charPr(3, 1, '#000000', false)}</hh:charProperties>` +
    '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>' +
    `<hh:paraProperties itemCnt="3">${paraPr(0, 'JUSTIFY', 160)}${paraPr(1, 'CENTER', 115)}${paraPr(2, 'LEFT', 100)}</hh:paraProperties>` +
    '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>' +
    '</hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument><hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>';
}
function hwpxSection(rows, L) {
  const m = HU(PAGE.m), pw = 59528, ph = 84186;
  const tw = pw - m * 2, thAll = ph - m * 2 - 400;    // 다음 쪽으로 넘어가지 않게 조금 여유
  const cw = Math.floor(tw / L.c), ch = Math.floor(thAll / L.r);
  let pid = 1;
  const para = (pr, cp, text) => `<hp:p id="${pid++}" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cp}">${text ? `<hp:t>${esc(text)}</hp:t>` : ''}</hp:run></hp:p>`;
  const cell = (x, i, j) => `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="3">` +
    '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
    (x ? para(1, 1, x.me) + para(1, 2, x.to) : para(1, 0, '')) +
    `</hp:subList><hp:cellAddr colAddr="${j}" rowAddr="${i}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${cw}" height="${ch}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  const tbl = `<hp:tbl id="1000" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${L.r}" colCnt="${L.c}" cellSpacing="0" borderFillIDRef="3" noAdjust="0">` +
    `<hp:sz width="${cw * L.c}" widthRelTo="ABSOLUTE" height="${ch * L.r}" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="141" right="141" top="141" bottom="141"/>' +
    cellsOf(rows, L).map((r, i) => `<hp:tr>${r.map((x, j) => cell(x, i, j)).join('')}</hp:tr>`).join('') + '</hp:tbl>';
  const pbf = (t) => `<hp:pageBorderFill type="${t}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`;
  const secPr = '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">' +
    '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
    '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>' +
    '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
    `<hp:pagePr landscape="WIDELY" width="${pw}" height="${ph}" gutterType="LEFT_ONLY"><hp:margin header="0" footer="0" gutter="0" left="${m}" right="${m}" top="${m}" bottom="${m}"/></hp:pagePr>` +
    '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>' +
    '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>' +
    pbf('BOTH') + pbf('EVEN') + pbf('ODD') + '</hp:secPr>';
  return XML + `<hs:sec ${NS}><hp:p id="0" paraPrIDRef="2" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="3">${secPr}<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl></hp:run>` +
    `<hp:run charPrIDRef="3">${tbl}<hp:t/></hp:run></hp:p></hs:sec>`;
}
function hwpx(title, rows) {
  const L = layout(rows);
  const files = [
    { name: 'mimetype', text: 'application/hwp+zip' },
    { name: 'version.xml', text: XML + '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="12, 0, 0, 0 WIN32LEWindows_10"/>' },
    { name: 'Contents/header.xml', text: hwpxHeader(L) },
    { name: 'Contents/section0.xml', text: hwpxSection(rows, L) },
    { name: 'Preview/PrvText.txt', text: rows.map((x) => `${x.me} → ${x.to}`).join('\r\n') },
    { name: 'settings.xml', text: XML + '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>' },
    { name: 'META-INF/container.xml', text: XML + '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/></ocf:rootfiles></ocf:container>' },
    { name: 'META-INF/manifest.xml', text: XML + '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>' },
    { name: 'META-INF/container.rdf', text: XML + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description><rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>' },
    { name: 'Contents/content.hpf', text: XML + `<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language></opf:metadata>` +
      '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>' +
      '<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>' }
  ];
  APP.xl.saveBlob(APP.xl.zipStore(files, 'application/hwp+zip'), safeFile(title) + '.hwpx');
}

/* ---------------- 워드 (DOCX) ---------------- */
function docx(title, rows) {
  const L = layout(rows), TW = (mm) => Math.round(mm * 1440 / 25.4);   // twip
  const m = TW(PAGE.m), pw = 11906, ph = 16838, cw = Math.floor((pw - m * 2) / L.c), rh = Math.floor((ph - m * 2 - 120) / L.r);
  const run = (t, sz, bold, color) => `<w:r><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="맑은 고딕" w:hAnsi="Malgun Gothic"/>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${sz * 2}"/><w:szCs w:val="${sz * 2}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const p = (inner) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${inner}</w:p>`;
  const bd = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`).join('');
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${cw * L.c}" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${Array.from({ length: L.c }, () => `<w:gridCol w:w="${cw}"/>`).join('')}</w:tblGrid>` +
    cellsOf(rows, L).map((r) => `<w:tr><w:trPr><w:trHeight w:val="${rh}" w:hRule="exact"/><w:cantSplit/></w:trPr>` +
      r.map((x) => `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${x ? p(run(x.me, L.big, true)) + p(run(x.to, L.small, false, '444444')) : p('')}</w:tc>`).join('') + '</w:tr>').join('') + '</w:tbl>';
  const doc = XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + table +
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>' +
    `<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files = [
    { name: '[Content_Types].xml', text: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', text: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', text: doc }
  ];
  APP.xl.saveBlob(APP.xl.zipStore(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), safeFile(title) + '.docx');
}

/* ---------------- 인쇄 ---------------- */
function print(title, rows) {
  const L = layout(rows);
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 portrait; margin: 5mm; }
    html, body { margin: 0; font-family: Pretendard, 'Malgun Gothic', sans-serif; }
    table { width: ${L.W}mm; height: ${L.H - 1}mm; border-collapse: collapse; table-layout: fixed; }
    td { border: 0.3mm solid #000; text-align: center; vertical-align: middle; width: ${L.W / L.c}mm; height: ${(L.H - 1) / L.r}mm; overflow: hidden; }
    .me { font-size: ${L.big}pt; font-weight: 700; line-height: 1.15; } .to { font-size: ${L.small}pt; color: #444; line-height: 1.2; }
  </style></head><body><table>${cellsOf(rows, L).map((r) => `<tr>${r.map((x) => `<td>${x ? `<div class="me">${esc(x.me)}</div><div class="to">${esc(x.to)}</div>` : ''}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 2000); }, 400);
}

APP.maniDoc = { hwpx, docx, print, layout };
})();
