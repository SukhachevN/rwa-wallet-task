const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env');

if (!fs.existsSync(envPath) || fs.statSync(envPath).size === 0) {
  console.error(`
Missing .env file.

Frontend and backend will not start until you create one:

  cp example.env .env

Windows PowerShell:

  Copy-Item example.env .env
`);
  process.exit(1);
}
