// Vercel Serverless Function: POST /api/route { points: [[lat, lon], ...] }
import { handleRoute } from './_handler.js';

export default async function handler(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const result = await handleRoute({ method: req.method, headers: req.headers, body }, process.env.DGIS_KEY);
  res.status(result.status).json(result.body);
}
