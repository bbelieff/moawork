export type CloudFolderProvider =
  | "google_drive"
  | "onedrive"
  | "dropbox"
  | "cloud_folder";

export type CloudFolderLink = {
  id: string;
  url: string;
  provider: CloudFolderProvider;
  providerLabel: string;
};

export type CloudFolderUrlResult =
  | { ok: true; url: string; provider: CloudFolderProvider; providerLabel: string }
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

function isGenericFolder(url: URL) {
  const segments = pathSegments(url);
  const folderSegment = segments.some((segment, index) =>
    ["folder", "folders", "directory", "directories"].includes(segment.toLowerCase()) &&
    validFolderIdentifier(segments[index + 1]) &&
    validFolderIdentifier(segments.at(-1)),
  );
  const folderQuery = ["folder", "folder_id", "folderId", "directory"].some((key) =>
    nonFileQueryValue(url, key),
  );
  return folderSegment || folderQuery;
}

function isKnownProviderHost(url: URL) {
  return (
    url.hostname === "drive.google.com" ||
    url.hostname === "1drv.ms" ||
    url.hostname === "onedrive.live.com" ||
    url.hostname.endsWith(".onedrive.live.com") ||
    url.hostname.endsWith(".sharepoint.com") ||
    url.hostname === "dropbox.com" ||
    url.hostname === "www.dropbox.com"
  );
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
    /\s/u.test(value)
  ) {
    return { ok: false, message: "https://로 시작하는 안전한 폴더 주소만 연결할 수 있어요." };
  }
  if (DIRECT_FILE_PATH.test(url.pathname)) {
    return { ok: false, message: "파일 1개 주소가 아니라 폴더 주소를 연결해 주세요." };
  }

  const provider = isGoogleDriveFolder(url)
    ? { provider: "google_drive" as const, providerLabel: "Google Drive" }
    : isOneDriveFolder(url)
      ? { provider: "onedrive" as const, providerLabel: "OneDrive" }
      : isDropboxFolder(url)
        ? { provider: "dropbox" as const, providerLabel: "Dropbox" }
        : !isKnownProviderHost(url) && isGenericFolder(url)
          ? { provider: "cloud_folder" as const, providerLabel: "클라우드 폴더" }
          : null;
  if (!provider) {
    return {
      ok: false,
      message: "Google Drive·OneDrive·Dropbox 등의 폴더 공유 주소를 입력해 주세요.",
    };
  }

  return { ok: true, url: url.toString(), ...provider };
}

export function providerFromCloudFolderUrl(url: string): CloudFolderProvider {
  const inspected = inspectCloudFolderUrl(url);
  return inspected.ok ? inspected.provider : "cloud_folder";
}

export function cloudFolderProviderLabel(provider: CloudFolderProvider): string {
  if (provider === "google_drive") return "Google Drive";
  if (provider === "onedrive") return "OneDrive";
  if (provider === "dropbox") return "Dropbox";
  return "클라우드 폴더";
}
