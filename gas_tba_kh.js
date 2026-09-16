/**
 * GOOGLE APPS SCRIPT - THEO DÕI TIẾN ĐỘ PHÁT TRIỂN TRẠM KHÁCH HÀNG (TBA KH)
 * Spreadsheet: https://docs.google.com/spreadsheets/d/17tJxLIPGAdxQY3fJlSogvvTinQAAizTVoh2B1fClY5E/edit
 * 
 * ==============================================================================
 * HƯỚNG DẪN CÀI ĐẶT:
 * 1. Mở Google Sheet → Extensions → Apps Script
 * 2. Xóa hết nội dung Code.gs, dán toàn bộ code này vào, Ctrl+S
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL deployment → dán vào file app.js (biến GAS_URL)
 * ==============================================================================
 * 
 * CẤU TRÚC CỘT GOOGLE SHEET (Sheet: DS PT TRẠM KH):
 * A: STT | B: Tên công trình | C: Địa chỉ | D: Liên hệ | E: Xây Lắp | F: KVA
 * G: Đề nghị | H: TNTK (số CV) | I: TNTK (ngày) | J: TTĐN | K: Hợp đồng | L: Đo đếm | M: Đóng điện
 * ==============================================================================
 */

const SHEET_ID = '17tJxLIPGAdxQY3fJlSogvvTinQAAizTVoh2B1fClY5E';

// Tài khoản đăng nhập cho các phòng/đội
const ACCOUNTS = {
  'ktat':   { password: 'ktat123',   role: 'ktat',   name: 'Phòng KTAT' },
  'dvkh':   { password: 'dvkh123',   role: 'dvkh',   name: 'Đội Dịch vụ Khách hàng' },
  'qlhtdd': { password: 'qlhtdd123', role: 'qlhtdd', name: 'Đội Quản lý HTĐĐ' },
  'vhld':   { password: 'vhld123',   role: 'vhld',   name: 'Đội Vận hành Lưới điện' }
};

// Mapping role → cột Sheet mà role đó được phép cập nhật
// Cột tính từ 1: G=7, H=8, I=9, K=11, L=12, M=13
const ROLE_COLUMN_MAP = {
  'ktat':   { cols: [7, 9], names: ['Đề nghị', 'TNTK (ngày)'] },       // Cột G, I
  'dvkh':   { cols: [11],   names: ['Hợp đồng'] },                       // Cột K
  'qlhtdd': { cols: [12],   names: ['Đo đếm'] },                         // Cột L
  'vhld':   { cols: [13],   names: ['Đóng điện'] }                       // Cột M
};

// ==============================================================================
// HELPER: Mở Spreadsheet
// ==============================================================================
function getSpreadsheet() {
  try {
    return SpreadsheetApp.openById(SHEET_ID);
  } catch (e) {
    return null;
  }
}

// ==============================================================================
// HELPER: Trả JSON output (hỗ trợ JSONP nếu có callback)
// ==============================================================================
function createOutput(dataObj, e) {
  var jsonStr = JSON.stringify(dataObj);
  var callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + jsonStr + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}

// ==============================================================================
// HELPER: Đọc toàn bộ dữ liệu trạm từ Sheet
// ==============================================================================
function readAllStations() {
  var ss = getSpreadsheet();
  if (!ss) return [];

  var sheet = ss.getSheetByName('DS PT TRẠM KH') || ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 13).getDisplayValues();
  var stations = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var stt = row[0];
    var name = String(row[1] || '').trim();
    if (!name) continue; // Skip empty rows

    stations.push({
      row: i + 2,          // Sheet row number (1-indexed, after header)
      stt: stt,
      name: name,
      address: String(row[2] || '').trim(),
      contact: String(row[3] || '').trim(),
      xayLap: String(row[4] || '').trim(),
      kva: String(row[5] || '').trim(),
      deNghi: String(row[6] || '').trim(),        // G: Đề nghị (ngày)
      tntkSoCV: String(row[7] || '').trim(),       // H: TNTK số CV
      tntkNgay: String(row[8] || '').trim(),       // I: TNTK ngày
      ttdn: String(row[9] || '').trim(),           // J: TTĐN (thường trống)
      hopDong: String(row[10] || '').trim(),       // K: Hợp đồng
      doDem: String(row[11] || '').trim(),         // L: Đo đếm
      dongDien: String(row[12] || '').trim()       // M: Đóng điện
    });
  }

  return stations;
}

