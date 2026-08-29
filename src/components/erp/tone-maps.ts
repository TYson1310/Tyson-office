type Tone = "green" | "amber" | "red" | "blue" | "slate" | "violet";

export const inventoryStatusTone: Record<string, Tone> = {
  Healthy: "green",
  Reorder: "amber",
  Critical: "red",
  Backorder: "violet",
};

export const paymentStatusTone: Record<string, Tone> = {
  Paid: "green",
  Pending: "amber",
  Overdue: "red",
};

export const fulfillmentStatusTone: Record<string, Tone> = {
  Ready: "blue",
  Picking: "amber",
  Packed: "violet",
  Delivered: "green",
};

export const purchaseOrderTone: Record<string, Tone> = {
  Open: "blue",
  Approved: "green",
  Delayed: "red",
  Received: "slate",
};

export const shiftTone: Record<string, Tone> = {
  "On Shift": "green",
  Break: "amber",
  Training: "blue",
  "Off Today": "slate",
};

export const calendarTaskTone: Record<string, Tone> = {
  Delivery: "green",
  Audit: "amber",
  Promotion: "violet",
  Payroll: "blue",
  Maintenance: "red",
};

export const payrollStatusTone: Record<string, Tone> = {
  Paid: "green",
  Scheduled: "blue",
  Draft: "amber",
  Archived: "slate",
};
