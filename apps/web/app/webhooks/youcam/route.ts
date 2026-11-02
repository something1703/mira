import { proxy, webhookTarget } from "../../../src/proxy";

/** YouCam's callback. The signature headers and the raw body go to mira-webhook untouched. */
export async function POST(req: Request) {
  return await proxy(req, {
    target: webhookTarget(),
    path: "/webhooks/youcam",
    forward: ["content-type", "webhook-id", "webhook-timestamp", "webhook-signature"],
  });
}