// ==============================================================================
// GET REQUEST
// ==============================================================================
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'get_data';

    // --- LOGIN ---
    if (action === 'login') {
      var username = (e.parameter.username || '').trim().toLowerCase();
      var password = (e.parameter.password || '').trim();
      var account = ACCOUNTS[username];

      if (!account || account.password !== password) {
        return createOutput({ status: 'error', message: 'Sai tài khoản hoặc mật khẩu' }, e);
      }

      return createOutput({
        status: 'success',
        user: {
          username: username,
          role: account.role,
          name: account.name
        }
      }, e);
    }

    // --- GET DATA ---
    var stations = readAllStations();
    return createOutput({
      status: 'success',
      stations: stations,
      total: stations.length,
      timestamp: new Date().toISOString()
    }, e);

  } catch (error) {
    return createOutput({ status: 'error', message: error.toString() }, e);
  }
}

// ==============================================================================
// POST REQUEST
// ==============================================================================
function doPost(e) {
  try {
    var payload = '';
    if (e && e.postData && e.postData.contents) {
      payload = e.postData.contents;
    } else if (e && e.parameter && e.parameter.data) {
      payload = e.parameter.data;
    }

    if (!payload) {
      return createOutput({ status: 'error', message: 'Không có dữ liệu' }, e);
    }

    var parsed = JSON.parse(payload);
    var action = parsed.action || '';

    // --- CẬP NHẬT NGÀY ---
    if (action === 'update_date') {
      return handleUpdateDate(parsed, e);
    }

    // --- THÊM TRẠM MỚI ---
    if (action === 'add_station') {
      return handleAddStation(parsed, e);
    }

    return createOutput({ status: 'error', message: 'Action không hợp lệ: ' + action }, e);

  } catch (error) {
    return createOutput({ status: 'error', message: error.toString() }, e);
  }
}

// ==============================================================================
// HANDLER: Cập nhật ngày cho một cột cụ thể
// Input: { action: 'update_date', row: 5, column: 11, value: '12/09/2026', role: 'dvkh' }
// ==============================================================================
function handleUpdateDate(parsed, e) {
  var row = parsed.row;
  var column = parsed.column;
  var value = parsed.value || '';
  var role = parsed.role || '';

  if (!row || !column) {
    return createOutput({ status: 'error', message: 'Thiếu row hoặc column' }, e);
  }

  // Kiểm tra quyền: role có được sửa cột này không
  var allowed = ROLE_COLUMN_MAP[role];
  if (!allowed || allowed.cols.indexOf(column) === -1) {
    // KTAT được phép cập nhật tất cả các cột
    if (role !== 'ktat') {
      return createOutput({ status: 'error', message: 'Bạn không có quyền cập nhật cột này' }, e);
    }
  }

  var ss = getSpreadsheet();
  if (!ss) return createOutput({ status: 'error', message: 'Không mở được Sheet' }, e);

  var sheet = ss.getSheetByName('DS PT TRẠM KH') || ss.getSheets()[0];
  sheet.getRange(row, column).setValue(value);

  return createOutput({
    status: 'success',
    message: 'Đã cập nhật thành công!',
    row: row,
    column: column,
    value: value
  }, e);
}

// ==============================================================================
// HANDLER: Thêm trạm mới (chỉ KTAT)
// Input: { action: 'add_station', name: '...', address: '...', kva: '...', 
//          contact: '...', xayLap: '...', deNghi: '...', role: 'ktat' }
// ==============================================================================
function handleAddStation(parsed, e) {
  if (parsed.role !== 'ktat') {
    return createOutput({ status: 'error', message: 'Chỉ phòng KTAT mới được thêm trạm' }, e);
  }

  var ss = getSpreadsheet();
  if (!ss) return createOutput({ status: 'error', message: 'Không mở được Sheet' }, e);

  var sheet = ss.getSheetByName('DS PT TRẠM KH') || ss.getSheets()[0];
  var lastRow = sheet.getLastRow();

  // Tính STT mới
  var newSTT = lastRow; // Approximate, since STT in sheet uses formulas
  
  // Tìm STT lớn nhất hiện tại
  if (lastRow >= 2) {
    var sttValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var maxSTT = 0;
    for (var i = 0; i < sttValues.length; i++) {
      var val = parseInt(sttValues[i][0]);
      if (!isNaN(val) && val > maxSTT) maxSTT = val;
    }
    newSTT = maxSTT + 1;
  }

  var newRow = [
    newSTT,
    parsed.name || '',
    parsed.address || '',
    parsed.contact || '',
    parsed.xayLap || '',
    parsed.kva || '',
    parsed.deNghi || '',
    '', // TNTK số CV
    '', // TNTK ngày
    '', // TTĐN
    '', // Hợp đồng
    '', // Đo đếm
    ''  // Đóng điện
  ];

  sheet.appendRow(newRow);

  return createOutput({
    status: 'success',
    message: 'Đã thêm trạm "' + parsed.name + '" thành công!',
    stt: newSTT,
    row: lastRow + 1
  }, e);
}
