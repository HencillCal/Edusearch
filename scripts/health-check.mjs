const port = process.env.PORT || 3000;
const url = process.env.APP_URL || `http://localhost:${port}`;
const response = await fetch(`${url}/api/health`);
if (!response.ok) {
  console.error(`Health check failed: ${response.status}`);
  process.exit(1);
}
console.log(await response.text());
