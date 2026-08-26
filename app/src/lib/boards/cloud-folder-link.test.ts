import { describe, expect, it } from "vitest";
import { inspectCloudFolderUrl } from "./cloud-folder-link";

describe("Issue #574 cloud folder URL", () => {
  it.each([
    ["https://drive.google.com/drive/folders/folder-id", "google_drive", "Google Drive"],
    ["https://drive.google.com/drive/u/1/folders/folder-id?usp=sharing", "google_drive", "Google Drive"],
    ["https://1drv.ms/f/s!folder-share", "onedrive", "OneDrive"],
    ["https://onedrive.live.com/?id=root%21folder&cid=drive-id", "onedrive", "OneDrive"],
    ["https://tenant.sharepoint.com/:f:/g/team/folder", "onedrive", "OneDrive"],
    ["https://tenant.sharepoint.com/sites/team/Forms/AllItems.aspx?id=%2FShared%20Documents%2FClient", "onedrive", "OneDrive"],
    ["https://www.dropbox.com/scl/fo/folder-id/example", "dropbox", "Dropbox"],
    ["https://cloud.example.com/folders/customer-a", "cloud_folder", "클라우드 폴더"],
  ])("accepts a folder URL and detects its provider: %s", (raw, provider, label) => {
    expect(inspectCloudFolderUrl(raw)).toMatchObject({ ok: true, provider, providerLabel: label });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "http://drive.google.com/drive/folders/folder-id",
    "https://user:password@example.com/folders/a",
    "https://drive.google.com/file/d/file-id/view",
    "https://drive.google.com/drive/folders/",
    "https://drive.google.com/drive/folders/%20",
    "https://drive.google.com/drive/folders/client/contract%2Epdf",
    "https://onedrive.live.com/?id=contract.pdf",
    "https://onedrive.live.com/?id=contract.pdf%3Fdownload%3D1",
    "https://onedrive.live.com/?cid=only-a-drive-id",
    "https://tenant.sharepoint.com/sites/team/Forms/AllItems.aspx?id=contract.pdf",
    "https://tenant.sharepoint.com/:f:",
    "https://example.com/files/contract.pdf",
    "https://example.com/folders/contract.pdf",
    "https://example.com/folders/contract%2Epdf",
    "https://www.dropbox.com/home/contract%2Epdf",
    "https://example.com/?folder=%20",
    "https://example.com/?folder=%2520",
    "https://example.com/?path=home",
    "https://example.com/an-ordinary-page",
  ])("rejects unsafe or non-folder input: %s", (raw) => {
    expect(inspectCloudFolderUrl(raw).ok).toBe(false);
  });
});
