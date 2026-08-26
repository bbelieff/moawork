export type CloudFolderProvider =
  | "google_drive"
  | "onedrive"
  | "dropbox";

export type CloudFolderLink = {
  id: string;
  url: string;
  provider: CloudFolderProvider;
  providerLabel: string;
};

export type CloudFolderUrlResult =
  | { ok: true; url: string; provider: CloudFolderProvider; providerLabel: string; folderRef: string }
  | { ok: false; message: string };

const DIRECT_FILE_PATH = /\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|png|jpe?g|gif|webp|mp3|mp4|mov)$/iu;

function decodedUrlPart(value: string) {
  let decoded = value;
  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    // A 2048-character URL cannot contain more than seven complete layers of
    // percent encoding. Treat anything still encoded after this loop as an
    // invalid identifier instead of letting a later parser reveal it.
    if (/%[0-9a-f]{2}/iu.test(decoded)) return null;
  } catch {
    return null;
  }
  return /[\u0000-\u001f\u007f]/u.test(decoded) ? null : decoded;
}

function isDirectFileValue(value: string) {
  const decoded = decodedUrlPart(value);
  if (decoded === null) return true;
  return DIRECT_FILE_PATH.test(decoded.split(/[?#]/u, 1)[0].trim());
}

function validFolderIdentifier(value: string | undefined) {
  if (value === undefined) return false;
  const decoded = decodedUrlPart(value)?.trim();
  return Boolean(decoded && decoded !== "." && decoded !== ".." && !isDirectFileValue(decoded));
}

function pathSegments(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const decoded = segments.map(decodedUrlPart);
  return decoded.some((segment) => segment === null)
    ? []
    : (decoded as string[]);
}

function nonFileQueryValue(url: URL, key: string) {
  const value = url.searchParams.get(key);
  return value !== null && validFolderIdentifier(value);
}

function isGoogleDriveFolder(url: URL) {
  if (url.hostname !== "drive.google.com") return false;
  const segments = pathSegments(url);
  const folderIndex = segments[0] === "drive" && segments[1] === "folders"
    ? 1
    : segments[0] === "drive" && segments[1] === "u" && /^\d+$/u.test(segments[2] ?? "") && segments[3] === "folders"
      ? 3
      : -1;
  return (
    folderIndex >= 0 &&
    validFolderIdentifier(segments[folderIndex + 1]) &&
    validFolderIdentifier(segments.at(-1))
  );
}

const SAFE_REF_TOKEN = /^[A-Za-z0-9._!~-]+$/u;
const GOOGLE_FOLDER_REF = /^[A-Za-z0-9_-]{3,256}$/u;
const ONEDRIVE_SHORT_REF = /^[A-Za-z0-9!_-]{3,512}$/u;
const ONEDRIVE_LIVE_ID = /^[A-Za-z0-9!_-]{1,512}$/u;
const ONEDRIVE_LIVE_CID = /^[A-Za-z0-9_-]{1,256}$/u;

function safeRefSegments(segments: string[]) {
  return segments.length > 0 && segments.every((segment) =>
    SAFE_REF_TOKEN.test(segment) && segment !== "." && segment !== ".." && !isDirectFileValue(segment));
}

function hasFolderMarkerWithTail(segments: string[]) {
  const markerIndex = segments.findIndex((segment) => segment.toLowerCase().includes(":f:"));
  return markerIndex >= 0 && markerIndex < segments.length - 1 && validFolderIdentifier(segments.at(-1));
}

function isOneDriveFolder(url: URL) {
  const segments = pathSegments(url);
  const finalSegment = segments.at(-1);
  if (url.hostname === "1drv.ms") {
    return (
      (segments[0]?.toLowerCase().includes(":f:") || segments[0]?.toLowerCase() === "f") &&
      validFolderIdentifier(finalSegment)
    );
  }
  if (url.hostname === "onedrive.live.com" || url.hostname.endsWith(".onedrive.live.com")) {
    return (
      hasFolderMarkerWithTail(segments) ||
      nonFileQueryValue(url, "id")
    );
  }
  if (url.hostname.endsWith(".sharepoint.com")) {
    return (
      hasFolderMarkerWithTail(segments) ||
      (
        url.pathname.toLowerCase().endsWith("/forms/allitems.aspx") &&
        nonFileQueryValue(url, "id")
      )
    );
  }
  return false;
}

function isDropboxFolder(url: URL) {
  if (url.hostname !== "dropbox.com" && url.hostname !== "www.dropbox.com") return false;
  const segments = pathSegments(url);
  const identifierIndex = segments[0] === "scl" && segments[1] === "fo"
    ? 2
    : segments[0] === "sh" || segments[0] === "home"
      ? 1
      : -1;
  return identifierIndex >= 0 && validFolderIdentifier(segments.at(-1));
}

export function inspectCloudFolderUrl(raw: string): CloudFolderUrlResult {
  const value = raw.trim();
  if (!value || value.length > 2048) {
    return { ok: false, message: "2048자 이내의 클라우드 폴더 주소를 입력해 주세요." };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: "올바른 클라우드 폴더 주소인지 확인해 주세요." };
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port ||
    /\s/u.test(value)
  ) {
    return { ok: false, message: "https://로 시작하는 안전한 폴더 주소만 연결할 수 있어요." };
  }
  if (DIRECT_FILE_PATH.test(url.pathname)) {
    return { ok: false, message: "파일 1개 주소가 아니라 폴더 주소를 연결해 주세요." };
  }

  const segments = pathSegments(url);
  let result: Extract<CloudFolderUrlResult, { ok: true }> | null = null;
  if (isGoogleDriveFolder(url)) {
    const folderIndex = segments[1] === "folders" ? 2 : 4;
    const folderRef = segments[folderIndex] ?? "";
    if (GOOGLE_FOLDER_REF.test(folderRef)) {
      result = {
        ok: true,
        provider: "google_drive",
        providerLabel: "Google Drive",
        folderRef,
        url: `https://drive.google.com/drive/folders/${folderRef}`,
      };
    }
  } else if (isOneDriveFolder(url)) {
    if (url.hostname === "1drv.ms" && segments.length === 2 && segments[0] === "f" && ONEDRIVE_SHORT_REF.test(segments[1] ?? "")) {
      const token = segments[1];
      result = { ok: true, provider: "onedrive", providerLabel: "OneDrive", folderRef: `short:${token}`, url: `https://1drv.ms/f/${token}` };
    } else if ((url.hostname === "onedrive.live.com" || url.hostname.endsWith(".onedrive.live.com"))) {
      const id = url.searchParams.get("id") ?? "";
      const cid = url.searchParams.get("cid") ?? "";
      if (ONEDRIVE_LIVE_ID.test(id) && ONEDRIVE_LIVE_CID.test(cid)) {
        result = { ok: true, provider: "onedrive", providerLabel: "OneDrive", folderRef: `live:${id}:${cid}`, url: `https://onedrive.live.com/?id=${id}&cid=${cid}` };
      }
    } else if (url.hostname.endsWith(".sharepoint.com") && safeRefSegments(segments.slice(1))) {
      const tenant = url.hostname.slice(0, -".sharepoint.com".length);
      const sharePath = segments.join("/");
      if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(tenant) && segments[0]?.toLowerCase().includes(":f:")) {
        result = { ok: true, provider: "onedrive", providerLabel: "OneDrive", folderRef: `sharepoint|${tenant}|${sharePath}`, url: `https://${tenant}.sharepoint.com/${sharePath}` };
      }
    }
  } else if (isDropboxFolder(url) && safeRefSegments(segments)) {
    const folderRef = segments.join("/");
    result = { ok: true, provider: "dropbox", providerLabel: "Dropbox", folderRef, url: `https://www.dropbox.com/${folderRef}` };
  }
  if (!result) {
    return {
      ok: false,
      message: "Google Drive·OneDrive·Dropbox 등의 폴더 공유 주소를 입력해 주세요.",
    };
  }

  return result;
}

export function providerFromCloudFolderUrl(url: string): CloudFolderProvider | null {
  const inspected = inspectCloudFolderUrl(url);
  return inspected.ok ? inspected.provider : null;
}

export function cloudFolderProviderLabel(provider: CloudFolderProvider): string {
  if (provider === "google_drive") return "Google Drive";
  if (provider === "onedrive") return "OneDrive";
  if (provider === "dropbox") return "Dropbox";
  return "Dropbox";
}
