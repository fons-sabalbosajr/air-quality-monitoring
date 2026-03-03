// Analyze full sheet structure to find heuristics for formula vs real data
require('dotenv').config();
const XLSX = require('./xlsxCompat');
const https = require('https');
const http = require('http');

const URLS = {
  'clark/pm10': process.env.SHEET_PM10_CLARK_URL,
  'zambales/pm10': process.env.SHEET_PM10_ZAMBALES_URL,
  'san-fernando/pm10': process.env.SHEET_PM10_SAN_FERNANDO_URL,
  'meycauayan/pm10': process.env.SHEET_PM10_MEYCAUAYAN_URL,
  'zambales/pm25': process.env.SHEET_PM25_ZAMBALES_URL,
};

function extractId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function downloadXlsx(url) {
  const id = extractId(url);
  const xlsxUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  return new Promise((resolve, reject) => {
    const doReq = (reqUrl, left) => {
      const uu = new URL(reqUrl);
      const lib = uu.protocol === 'http:' ? http : https;
      lib.get({ hostname: uu.hostname, path: uu.pathname + uu.search, headers: { 'User-Agent': 'test/1.0' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && left > 0) {
          doReq(new URL(res.headers.location, uu).toString(), left - 1);
          return;
        }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    };
    doReq(xlsxUrl, 5);
  });
}

async function testStation(name, url) {
  console.log(`\n=== ${name} ===`);
  const buf = await downloadXlsx(url);
  const wb = await XLSX.read(buf, { type: 'buffer' });

  const dataSheets = wb.SheetNames.filter(n => /^\d{4}$/.test(n.trim())).sort();
  if (!dataSheets.length) dataSheets.push(wb.SheetNames[0]);

  console.log(`  Sheets: ${wb.SheetNames.join(', ')}`);

  for (const sheetName of dataSheets) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    // Get full matrix with all columns
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
    if (!matrix || !matrix.length) continue;

    const headerRow = matrix[0] || [];
    console.log(`  Sheet "${sheetName}": ${matrix.length - 1} rows, Columns: ${headerRow.join(' | ')}`);

    // Find the last row that has EVERY column non-empty
    let lastFullRow = -1;
    let lastAnyDataRow = -1;
    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (!row) continue;
      const hasAny = row.some(c => c != null && String(c).trim() !== '');
      const hasAll = row.every(c => c != null && String(c).trim() !== '');
      if (hasAny) lastAnyDataRow = r;
      if (hasAll) lastFullRow = r;
    }

    console.log(`    Last row with ALL cols filled: ${lastFullRow} → ${lastFullRow > 0 ? JSON.stringify(matrix[lastFullRow]) : 'N/A'}`);
    console.log(`    Last row with ANY data:        ${lastAnyDataRow} → ${lastAnyDataRow > 0 ? JSON.stringify(matrix[lastAnyDataRow]) : 'N/A'}`);

    // Check what happens in the transition zone
    if (lastFullRow > 0 && lastFullRow < lastAnyDataRow) {
      console.log(`    -- Partial-fill zone: rows ${lastFullRow + 1} to ${lastAnyDataRow} --`);
      // Show a few rows around the boundary
      for (let r = Math.max(1, lastFullRow - 2); r <= Math.min(lastAnyDataRow, lastFullRow + 5); r++) {
        const row = matrix[r];
        const filled = row ? row.filter(c => c != null && String(c).trim() !== '').length : 0;
        console.log(`      Row ${r}: ${filled}/${headerRow.length} cols filled → ${JSON.stringify(row)}`);
      }
    }

    // Also show last 5 data rows
    const dataRows = [];
    for (let r = matrix.length - 1; r >= 1 && dataRows.length < 5; r--) {
      const row = matrix[r];
      if (row && row.some(c => c != null && String(c).trim() !== '')) {
        dataRows.unshift({ idx: r, data: row });
      }
    }
    console.log(`    Last 5 data rows:`);
    for (const { idx, data } of dataRows) {
      const filled = data.filter(c => c != null && String(c).trim() !== '').length;
      console.log(`      Row ${idx}: ${filled}/${headerRow.length} cols → ${JSON.stringify(data)}`);
    }
  }
}

(async () => {
  // Test just Clark first to see the structure
  for (const [name, url] of Object.entries(URLS)) {
    if (!url) { console.log(`${name}: No URL configured`); continue; }
    try {
      await testStation(name, url);
    } catch (e) {
      console.log(`${name}: ERROR - ${e.message}`);
    }
  }
  console.log('\nDone.');
})();
