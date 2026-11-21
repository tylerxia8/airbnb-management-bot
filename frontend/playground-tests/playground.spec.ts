import { expect, test } from "@playwright/test";

test("host simulates a cleaning day in an isolated session", async ({page, browser}) => {
  expect((await page.request.get("/dashboard")).status()).toBe(404);
  expect((await page.request.post("/api/payments")).status()).toBe(404);
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Lucena Systems Playground"})).toBeVisible();
  await expect(page.getByRole("link", {name: /Book a Call/})).toHaveAttribute("href", /^https:\/\/calendly\.com\//);
  await expect(page.getByRole("rowheader", {name: "Willow Cottage"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Publish simulation"})).toBeEnabled();
  await page.getByRole("button", {name: "Properties", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "Fictional property name"})).toHaveCount(12);
  await page.getByRole("textbox", {name: "Fictional property name"}).first().fill("Blue Test House");
  await page.getByRole("button", {name: "Save property"}).first().click();
  await expect(page.getByRole("status")).toHaveText("Property saved.");
  await page.getByRole("button", {name: "Schedule", exact: true}).click();
  await page.getByRole("button", {name: "Generate preview"}).click();
  await expect(page.getByRole("rowheader", {name: "Blue Test House"})).toBeVisible();
  const assignment = page.getByRole("combobox", {name: "Blue Test House"});
  await assignment.selectOption({label: "Morgan Vale"});
  await assignment.locator("../..").getByRole("button", {name: "Apply"}).click();
  await expect(page.getByRole("status")).toHaveText("Assignment preview updated.");
  await page.getByRole("button", {name: "Publish simulation"}).click();
  await expect(page.getByRole("status")).toHaveText("Simulated schedule published.");
  await page.reload();
  await expect(page.getByRole("rowheader", {name: "Blue Test House"})).toBeVisible();

  const separate = await browser.newContext();
  try {
    const visitor = await separate.newPage();
    await visitor.goto("/playground");
    await visitor.getByRole("button", {name: "Properties", exact: true}).click();
    await expect(visitor.getByRole("textbox", {name: "Fictional property name"}).first()).toHaveValue("Willow Cottage");
  } finally {
    await separate.close();
  }
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", {name: "Reset sandbox"}).click();
  await expect(page.getByRole("status")).toHaveText("Sandbox reset.");
  await expect(page.getByRole("rowheader", {name: "Willow Cottage"})).toBeVisible();
});
