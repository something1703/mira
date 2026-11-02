/**
 * Where the browser loads YouCam's JS Camera Kit from (docs/YOUCAM_API.md §5). It lives here, with
 * every other YouCam address, so the lint rule that keeps YouCam hosts in this package holds. It is
 * a separate entry point (`@mira/youcam-client/camera-kit`) because the browser must be able to
 * import it without pulling in the server-side client.
 */
export const CAMERA_KIT_SDK_URL = "https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js";
