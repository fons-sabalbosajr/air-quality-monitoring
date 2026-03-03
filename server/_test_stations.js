const http = require('http');
const stations = [
  ['clark', 'pm10'],
  ['meycauayan', 'pm10'],
  ['zambales', 'pm10'],
  ['zambales', 'pm25'],
  ['san-fernando', 'pm10'],
];

let done = 0;
for (const [s, p] of stations) {
  const url = `http://localhost:3001/api/tabular/${s}/${p}`;
  http.get(url, { timeout: 120000 }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      try {
        const j = JSON.parse(body);
        const rows = j.rows || [];
        const dateCol = j.columns.find((c) => /date|time/i.test(c));
        const latest = rows.length > 0 ? rows[0][dateCol] : 'N/A';
        console.log(`${s}/${p}: Total=${rows.length}, Latest=${latest}`);
      } catch (e) {
        console.log(`${s}/${p}: PARSE ERROR - ${e.message}`);
      }
      if (++done === stations.length) process.exit(0);
    });
  }).on('error', (e) => {
    console.log(`${s}/${p}: NET ERROR - ${e.message}`);
    if (++done === stations.length) process.exit(0);
  });
}
