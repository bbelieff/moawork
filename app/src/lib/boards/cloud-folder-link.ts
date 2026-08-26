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

function isDirectFileValue(value: string) {
  return DIRECT_FILE_PATH.test(value.trim());
}

function nonFileQueryValue(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim() ?? "";
  return value.length > 0 && !isDirectFileValue(value);
}

function isGoogleDriveFolder(url: URL) {
  return (
    url.hostname === "drive.google.com" &&
    /^\/drive\/(?:u\/\d+\/)?folders\/[^/]+/u.test(url.pathname)
  );
}

function isOneDriveFolder(url: URL) {
  if (url.hostname === "1drv.ms") {
    return /^\/(?:[^/]*:f:[^/]*|f)\//iu.test(url.pathname);
  }
  if (url.hostname === "onedrive.live.com" || url.hostname.endsWith(".onedrive.live.com")) {
    return (
      url.pathname.toLowerCase().includes(":f:") ||
      nonFileQueryValue(url, "id")
    );
  }
  if (url.hostname.endsWith(".sharepoint.com")) {
    return (
      url.pathname.toLowerCase().includes(":f:") ||
      (
        url.pathname.toLowerCase().endsWith("/forms/allitems.aspx") &&
        nonFileQueryValue(url, "id")
      )
    );
  }
  return false;
}

function isDropboxFolder(url: URL) {
  return (
    (url.hostname === "dropbox.com" || url.hostname === "www.dropbox.com") &&
    /^\/(?:scl\/fo|sh|home)\//u.test(url.pathname)
  );
}

function isGenericFolder(url: URL) {
  const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
  const folderSegment = segments.some((segment, index) =>
    ["folder", "folders", "directory", "directories"].includes(segment) &&
    Boolean(segments[index + 1]) &&
    !isDirectFileValue(segments[index + 1]),
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
