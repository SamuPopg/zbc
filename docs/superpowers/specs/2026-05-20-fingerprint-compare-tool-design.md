# Fingerprint Compare Tool Design

Date: 2026-05-20

## Context

The user tests AdsPower browser kernel releases and currently repeats the same manual workflow for every kernel update: configure multiple browser profiles, start them, open the online BrowserScan site, and compare whether fingerprint simulation values appear as expected.

This tool is intended to reduce that manual regression work. It will not modify AdsPower source code. The AdsPower frontend, backend, client JS service, and BrowserScan source code are reference material only.

Relevant source paths:

- `C:\work\compare\mix_web`: AdsPower backend.
- `C:\work\compare\mix_fe_plus`: AdsPower frontend.
- `C:\work\compare\mix_client`: AdsPower frontend JS/local service.
- `C:\work\compare\mix_scan`: BrowserScan source.

## Goals

- Accept a list of AdsPower environment IDs, such as `i6xdjv` and `i6xdqf`.
- Read each environment's configured fingerprint values from AdsPower backend data.
- Start each environment through AdsPower Local API.
- Open the online BrowserScan site in the started environment.
- Collect BrowserScan observed fingerprint values.
- Generate a horizontal comparison report showing, for every environment and fingerprint item:
  - AdsPower setting value.
  - BrowserScan observed value.
- Avoid pass, fail, consistency, or anomaly judgment in the first version.
- Keep the workflow simple enough for a functional test engineer to run repeatedly.

## Non-Goals

- Do not create or modify AdsPower profiles in the first version.
- Do not modify AdsPower source code.
- Do not run or depend on local BrowserScan in the first version.
- Do not assert expected values or mark results as pass/fail.
- Do not support profiles with random fingerprint enabled in the first version.
- Do not automate generation of all fingerprint permutations yet.

## Main Approach

Use backend profile detail data as the primary "setting value" source, and use Local API only for browser lifecycle control.

The preferred flow is:

1. User provides environment IDs.
2. Tool calls AdsPower backend `fbcc/user/get-open-user-list` using the configured backend base URL and API key.
3. Tool extracts and flattens `fingerprint_config` plus relevant profile fields.
4. Tool starts each profile through Local API `POST /api/v2/browser-profile/start`.
5. Tool connects to the returned browser debug endpoint.
6. Tool opens the online BrowserScan URL.
7. Tool collects BrowserScan values from the page.
8. Tool writes a comparison report.

If backend detail fetching fails, the tool still starts profiles and collects BrowserScan values when possible. In that fallback mode, setting values are shown as unavailable or partial instead of blocking the full run.

## Configuration

The tool will use a local configuration file or environment variables. Secrets must not be committed.

Required configuration:

- `backendBaseUrl`: AdsPower backend API base URL, for example `https://api-ds-testing.xmp.one`.
- `localApiBaseUrl`: AdsPower Local API base URL, usually `http://local.adspower.com:50325`.
- `apiKey`: AdsPower API key, loaded from local configuration or environment.
- `browserScanUrl`: online BrowserScan URL used in daily testing.
- `profileIds`: list of environment IDs to test.

Optional configuration:

- `closeAfterRun`: whether to close each profile after collection. Default: true.
- `runMode`: sequential or limited concurrency. Default: sequential.
- `timeoutMs`: page and collection timeout.
- `outputDir`: report output directory.

## Setting Value Source

The primary endpoint is the same backend path used by AdsPower when opening browser profiles:

`GET {backendBaseUrl}/fbcc/user/get-open-user-list`

Expected query shape:

- `ids`: comma-separated profile IDs.
- `page`: `1`.
- `page_size`: up to `100`.
- `action`: `openfb`.
- `fields`: fingerprint and profile fields required for opening and reporting.
- `_local_api`: `adspower`, if needed by the backend route.

Authentication:

- Prefer API key authentication because Local API forwards API key to backend in the existing implementation.
- If direct API key access is rejected by the backend, the design allows a later fallback to login token authentication.

Important source references:

- `C:\work\compare\mix_client\src\localAPI\model\UserModel.ts`: Local API startup path calls `get-open-user-list`.
- `C:\work\compare\mix_client\src\config\apiUrl.ts`: defines `GET_OPEN_USER_LIST`.
- `C:\work\compare\mix_web\modules\fbcc\controllers\UserController.php`: `actionGetOpenUserList`.
- `C:\work\compare\mix_web\modules\fbcc\services\UserListService.php`: `formatFingerprintConfig`.
- `C:\work\compare\mix_fe_plus\src\api\fbcc\user.ts`: frontend `getOpenUserList` field list and flattening behavior.
- `C:\work\compare\mix_fe_plus\src\views\main\browserList\components\changeFingerprint.vue`: frontend edit view fields for fingerprint settings.

