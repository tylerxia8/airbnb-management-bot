import { expect, test } from "@playwright/test";

test("daily board shows deadlines, cleaner responsibility and explicit cleaning completion", async ({page}) => {
  const url = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`;
  await page.context().addCookies([{name: "cleaning-dev-role", value: "manager", url}]);
  const base = {release_at: "2026-11-10T15:00:00Z", deadline_at: "2026-11-12T15:00:00Z", planned_start: null, planned_end: null, acknowledged: false, pending: false, cleaner_name: null};
  const open = {...base, id: "open", property_name: "Fictional Charlotte house A", status: "ready", needs_assignment: true};
  const done = {...base, id: "done", property_name: "Fictional Charlotte house B", status: "completed", cleaner_name: "Alex Demo", completed_at: "2026-11-11T16:00:00Z", planned_start: "2026-11-11T14:00:00Z", planned_end: "2026-11-11T16:00:00Z", acknowledged: true, travel_before_seconds: 180, travel_from: "Fictional public staging", travel_source: "osrm_cached"};
  await page.route("**/api/dashboard*", route => route.fulfill({json: {
    service_date: "2026-11-11", business_date: "2026-11-11", mode: "mock", tomorrow_date: "2026-11-12", today: [open, done], tomorrow: [open],
    overdue: [{...open, id: "late", property_name: "Fictional overdue house", overdue: true}], unassigned_count: 1,
    availability: {}, assignment_counts: {}, ack_counts: {acknowledged: 1, awaiting: 0}, completion_counts: {completed: 1, open: 1},
    exceptions: [], sync_health: {stale: false, publication_blocked: false}, sms_delivery_counts: {}, pending_deadline_count: 0, uncovered_count: 0, late_count: 1, dispatch_enabled: false,
  }}));
  await page.goto("/dashboard");
  await page.waitForSelector("table", {timeout: 10000});
  const todaySection = page.locator("section.today-cleaning-board");
  await expect(todaySection).toBeVisible({timeout: 10000});
  await expect(todaySection.locator("th:has-text('Clean by')")).toBeVisible();
  await expect(todaySection.getByRole("row", {name: /Fictional Charlotte house A/})).toContainText("Nov 12");
  await expect(todaySection.getByRole("row", {name: /Fictional Charlotte house A/})).toContainText("Unassigned");
  await expect(todaySection.getByRole("row", {name: /Fictional overdue house/})).toContainText("Overdue");
  await page.getByRole("group", {name: "Show cleaning work"}).getByRole("button", {name: "Cleaned"}).click();
  await expect(todaySection.getByRole("rowheader", {name: /Fictional Charlotte house B/})).toBeVisible();
  await expect(todaySection.getByRole("row", {name: /Fictional Charlotte house B/})).toContainText("Alex Demo");
  await expect(todaySection.getByRole("row", {name: /Fictional Charlotte house B/})).toContainText("Cleaned");
  await expect(todaySection.getByRole("rowheader", {name: "Fictional Charlotte house A"})).toHaveCount(0);
  await page.getByRole("group", {name: "Show cleaning work"}).getByRole("button", {name: "Unassigned"}).click();
  await expect(todaySection.getByRole("rowheader", {name: /Fictional Charlotte house A/})).toBeVisible();
  await expect(todaySection.getByRole("rowheader", {name: "Fictional Charlotte house B"})).toHaveCount(0);
});

test("manager reports a cleaner cancellation and sees the open coverage offer", async ({page}) => {
  const job = {id: "cleaning", property_name: "Fictional Charlotte house", release_at: "2026-11-11T15:00:00Z", deadline_at: "2026-11-11T20:00:00Z"};
  let released = false;
  await page.route("**/api/dashboard*", route => route.fulfill({json: {
    service_date: "2026-11-11", business_date: "2026-11-11", mode: "mock",
    today: [released ? {...job, status: "ready", cleaner_name: null,
      cleaner_recovery: {status: "awaiting", respond_by: "2026-11-11T16:00:00Z"}} :
      {...job, status: "assigned", cleaner_name: "Alex Demo", can_release_assignment: true, assignment_id: "assignment", assignment_version: 4}],
    exceptions: [], availability: {}, assignment_counts: {}, ack_counts: {acknowledged: 0, awaiting: 0}, sync_health: {},
  }}));
  await page.route("**/api/assignments/assignment/release", async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["if-match"]).toBe('"4"');
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    released = true;
    await route.fulfill({json: {status: "punted"}});
  });
  await page.goto("/dashboard");
  await page.getByRole("button", {name: "Cleaner canceled"}).click();
  await page.getByRole("button", {name: "Release job"}).click();
  await expect(page.getByText("Awaiting cover", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Cleaner canceled"})).toHaveCount(0);
});
