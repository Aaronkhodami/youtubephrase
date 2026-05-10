// Debug endpoint to test Invidious mirrors
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const mirrors = [
    "https://inv.nadeko.net",
    "https://invidious.jing.rocks",
    "https://iv.ggtyler.dev",
  ];

  const results = [];

  for (const mirror of mirrors) {
    try {
      console.log(`Testing mirror: ${mirror}`);
      const url = `${mirror}/api/v1/search?q=hello&type=video`;
      const response = await fetch(url, { timeout: 5000 });
      
      const data = await response.json();
      const count = Array.isArray(data) ? data.length : (data.results ? data.results.length : 0);
      
      results.push({
        mirror,
        status: response.status,
        ok: response.ok,
        itemCount: count,
      });
    } catch (error) {
      results.push({
        mirror,
        error: error.message,
      });
    }
  }

  return res.status(200).json(results);
}