The first version will request all fingerprint fields that can be identified from these source paths, including but not limited to:

- UA and browser kernel config.
- Platform and system.
- Timezone and automatic timezone.
- Language and page language.
- Screen resolution and DPR.
- WebRTC.
- Canvas.
- WebGL and WebGL image/config.
- WebGPU config when present.
- Audio.
- Fonts.
- Client rects.
- Hardware concurrency.
- Device memory.
- Do Not Track.
- Media devices.
- Geolocation.
- TLS.
- Client hints.
- GPU.
- MAC address config when present.
- Proxy, IP, IP checker, country, region, and city fields where useful for report context.

## Browser Lifecycle

The tool starts each profile with:

`POST {localApiBaseUrl}/api/v2/browser-profile/start`

Request shape:

- `profile_id`: AdsPower environment ID.

The Local API response is expected to contain browser connection data such as debug port, WebDriver path, or WebSocket endpoint. The collector will use the most stable available connection method after a short startup wait.

After collection, the tool can close the profile with Local API stop if `closeAfterRun` is enabled.

## BrowserScan Collection

The first version targets the online BrowserScan site because that matches the user's daily testing workflow.

Collection strategy:

- Open the configured online BrowserScan URL in the started profile.
- Wait until the relevant sections finish loading.
- Extract stable text values and hashes from the page where possible.
- Prefer DOM/text extraction over screenshot OCR.
- Record raw collected values and collection status per fingerprint item.

The BrowserScan source code is used only to understand item names and likely data fields. The first version does not require running `mix_scan` locally.

## Report Design

The report is a horizontal comparison table.

Recommended first output formats:

- HTML report for easy visual comparison.
- JSON report for debugging and future automation.

Each report row represents one fingerprint item.

Each environment column contains:

- `setting`: AdsPower configured value.
- `browserScan`: BrowserScan observed value.
- `note`: collection note or error text when applicable.

The report must not contain pass/fail wording in the first version.

Example row structure:

| Fingerprint Item | env i6xdjv | env i6xdjw |
| --- | --- | --- |
| WebRTC | setting: proxy<br>BS: 1.2.3.4 | setting: disabled<br>BS: disabled |
| Language | setting: based on IP<br>BS: en-US | setting: real<br>BS: zh-CN |

## Error Handling

The tool should continue collecting other profiles when one profile fails.

Expected failure handling:

- Backend detail fetch fails: mark settings unavailable and continue with Local API startup.
- Local API startup fails: mark the profile startup error and skip BrowserScan collection for that profile.
- Browser connection fails: mark connection error and continue to the next profile.
- BrowserScan page load timeout: record timeout and keep any partial values already collected.
- Individual fingerprint item missing: mark that item as not collected instead of failing the entire run.

## Random Fingerprint Constraint

The user will keep random fingerprint disabled.

Reason:

- `get-open-user-list` can trigger random fingerprint handling for profiles with random fingerprint enabled.
- A separate setting fetch and a later profile start could produce different random results.

First version behavior:

- If `switch_random_finger` is detected as enabled, mark the profile as unsupported for exact setting comparison.
- Do not attempt special random-fingerprint reconciliation in the first version.

## Security

- API key must be read from local config or environment variables.
- API key must not be written into the design document, committed files, reports, or logs.
- Reports should avoid exposing sensitive profile credentials, cookies, or passwords.
- The backend response may include fields not needed for fingerprint comparison; the report writer must filter sensitive fields.

## Validation Plan

Before implementation is considered complete:

1. Verify direct backend call with a provided `backendBaseUrl`, API key, and one known profile ID.
2. Verify Local API startup with the same profile ID.
3. Verify the tool can connect to the started browser.
4. Verify the tool can open the online BrowserScan URL.
5. Verify at least a small profile set produces an HTML report and JSON report.
6. Verify no API key or credential fields are written to output files.
7. Verify a failed profile does not stop the entire run.

## Open Design Decisions Resolved

- The first version uses online BrowserScan, not local `mix_scan`.
- The first version starts from existing profile IDs supplied by the user.
- The first version does not create profiles or enumerate all fingerprint permutations.
- The first version does not do pass/fail assertions.
- The first version uses backend detail data as setting values, with Local API-only behavior as fallback.
- Random fingerprint is out of scope because the user will keep it disabled.

## Implementation Boundary

Implementation should live in this separate tool repository. AdsPower source repositories are reference-only and must not be edited.

