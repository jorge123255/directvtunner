// BrowserBase script for DirecTV login
// Paste this into the BrowserBase console

console.info("Starting DirecTV login...");

// Wait a bit for page to fully load
await page.waitForTimeout(2000);

// Navigate to DirecTV
console.info("Navigating to DirecTV...");
await page.goto("https://stream.directv.com/watchnow", {
  waitUntil: "networkidle",
  timeout: 60000
});

console.info("Page loaded, current URL:", page.url());
await page.waitForTimeout(3000);

// Check if we need to login
const currentUrl = page.url();
console.info("Current URL after load:", currentUrl);

// Look for email input field - try multiple selectors
console.info("Looking for email field...");
let emailField = null;

// Try different selectors
const emailSelectors = [
  'input[type="email"]',
  'input[name="email"]',
  'input[placeholder*="email" i]',
  '#email',
  'input[data-testid="email-input"]'
];

for (const selector of emailSelectors) {
  try {
    emailField = await page.$(selector);
    if (emailField) {
      console.info("Found email field with selector:", selector);
      break;
    }
  } catch (e) {
    // Continue to next selector
  }
}

if (!emailField) {
  // Try using getByRole
  try {
    emailField = page.getByRole('textbox', { name: /email/i });
    const isVisible = await emailField.isVisible().catch(() => false);
    if (isVisible) {
      console.info("Found email field using getByRole");
    } else {
      emailField = null;
    }
  } catch (e) {
    console.info("getByRole failed:", e.message);
  }
}

if (!emailField) {
  // Take screenshot to see current state
  console.info("Email field not found. Taking screenshot...");
  await page.screenshot({ path: "debug-state.png" });

  // Log page content
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.info("Page content preview:", bodyText);

  throw new Error("Could not find email field");
}

// Fill email
console.info("Filling email...");
await emailField.fill("jose222855@msn.com");
await page.waitForTimeout(1000);

// Click Next/Continue button
console.info("Looking for Next button...");
const nextButton = page.getByRole('button', { name: /next|continue|submit/i });
if (await nextButton.isVisible().catch(() => false)) {
  console.info("Clicking Next button...");
  await nextButton.click();
  await page.waitForTimeout(3000);
}

// Look for password field
console.info("Looking for password field...");
let passwordField = null;

const passwordSelectors = [
  'input[type="password"]',
  'input[name="password"]',
  '#password'
];

for (const selector of passwordSelectors) {
  try {
    passwordField = await page.$(selector);
    if (passwordField) {
      console.info("Found password field with selector:", selector);
      break;
    }
  } catch (e) {
    // Continue
  }
}

if (!passwordField) {
  try {
    passwordField = page.getByRole('textbox', { name: /password/i });
    if (await passwordField.isVisible().catch(() => false)) {
      console.info("Found password field using getByRole");
    } else {
      passwordField = null;
    }
  } catch (e) {
    console.info("Password getByRole failed:", e.message);
  }
}

if (!passwordField) {
  console.info("Password field not found. Taking screenshot...");
  await page.screenshot({ path: "debug-password.png" });
  throw new Error("Could not find password field");
}

// Fill password
console.info("Filling password...");
await passwordField.fill("Teramars1!");
await page.waitForTimeout(1000);

// Click Sign In button
console.info("Looking for Sign In button...");
const signInButton = page.getByRole('button', { name: /sign in|login|submit/i });
if (await signInButton.isVisible().catch(() => false)) {
  console.info("Clicking Sign In button...");
  await signInButton.click();
  await page.waitForTimeout(5000);
}

console.info("Login attempt complete. Current URL:", page.url());

// Check for video player
const hasVideo = await page.evaluate(() => {
  return document.querySelector('video') !== null;
});

if (hasVideo) {
  console.info("SUCCESS: Video element found on page!");
} else {
  console.info("No video element found yet. May need to select a channel.");
}

console.info("Script complete.");
