/**
 * Van50 — Zero-Email Community Feedback & Price Update Receiver (Google Apps Script)
 *
 * SETUP (2 minutes):
 * 1. Open https://sheets.new and name the spreadsheet "Van50 Submissions".
 * 2. Click Extensions -> Apps Script.
 * 3. Delete any starter code, paste this entire file, and click Save (Ctrl+S).
 * 4. Click Deploy -> New deployment -> Select type: "Web app".
 *    - Description: Van50 Submissions API
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Click Deploy, authorize when prompted, and copy the Web App URL
 *    (looks like: https://script.google.com/macros/s/AKfycb.../exec).
 * 6. Paste that URL into <meta name="van50-submissions-url" content="..."> in index.html
 *    and deploy Van50 to production.
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var feedbackRows = readSheetRows(ss, 'Feedback');
    var priceRows = readSheetRows(ss, 'Price Updates');
    return jsonResponse({
      success: true,
      feedback: feedbackRows,
      priceUpdates: priceRows,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function readSheetRows(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (!values || values.length <= 1) return [];
  var headers = values[0].map(function (h) { return String(h || '').trim(); });
  var rows = [];
  for (var i = values.length - 1; i >= 1; i--) {
    var rowObj = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = values[i][c];
    }
    rows.push(rowObj);
  }
  return rows;
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    // Silent anti-bot honeypot check
    if ((data.honeypot && String(data.honeypot).trim() !== '') ||
        (data.hp_field && String(data.hp_field).trim() !== '')) {
      return jsonResponse({ success: true, ignored: true });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timestamp = new Date().toISOString();
    var submissionType = String(data.type || 'feedback').toLowerCase();

    if (submissionType === 'price_update') {
      var priceSheet = getOrCreateSheet(ss, 'Price Updates', [
        'Timestamp (UTC)',
        'Status',
        'Venue Name',
        'Cheapest Pint ($ CAD)',
        'Cheapest Cocktail ($ CAD)',
        'Senior / 65+ Price ($ CAD)',
        'Tax Included (All-In)',
        'Note / Source',
        'Page URL',
        'Ticket / Cover ($ CAD)',
        'Quick Flags',
        'Event Title',
        'City',
        'Listed Price'
      ]);

      var flagsStr = Array.isArray(data.quickFlags)
        ? data.quickFlags.join(', ')
        : sanitizeCell(data.quickFlags, 200);

      priceSheet.appendRow([
        timestamp,
        'New',
        sanitizeCell(data.venue_name || data.venue, 160),
        formatNum(data.cheapest_pint_input),
        formatNum(data.cheapest_cocktail_input),
        formatNum(data.seniorPrice),
        data.is_all_in ? 'Yes' : 'No',
        sanitizeCell(data.note, 250),
        sanitizeCell(data.page_url || data.pageUrl, 300),
        formatNum(data.ticketPrice),
        sanitizeCell(flagsStr, 200),
        sanitizeCell(data.eventTitle, 180),
        sanitizeCell(data.city, 80),
        sanitizeCell(data.listedPrice, 40)
      ]);

      return jsonResponse({
        success: true,
        message: 'Thank you! Your price / status update has been saved for review.'
      });
    }

    // Default: Community Feedback / Show Suggestion / Fix Details / General Note
    var feedbackSheet = getOrCreateSheet(ss, 'Feedback', [
      'Timestamp (UTC)',
      'Status',
      'Target Event ID',
      'Message / Suggestion',
      'Page URL'
    ]);

    var categoryPrefix = sanitizeCell(data.category, 60);
    var rawMsg = sanitizeCell(data.message, 2000);
    var msg = categoryPrefix && rawMsg && rawMsg.indexOf('[') !== 0
      ? ('[' + categoryPrefix + '] ' + rawMsg)
      : rawMsg;
    if (!msg) {
      return jsonResponse({ success: false, error: 'Empty message' });
    }

    feedbackSheet.appendRow([
      timestamp,
      'New',
      sanitizeCell(data.target_event_id || data.eventId, 120),
      msg,
      sanitizeCell(data.page_url || data.pageUrl, 300)
    ]);

    return jsonResponse({
      success: true,
      message: 'Thank you! Your feedback has been saved for review.'
    });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function sanitizeCell(val, maxLen) {
  if (val === null || val === undefined) return '';
  var s = String(val).trim().slice(0, maxLen || 500);
  // Prevent Google Sheets formula injection (=, +, -, @)
  if (/^[=+\-@]/.test(s)) {
    s = "'" + s;
  }
  return s;
}

function formatNum(val) {
  if (val === null || val === undefined || val === '') return '';
  var n = Number(val);
  return isNaN(n) ? '' : n;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
