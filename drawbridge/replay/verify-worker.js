import { verifyAuditJsonl } from "./verify.js";

self.onmessage = async (event) => {
  try {
    const result = await verifyAuditJsonl(typeof event.data === "string" ? event.data : "", (progress) => {
      self.postMessage({ progress });
    });
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
