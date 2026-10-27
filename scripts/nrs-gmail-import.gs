/**
 * Gmail -> NRS email-import webhook bridge.
 *
 * Configure these Script Properties:
 *   NRS_WEBHOOK_URL      https://your-domain.com/api/integrations/nrs/email
 *   NRS_WEBHOOK_SECRET   same value as NRS_EMAIL_IMPORT_SECRET
 *   NRS_GMAIL_QUERY      from:(nrs-sender@example.com) has:attachment
 *   NRS_IMPORTED_LABEL   NRS-Imported
 */

function importNrsReports() {
  const properties = PropertiesService.getScriptProperties();
  const webhookUrl = properties.getProperty("NRS_WEBHOOK_URL");
  const webhookSecret = properties.getProperty("NRS_WEBHOOK_SECRET");
  const gmailQuery =
    properties.getProperty("NRS_GMAIL_QUERY") ||
    "has:attachment Sales_History Inventory_Status";
  const importedLabelName =
    properties.getProperty("NRS_IMPORTED_LABEL") || "NRS-Imported";

  if (!webhookUrl || !webhookSecret) {
    throw new Error(
      "Set NRS_WEBHOOK_URL and NRS_WEBHOOK_SECRET in Script Properties.",
    );
  }

  const importedLabel =
    GmailApp.getUserLabelByName(importedLabelName) ||
    GmailApp.createLabel(importedLabelName);
  const threads = GmailApp.search(
    `${gmailQuery} -label:"${importedLabelName}"`,
    0,
    20,
  );

  threads.forEach((thread) => {
    const message = thread.getMessages().slice(-1)[0];
    const attachments = message
      .getAttachments()
      .filter((attachment) => !attachment.isInline());
    const salesFile = findAttachment(attachments, "sales_history");
    const inventoryFile = findAttachment(attachments, "inventory_status");

    if (!salesFile || !inventoryFile) {
      return;
    }

    const payload = {
      sales_history: salesFile.copyBlob().setName(salesFile.getName()),
      inventory_status: inventoryFile.copyBlob().setName(inventoryFile.getName()),
    };

    const response = UrlFetchApp.fetch(webhookUrl, {
      method: "post",
      headers: {
        "x-nrs-import-secret": webhookSecret,
        "x-nrs-source-message-id": message.getId(),
      },
      payload,
      muteHttpExceptions: true,
    });
    const statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      thread.addLabel(importedLabel);
    } else {
      throw new Error(
        `NRS webhook returned ${statusCode}: ${response
          .getContentText()
          .slice(0, 500)}`,
      );
    }
  });
}

function findAttachment(attachments, nameFragment) {
  const normalizedFragment = nameFragment.toLowerCase();

  return attachments.find((attachment) =>
    attachment.getName().toLowerCase().includes(normalizedFragment),
  );
}

function createNrsImportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "importNrsReports")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("importNrsReports")
    .timeBased()
    .everyMinutes(5)
    .create();
}
