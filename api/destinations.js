/**
 * GET /api/destinations — the LinkedIn Pages this deployment may publish to.
 *
 * Returns ids, names, organization URNs and logos only. Never the webhook
 * URL, never a token. See api/_destinations.js for the configuration.
 */
import { readRegistry, multiWebhook } from "./_destinations.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const { destinations, problems } = readRegistry();
  const webhook = !!multiWebhook();
  return res.status(200).json({
    service: "unison-destinations",
    version: 1,
    /* On only when there is somewhere to send multi-destination jobs. */
    enabled: webhook && destinations.some((d) => d.enabled),
    webhookConfigured: webhook,
    destinations,
    problems,
  });
}
