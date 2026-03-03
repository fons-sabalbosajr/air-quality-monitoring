// Direct formula detection test — bypasses server cache and API
// Downloads the actual XLSX from Google Sheets and checks formula cells
require("dotenv").config();
const XLSX = require("./xlsxCompat");
const https = require("https");
const http = require("http");

const URLS = {
  "clark/pm10": process.env.SHEET_PM10_CLARK_URL,
  "zambales/pm10": process.env.SHEET_PM10_ZAMBALES_URL,
  "san-fernando/pm10": process.env.SHEET_PM10_SAN_FERNANDO_URL,
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
      const lib = uu.protocol === "http:" ? http : https;
      lib
        .get(
          {
            hostname: uu.hostname,
            path: uu.pathname + uu.search,
            headers: { "User-Agent": "test/1.0" },
          },
          (res) => {
            if (
              [301, 302, 303, 307, 308].includes(res.statusCode) &&
              res.headers.location &&
              left > 0
            ) {
              doReq(new URL(res.headers.location, uu).toString(), left - 1);
              return;
            }
            const chunks = [];
            res.on("data", (d) => chunks.push(d));
            res.on("end", () => resolve(Buffer.concat(chunks)));
          },
        )
        .on("error", reject);
    };
    doReq(xlsxUrl, 5);
  });
}

async function testStation(name, url) {
  console.log(`\n=== ${name} ===`);
  const buf = await downloadXlsx(url);
  const wb = await XLSX.read(buf, { type: "buffer" });

  const dataSheets = wb.SheetNames.filter((n) =>
    /^\d{4}$/.test(n.trim()),
  ).sort();
  if (!dataSheets.length) dataSheets.push(wb.SheetNames[0]);

  const RAW_COL_PATTERNS = [/date|time/i, /concentration/i];
  let columns = null;
  let allRows = [];

  for (const sheetName of dataSheets) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: null,
    });
    if (!matrix || !matrix.length) continue;

    const fMatrix = matrix.__formulaMatrix || [];
    const headerRow = (matrix[0] || []).map((h, idx) => {
      const v = (h == null ? "" : String(h)).trim();
      return v || `Column ${idx + 1}`;
    });

    if (!columns) {
      columns = headerRow.filter((h) =>
        RAW_COL_PATTERNS.some((p) => p.test(h)),
      );
      if (!columns.length) columns = headerRow;
    }

    const colIndices = columns.map((c) => headerRow.indexOf(c));

    const rows = matrix
      .slice(1)
      .map((r, arrIdx) => ({ r, matIdx: arrIdx + 1 }))
      .filter(
        ({ r }) =>
          Array.isArray(r) &&
          r.some((c) => c != null && String(c).trim() !== ""),
      )
      .map(({ r, matIdx }) => {
        const obj = {};
        const formulaCols = [];
        const fRow = fMatrix[matIdx] || [];
        for (let ci = 0; ci < columns.length; ci++) {
          const idx = colIndices[ci];
          obj[columns[ci]] = idx >= 0 ? (r[idx] ?? null) : null;
          if (idx >= 0 && fRow[idx]) formulaCols.push(columns[ci]);
        }
        Object.defineProperty(obj, "__formulaCols", {
          value: formulaCols,
          enumerable: false,
          writable: true,
        });
        return obj;
      });

    console.log(
      `  Sheet "${sheetName}": ${rows.length} data rows, fMatrix rows: ${fMatrix.length}`,
    );

    // Sample formula flags
    const withFormula = rows.filter(
      (r) => r.__formulaCols && r.__formulaCols.length > 0,
    );
    console.log(`    Rows with any formula cols: ${withFormula.length}`);
    if (withFormula.length > 0) {
      const dateCol = columns.find((c) => /date|time/i.test(c));
      const concCol = columns.find((c) => /conc/i.test(c));
      const bothFormula = withFormula.filter((r) => {
        return (
          r.__formulaCols.includes(dateCol) && r.__formulaCols.includes(concCol)
        );
      });
      console.log(
        `    Rows where BOTH date+conc are formula: ${bothFormula.length}`,
      );
      if (bothFormula.length > 0) {
        console.log(`    First formula row: ${JSON.stringify(bothFormula[0])}`);
        console.log(
          `    Last formula row: ${JSON.stringify(bothFormula[bothFormula.length - 1])}`,
        );
      }
      // Show non-formula rows count
      const realRows = rows.filter(
        (r) =>
          !r.__formulaCols ||
          r.__formulaCols.length === 0 ||
          !(
            r.__formulaCols.includes(dateCol) &&
            r.__formulaCols.includes(concCol)
          ),
      );
      console.log(`    Real (non-formula) rows: ${realRows.length}`);
      if (realRows.length > 0) {
        console.log(
          `    Last real row: ${JSON.stringify(realRows[realRows.length - 1])}`,
        );
      }
    }

    allRows = allRows.concat(rows);
  }

  console.log(`  Total rows across all sheets: ${allRows.length}`);
}

(async () => {
  for (const [name, url] of Object.entries(URLS)) {
    if (!url) {
      console.log(`${name}: No URL configured`);
      continue;
    }
    try {
      await testStation(name, url);
    } catch (e) {
      console.log(`${name}: ERROR - ${e.message}`);
    }
  }
  console.log("\nDone.");
})();
