# Backend message visibility fix

Updated the admin success/error/info message styling so operation results stay visible without scrolling.

## Changed

- `app/globals.css`

## Fix

The `.alert` component is now a fixed floating notification near the top of the page.
This means messages such as hint test user loaded, hint count updated, reset success, and API errors remain visible even when the admin is working lower down on `/game-settings`.

## Why

Previously the alert was rendered near the top of the page content, so actions performed lower on the page required scrolling back up to read the message.
