Plan to get HiBob frozen cleanly:

1. Reproduce the current HiBob failure
   - Run a fresh HiBob dry-run with `--screenshot-before-dismiss` so the timeout state is captured.
   - Inspect the generated timeout screenshot and receipt to see whether the cookie banner is absent, delayed, hidden, or using a different variant.

2. Fix the consent handling only if needed
   - If the banner exists with a different accept button, update only HiBob’s `consentSelector` in `corpus/sites.ts`.
   - If the banner is present but remains in the DOM after click, switch HiBob’s `consentDismissCheck` from `detached` to `hidden`.
   - If no banner appears for this environment, change the freeze flow to allow HiBob to proceed without forcing a stale selector, while still recording the consent status in `freeze-report.json`.

3. Delete the failed HiBob artifacts and rerun cleanly
   - Remove the current `corpus/hibob/` contents.
   - Run a fresh non-dry HiBob freeze.

4. Verify the final corpus output
   - Confirm `golden.json`, `meta.json`, `page.mhtml`, `screenshot.jpg`, and `freeze-report.json` exist.
   - Confirm `freeze-report.json.ok === true` and the `/corpus` page shows HiBob as `freeze ok`.

5. Keep scope limited
   - Do not change HubSpot or other corpus sites.
   - Do not change the UI except if needed to display the final existing artifact state correctly.