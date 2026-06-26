// Cloud Billing kill-switch (denial-of-wallet backstop).
//
// A Cloud Billing budget publishes spend updates to a Pub/Sub topic; this
// function detaches the billing account from the project once actual spend
// exceeds the budget, which immediately stops all billable usage (Vertex AI,
// Cloud Run). Re-attach billing in the console to bring the project back.
//
// Triggered by the budget's Pub/Sub topic. Deploy from this folder — see
// ../../docs/SECURITY.md (P2) for the full setup.

const functions = require('@google-cloud/functions-framework');
const { CloudBillingClient } = require('@google-cloud/billing');

const billing = new CloudBillingClient();
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

functions.cloudEvent('killSwitch', async (cloudEvent) => {
  // The budget notification is a base64-encoded JSON Pub/Sub message.
  const raw = cloudEvent?.data?.message?.data;
  const msg = raw ? JSON.parse(Buffer.from(raw, 'base64').toString()) : {};
  const cost = msg.costAmount ?? 0;
  const budget = msg.budgetAmount ?? Infinity;

  if (cost <= budget) {
    console.log(`Under budget (${cost} <= ${budget}) — no action.`);
    return;
  }

  const name = `projects/${PROJECT_ID}`;
  const [info] = await billing.getProjectBillingInfo({ name });
  if (!info.billingEnabled) {
    console.log('Billing already disabled — no action.');
    return;
  }

  // Detaching the billing account stops all billable spend immediately.
  await billing.updateProjectBillingInfo({
    name,
    projectBillingInfo: { billingAccountName: '' },
  });
  console.warn(`BILLING DISABLED for ${name} (cost ${cost} > budget ${budget}).`);
});
