# Audio Replay Design

## Goal
Prevent overlapping pronunciation playback in the content-script Edge TTS path while preserving an intentional replay interaction: clicking again should stop the current pronunciation and start the newest request from the beginning.

## Current behavior
`content.js` creates a fresh `Audio` object each time an Edge TTS response arrives. It never retains or stops the previous MP3 instance, and concurrent requests are not ordered. Repeated clicks can therefore overlap, and an older request that resolves late can still begin playback after a newer click.

## Chosen approach
Keep playback ownership inside the existing content-script TTS flow:
- Track the current `Audio` instance globally.
- Assign each `speakText()` call a monotonically increasing playback token.
- On every new `speakText()` call, cancel browser speech and stop/clean up the current MP3 instance immediately.
- When an Edge TTS response arrives, only play it if its token still matches the latest request.
- Clear playback state and revoke object URLs when playback ends, errors, is superseded, or fails to start.

## Why this shape
This is the narrowest change that matches the desired interaction. A queue would serialize the wrong behavior, and disabling the button would remove useful replay control. Token ownership also closes the async race where stale responses could otherwise resurrect old audio.

## Verification
Add regression tests around the content-script playback path to prove:
1. a second request stops the current `Audio` instance instead of allowing overlap;
2. an older async TTS response is ignored after a newer request has already been issued.
